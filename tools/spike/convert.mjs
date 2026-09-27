#!/usr/bin/env node
// Converts a 3DGS file (PLY, SOG, SPZ, ...) or a GLB into the variants measured
// by the spike viewer and records them in spike/assets/variants.json.
//
//   node tools/spike/convert.mjs <input.ply|.sog|.spz|.glb> [--name <scene>] [--sh 3,1] [--rad-encoding gsplat,csplat] [--crop-sphere x,y,z,r | --crop-box x1,y1,z1,x2,y2,z2] [--rad-chunked] [--skip-spz] [--skip-rad]
//
// 3DGS -> <scene>-sh{N}.spz        (splat-transform, SPZ v3: Spark 2.1 cannot read v4)
//      -> <scene>-sh{N}-lod.rad    (Spark build-lod --quality, streamable with paged: true)
//      -> <scene>-sh{N}-lod.rad + <scene>-sh{N}-lod-<i>.radc with --rad-chunked: a small
//         header plus chunk files, so every file fits static hosts' size limits
//         (Cloudflare Pages: 25 MiB) and no HTTP Range support is needed
//      -> <scene>-sh{N}-csplat-lod.rad  (same, with build-lod's compact --csplat encoding)
//
// --crop-sphere / --crop-box keep only the splats inside, in the input file's
// coordinates (= the viewer's ?debug=1 click coordinates, before transform).
// GLB  -> <scene>-orig.glb         (copy of the input, for comparison)
//      -> <scene>-opt.glb          (gltf-transform optimize: meshopt + WebP textures)

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SPLAT_TRANSFORM = "@playcanvas/splat-transform@3.6.6";
const GLTF_TRANSFORM = "@gltf-transform/cli@4.5.0";
const SPARK_TAG = "v2.1.0";

// build-lod splat encodings: gsplat is its higher-precision default, csplat
// the compact one. gsplat keeps the original file names.
const RAD_ENCODINGS = {
  gsplat: { suffix: "", flag: "--gsplat", label: "" },
  csplat: { suffix: "-csplat", flag: "--csplat", label: "・csplat" },
};

// 3DGS inputs both splat-transform and build-lod read. build-lod picks the
// format by extension, so the work copy keeps it (longest suffix first).
const SPLAT_EXTENSIONS = [".compressed.ply", ".ply", ".sog", ".spz", ".splat", ".ksplat"];

function splatExtension(path) {
  const lower = path.toLowerCase();
  return SPLAT_EXTENSIONS.find((ext) => lower.endsWith(ext)) ?? null;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const assetsDir = join(repoRoot, "spike/assets");
const cacheDir = join(repoRoot, "tools/.cache");
const variantsPath = join(assetsDir, "variants.json");
const isWindows = process.platform === "win32";

function numbers(value, count, flag) {
  const list = (value ?? "").split(",").map(Number);
  if (list.length !== count || list.some((n) => !Number.isFinite(n))) {
    throw new Error(`${flag} takes ${count} comma-separated numbers`);
  }
  return list;
}

// Crop arguments for each tool. A box is normalized so either corner order works.
function cropArgs(crop) {
  if (!crop) return { splatTransform: [], buildLod: [] };
  if (crop.kind === "sphere") {
    const v = crop.values.join(",");
    return { splatTransform: ["-S", v], buildLod: [`--within-dist=${v}`] };
  }
  const [x1, y1, z1, x2, y2, z2] = crop.values;
  const min = [Math.min(x1, x2), Math.min(y1, y2), Math.min(z1, z2)].join(",");
  const max = [Math.max(x1, x2), Math.max(y1, y2), Math.max(z1, z2)].join(",");
  return { splatTransform: ["-B", `${min},${max}`], buildLod: [`--min-box=${min}`, `--max-box=${max}`] };
}

function parseArgs(argv) {
  const opts = { input: null, name: null, sh: [3, 1], radEncodings: ["gsplat", "csplat"], crop: null, radChunked: false, skipSpz: false, skipRad: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--name") opts.name = argv[++i];
    else if (arg === "--sh") opts.sh = argv[++i].split(",").map(Number);
    else if (arg === "--rad-encoding") opts.radEncodings = argv[++i].split(",");
    else if (arg === "--crop-sphere") opts.crop = { kind: "sphere", values: numbers(argv[++i], 4, arg) };
    else if (arg === "--crop-box") opts.crop = { kind: "box", values: numbers(argv[++i], 6, arg) };
    else if (arg === "--rad-chunked") opts.radChunked = true;
    else if (arg === "--skip-spz") opts.skipSpz = true;
    else if (arg === "--skip-rad") opts.skipRad = true;
    else if (!arg.startsWith("--") && !opts.input) opts.input = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!opts.input) {
    throw new Error(
      "Usage: node tools/spike/convert.mjs <input.ply|.sog|.spz|.glb> [--name <scene>] [--sh 3,1] [--rad-encoding gsplat,csplat] [--crop-sphere x,y,z,r | --crop-box x1,y1,z1,x2,y2,z2] [--rad-chunked] [--skip-spz] [--skip-rad]",
    );
  }
  if (opts.sh.some((n) => !Number.isInteger(n) || n < 0 || n > 3)) {
    throw new Error("--sh takes SH degrees 0..3, e.g. --sh 3,1");
  }
  if (opts.radEncodings.some((e) => !RAD_ENCODINGS[e])) {
    throw new Error("--rad-encoding takes gsplat and/or csplat, e.g. --rad-encoding csplat");
  }
  return opts;
}

// Node refuses to spawn .cmd files without a shell on Windows, so npx needs
// shell mode there, which in turn needs quoted arguments.
function run(cmd, args, options = {}) {
  const quote = (s) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
  const started = Date.now();
  console.log(`\n$ ${[cmd, ...args].join(" ")}`);
  const result = isWindows
    ? spawnSync([cmd, ...args].map(quote).join(" "), { stdio: "inherit", shell: true, ...options })
    : spawnSync(cmd, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${cmd} exited with status ${result.status}`);
  return (Date.now() - started) / 1000;
}

function hasCommand(cmd) {
  const result = spawnSync(cmd, ["--version"], { stdio: "ignore", shell: isWindows });
  return result.status === 0;
}

function moveFile(from, to) {
  rmSync(to, { force: true });
  copyFileSync(from, to);
  unlinkSync(from);
}

function ensureBuildLod() {
  if (process.env.SPARK_BUILD_LOD) return process.env.SPARK_BUILD_LOD;
  const sparkDir = join(cacheDir, "spark");
  const binary = join(sparkDir, "rust/target/release", isWindows ? "build-lod.exe" : "build-lod");
  if (existsSync(binary)) return binary;
  if (!hasCommand("cargo")) {
    console.warn("\n[skip] cargo が見つからないため RAD の生成をスキップします（https://rustup.rs/ で Rust を入れてください）");
    return null;
  }
  if (!existsSync(sparkDir)) {
    mkdirSync(cacheDir, { recursive: true });
    run("git", ["clone", "--depth", "1", "--branch", SPARK_TAG, "https://github.com/sparkjsdev/spark.git", sparkDir]);
  }
  run("cargo", ["build", "--release"], { cwd: join(sparkDir, "rust/build-lod") });
  return binary;
}

function readVariants() {
  return existsSync(variantsPath) ? JSON.parse(readFileSync(variantsPath, "utf8")) : [];
}

function writeVariants(added) {
  const byFile = new Map(readVariants().map((v) => [v.file, v]));
  for (const v of added) byFile.set(v.file, v);
  const list = [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file));
  writeFileSync(variantsPath, `${JSON.stringify(list, null, 2)}\n`);
}

function variant(scene, file, label, kind, buildSeconds, extra = {}) {
  const bytes = statSync(join(assetsDir, file)).size;
  console.log(`  -> ${file}  ${(bytes / 1e6).toFixed(1)} MB  (${buildSeconds.toFixed(0)} s)`);
  return { scene, file, label, kind, bytes, buildSeconds: Math.round(buildSeconds), ...extra };
}

// Largest file Cloudflare Pages serves; bigger ones need object storage.
const PAGES_FILE_LIMIT = 25 * 1024 * 1024;

const isRadOutput = (name) => name.endsWith(".rad") || name.endsWith(".radc");

function removeRadOutputs(dir) {
  for (const name of readdirSync(dir)) {
    if (isRadOutput(name)) rmSync(join(dir, name), { force: true });
  }
}

// build-lod names its outputs after the input's stem (not obvious for double
// extensions such as .compressed.ply), so take whatever appeared. Chunk file
// names are recorded inside the header and must not be renamed; the header
// itself can be.
function collectRadOutputs(dir) {
  const names = readdirSync(dir).filter(isRadOutput);
  const header = names.find((n) => n.endsWith(".rad"));
  if (!header) throw new Error(`build-lod did not write a .rad file in ${dir}`);
  return { header: join(dir, header), chunks: names.filter((n) => n.endsWith(".radc")).map((n) => join(dir, n)) };
}

function convertSplat(input, ext, scene, opts) {
  const added = [];
  if (!opts.skipSpz) {
    for (const sh of opts.sh) {
      const file = `${scene}-sh${sh}.spz`;
      const seconds = run("npx", [
        "-y", SPLAT_TRANSFORM, "-w", "--spz-version", "3",
        input, ...cropArgs(opts.crop).splatTransform, "-H", String(sh), join(assetsDir, file),
      ]);
      added.push(variant(scene, file, `SPZ SH${sh}（一括読み込み）`, "splat", seconds, { paged: false }));
    }
  }
  if (!opts.skipRad) {
    const buildLod = ensureBuildLod();
    if (buildLod) {
      // build-lod writes its output next to its input, so work on a link (or
      // copy) inside the cache instead of the user's folder. Each variant gets
      // its own work name because chunk files are named after the input.
      const workDir = join(cacheDir, "work");
      mkdirSync(workDir, { recursive: true });
      for (const sh of opts.sh) {
        for (const encoding of opts.radEncodings) {
          const { suffix, flag, label } = RAD_ENCODINGS[encoding];
          const base = `${scene}-sh${sh}${suffix}-lod`;
          const workInput = join(workDir, `${scene}-sh${sh}${suffix}${ext}`);
          rmSync(workInput, { force: true });
          try {
            linkSync(input, workInput);
          } catch {
            copyFileSync(input, workInput);
          }
          removeRadOutputs(workDir);
          const seconds = run(buildLod, [
            "--quality", flag, `--max-sh=${sh}`, ...cropArgs(opts.crop).buildLod,
            opts.radChunked ? "--rad-chunked" : "--rad", workInput,
          ]);
          rmSync(workInput, { force: true });

          const { header, chunks } = collectRadOutputs(workDir);
          // Drop chunks of an earlier conversion of the same variant.
          for (const name of readdirSync(assetsDir)) {
            if (name.startsWith(`${base}-`) && name.endsWith(".radc")) rmSync(join(assetsDir, name));
          }
          const file = `${base}.rad`;
          moveFile(header, join(assetsDir, file));
          for (const chunk of chunks) {
            moveFile(chunk, join(assetsDir, basename(chunk)));
          }

          const sizes = [file, ...chunks.map((c) => basename(c))].map((n) => statSync(join(assetsDir, n)).size);
          const v = variant(
            scene, file,
            `RAD SH${sh}${label}${chunks.length ? `・分割${chunks.length}` : ""}（LoD・ストリーミング）`,
            "splat", seconds, { paged: true, chunks: chunks.length },
          );
          v.bytes = sizes.reduce((a, b) => a + b, 0);
          const largest = Math.max(...sizes);
          console.log(`  total ${(v.bytes / 1e6).toFixed(1)} MB in ${sizes.length} file(s), largest ${(largest / 1e6).toFixed(1)} MB`);
          if (largest > PAGES_FILE_LIMIT) {
            console.warn("  [warn] 25 MiB を超えるファイルがあります。Cloudflare Pages に置くには --rad-chunked を付けてください。");
          }
          added.push(v);
        }
      }
    }
  }
  return added;
}

function convertGlb(input, scene) {
  const orig = `${scene}-orig.glb`;
  copyFileSync(input, join(assetsDir, orig));
  const added = [variant(scene, orig, "GLB 元ファイル", "mesh", 0)];
  const opt = `${scene}-opt.glb`;
  const seconds = run("npx", [
    "-y", GLTF_TRANSFORM, "optimize", input, join(assetsDir, opt),
    "--compress", "meshopt", "--texture-compress", "webp", "--simplify", "false",
  ]);
  added.push(variant(scene, opt, "GLB 最適化（meshopt + WebP）", "mesh", seconds));
  return added;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const input = resolve(opts.input);
  if (!existsSync(input)) throw new Error(`Input not found: ${input}`);
  const splatExt = splatExtension(input);
  const isGlb = extname(input).toLowerCase() === ".glb";
  const scene = opts.name ?? basename(input).slice(0, -(splatExt ?? extname(input)).length);
  mkdirSync(assetsDir, { recursive: true });

  console.log(`input: ${input} (${(statSync(input).size / 1e6).toFixed(1)} MB), scene: ${scene}`);
  let added;
  if (splatExt) added = convertSplat(input, splatExt, scene, opts);
  else if (isGlb) added = convertGlb(input, scene);
  else throw new Error(`Unsupported input: ${basename(input)} (${SPLAT_EXTENSIONS.join(" ")} .glb)`);

  writeVariants(added);
  console.log(`\n${added.length} 件を ${variantsPath} に記録しました。npm run spike:dev で確認できます。`);
}

try {
  main();
} catch (err) {
  console.error(`\nerror: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
