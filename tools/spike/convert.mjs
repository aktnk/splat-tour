#!/usr/bin/env node
// Converts a 3DGS PLY or a GLB into the variants measured by the spike viewer
// and records them in spike/assets/variants.json.
//
//   node tools/spike/convert.mjs <input.ply|input.glb> [--name <scene>] [--sh 3,1] [--skip-spz] [--skip-rad]
//
// PLY -> <scene>-sh{N}.spz        (splat-transform, SPZ v3: Spark 2.1 cannot read v4)
//     -> <scene>-sh{N}-lod.rad    (Spark build-lod --quality, streamable with paged: true)
// GLB -> <scene>-orig.glb         (copy of the input, for comparison)
//     -> <scene>-opt.glb          (gltf-transform optimize: meshopt + WebP textures)

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
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

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const assetsDir = join(repoRoot, "spike/assets");
const cacheDir = join(repoRoot, "tools/.cache");
const variantsPath = join(assetsDir, "variants.json");
const isWindows = process.platform === "win32";

function parseArgs(argv) {
  const opts = { input: null, name: null, sh: [3, 1], skipSpz: false, skipRad: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--name") opts.name = argv[++i];
    else if (arg === "--sh") opts.sh = argv[++i].split(",").map(Number);
    else if (arg === "--skip-spz") opts.skipSpz = true;
    else if (arg === "--skip-rad") opts.skipRad = true;
    else if (!arg.startsWith("--") && !opts.input) opts.input = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!opts.input) {
    throw new Error(
      "Usage: node tools/spike/convert.mjs <input.ply|input.glb> [--name <scene>] [--sh 3,1] [--skip-spz] [--skip-rad]",
    );
  }
  if (opts.sh.some((n) => !Number.isInteger(n) || n < 0 || n > 3)) {
    throw new Error("--sh takes SH degrees 0..3, e.g. --sh 3,1");
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

function convertPly(input, scene, opts) {
  const added = [];
  if (!opts.skipSpz) {
    for (const sh of opts.sh) {
      const file = `${scene}-sh${sh}.spz`;
      const seconds = run("npx", [
        "-y", SPLAT_TRANSFORM, "-w", "--spz-version", "3",
        input, "-H", String(sh), join(assetsDir, file),
      ]);
      added.push(variant(scene, file, `SPZ SH${sh}（一括読み込み）`, "splat", seconds, { paged: false }));
    }
  }
  if (!opts.skipRad) {
    const buildLod = ensureBuildLod();
    if (buildLod) {
      // build-lod writes <input>-lod.rad next to its input, so work on a link
      // (or copy) inside the cache instead of the user's folder.
      const workDir = join(cacheDir, "work");
      mkdirSync(workDir, { recursive: true });
      const workInput = join(workDir, `${scene}.ply`);
      rmSync(workInput, { force: true });
      try {
        linkSync(input, workInput);
      } catch {
        copyFileSync(input, workInput);
      }
      for (const sh of opts.sh) {
        const file = `${scene}-sh${sh}-lod.rad`;
        const seconds = run(buildLod, ["--quality", `--max-sh=${sh}`, "--rad", workInput]);
        moveFile(join(workDir, `${scene}-lod.rad`), join(assetsDir, file));
        added.push(variant(scene, file, `RAD SH${sh}（LoD・ストリーミング）`, "splat", seconds, { paged: true }));
      }
      rmSync(workInput, { force: true });
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
  const ext = extname(input).toLowerCase();
  const scene = opts.name ?? basename(input, extname(input));
  mkdirSync(assetsDir, { recursive: true });

  console.log(`input: ${input} (${(statSync(input).size / 1e6).toFixed(1)} MB), scene: ${scene}`);
  let added;
  if (ext === ".ply") added = convertPly(input, scene, opts);
  else if (ext === ".glb") added = convertGlb(input, scene);
  else throw new Error(`Unsupported input: ${ext} (.ply or .glb)`);

  writeVariants(added);
  console.log(`\n${added.length} 件を ${variantsPath} に記録しました。npm run spike:dev で確認できます。`);
}

try {
  main();
} catch (err) {
  console.error(`\nerror: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
