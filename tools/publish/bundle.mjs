#!/usr/bin/env node
// Assembles a tour into one static folder ready to upload (e.g. to Cloudflare
// Pages): the viewer build, the tour's manifest.json, and only the assets the
// manifest references (chunked .rad files include their .radc chunks).
//
//   node tools/publish/bundle.mjs [--tour tours/sample] [--out dist-publish]
//                                 [--asset-base-url <url>] [--allow-indexing] [--skip-build]
//
// --asset-base-url rewrites the manifest's assetBaseUrl and leaves the assets
// out of the folder, for assets hosted elsewhere (e.g. R2); the files to
// upload there are listed instead.
//
// Unless --allow-indexing is given, search engines are asked not to index the
// site (robots.txt and a Cloudflare Pages _headers file), since tours start
// out shared only with people who have the URL.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Cloudflare Pages limits for a deployment.
const PAGES_FILE_LIMIT = 25 * 1024 * 1024;
const PAGES_FILE_COUNT_LIMIT = 20000;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const isWindows = process.platform === "win32";

function parseArgs(argv) {
  const opts = { tour: "tours/sample", out: "dist-publish", assetBaseUrl: null, allowIndexing: false, skipBuild: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--tour") opts.tour = argv[++i];
    else if (arg === "--out") opts.out = argv[++i];
    else if (arg === "--asset-base-url") opts.assetBaseUrl = argv[++i];
    else if (arg === "--allow-indexing") opts.allowIndexing = true;
    else if (arg === "--skip-build") opts.skipBuild = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

const isAbsoluteUrl = (url) => /^[a-z][a-z0-9+.-]*:/i.test(url);

// Asset paths the manifest refers to, relative to its assetBaseUrl.
function referencedAssets(manifest) {
  const paths = new Set();
  for (const scene of manifest.scenes ?? []) {
    if (scene.splat?.url) paths.add(scene.splat.url);
    for (const entrance of scene.entrances ?? []) {
      if (entrance.image) paths.add(entrance.image);
      if (entrance.target?.type === "mesh" && entrance.target.url) paths.add(entrance.target.url);
    }
  }
  return [...paths].filter((p) => !isAbsoluteUrl(p));
}

// A chunked .rad (converted with --rad-chunked) needs its <name>-<i>.radc files.
function withChunks(assetDir, path) {
  if (!path.endsWith(".rad")) return [path];
  const dir = dirname(path);
  const stem = basename(path, ".rad");
  const folder = join(assetDir, dir);
  const chunks = existsSync(folder)
    ? readdirSync(folder).filter((n) => n.startsWith(`${stem}-`) && n.endsWith(".radc"))
    : [];
  return [path, ...chunks.map((n) => (dir === "." ? n : `${dir}/${n}`))];
}

function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else files.push(path);
  }
  return files;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const tourDir = resolve(repoRoot, opts.tour);
  const outDir = resolve(repoRoot, opts.out);
  const manifestPath = join(tourDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`${manifestPath} がありません（manifest_sample.json をコピーして作ってください）`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const assetBase = manifest.assetBaseUrl ?? "./";
  if (!opts.assetBaseUrl && (isAbsoluteUrl(assetBase) || assetBase.startsWith("/") || assetBase.includes(".."))) {
    throw new Error(`assetBaseUrl "${assetBase}" はツアーのフォルダ内の相対パスではありません。--asset-base-url を指定してください`);
  }
  const assetDir = join(tourDir, opts.assetBaseUrl ? "assets" : assetBase);

  if (!opts.skipBuild) {
    const result = spawnSync("npm", ["run", "viewer:build"], { cwd: repoRoot, stdio: "inherit", shell: isWindows });
    if (result.status !== 0) throw new Error("npm run viewer:build に失敗しました");
  }
  const viewerDir = join(repoRoot, "dist-viewer");
  if (!existsSync(join(viewerDir, "index.html"))) {
    throw new Error("dist-viewer/ がありません（--skip-build を外すか npm run viewer:build を実行してください）");
  }

  const assets = referencedAssets(manifest).flatMap((p) => withChunks(assetDir, p));
  const missing = assets.filter((p) => !existsSync(join(assetDir, p)));
  if (missing.length > 0) {
    throw new Error(`manifest が参照するファイルがありません（${assetDir}）:\n  ${missing.join("\n  ")}`);
  }

  rmSync(outDir, { recursive: true, force: true });
  cpSync(viewerDir, outDir, { recursive: true });

  if (opts.assetBaseUrl) {
    manifest.assetBaseUrl = opts.assetBaseUrl;
  } else {
    const outAssetDir = join(outDir, assetBase);
    for (const path of assets) {
      mkdirSync(dirname(join(outAssetDir, path)), { recursive: true });
      cpSync(join(assetDir, path), join(outAssetDir, path));
    }
  }
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  if (!opts.allowIndexing) {
    writeFileSync(join(outDir, "robots.txt"), "User-agent: *\nDisallow: /\n");
    writeFileSync(join(outDir, "_headers"), "/*\n  X-Robots-Tag: noindex, nofollow\n");
  }

  const files = listFiles(outDir);
  const total = files.reduce((sum, f) => sum + statSync(f).size, 0);
  const tooLarge = files.filter((f) => statSync(f).size > PAGES_FILE_LIMIT);
  console.log(`\n${relative(repoRoot, outDir)}${sep}: ${files.length} ファイル, ${(total / 1e6).toFixed(1)} MB`);
  if (tooLarge.length > 0) {
    console.warn(
      `[warn] 25 MiB を超えるファイルがあり、Cloudflare Pages には置けません:\n  ${tooLarge
        .map((f) => relative(outDir, f))
        .join("\n  ")}\n  RAD は --rad-chunked で変換し直すか、--asset-base-url でストレージに置いてください。`,
    );
  }
  if (files.length > PAGES_FILE_COUNT_LIMIT) {
    console.warn(`[warn] ファイル数が Cloudflare Pages の上限（${PAGES_FILE_COUNT_LIMIT}）を超えています。`);
  }
  if (opts.assetBaseUrl) {
    console.log(`\n次のファイルを ${opts.assetBaseUrl} に置いてください（${assetDir} から）:\n  ${assets.join("\n  ")}`);
  }
}

try {
  main();
} catch (err) {
  console.error(`\nerror: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
