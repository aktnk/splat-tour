# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

splat-tour is a web viewer for 3D Gaussian Splatting (3DGS) virtual tours, viewed in browsers on PC and smartphone. A tour is described by a `manifest.json`: scenes (splats), and entrance icons placed at 3D positions. Hovering (tapping on phones) an icon shows its description (text + image); opening it moves to another scene, a GLB model screen or a web page. Stack: Vite + TypeScript, Three.js, `@sparkjsdev/spark` (3DGS renderer), nipplejs (touch joystick). The spec is `docs/spec/specification.md` (Japanese) and the README holds a progress checklist.

This repository is the public, MIT-licensed part: the viewer, the manifest format and its validation, hand-authoring aids (`?debug=1`), and the conversion and publishing tools. The GUI authoring tool ("編集機能" in the spec) is developed in a separate repository and consumes this one as a package (`package.json` `exports`: `splat-tour` → `src/viewer/index.ts`, `splat-tour/manifest` → `src/core/manifest.ts`, plus `splat-tour/viewer.html` / `splat-tour/viewer.css` for the DOM `startTour` expects; TypeScript sources for bundlers). Keep editor features out of this repo, and keep business plans (pricing etc.) out of all committed files.

Tours' `manifest.json` and `assets/` are gitignored because they can name a real site whose owner has not approved publication; only the template `manifest_sample.json` is committed, and it must stay free of real names and real coordinates. The same goes for commit messages and PR text.

## Direction

- Web delivery format (measured on an iPhone XR): 3DGS as streamed LoD `.rad` with SH1 (`paged: true`), 3D models as meshopt/WebP-optimized GLB. SH3 overheats/stalls phones. Keeping phones cool matters more than peak FPS: the viewer renders on demand, capped at 30fps and pixel ratio 1.5 on mobile (`src/viewer/frame-loop.ts`).
- Publishing = a static bundle (viewer build + manifest + referenced assets) on static hosting; assets are referenced by relative path and resolved against the manifest's `assetBaseUrl`. Friends-only first (noindex, URL-only), Cloudflare Pages without object storage, so RADs are converted with `--rad-chunked` to stay under 25 MiB per file.
- `?debug=1` (view/point coordinates, floor alignment) stays in the public viewer: without it a manifest cannot be written by hand.
- Movement modes are to become walking (wall/ground collision) and drone; only free (drone-like) movement exists so far, with optional per-scene `bounds` and the "初期位置" button as a way back for visitors lost in stray splats.
- Removed from the spec: lock-on, HUD toggle, annotation JSON export/import, sidecar JSON persistence. Don't reintroduce them.

## Commands

```bash
npm install
cp tours/sample/manifest_sample.json tours/sample/manifest.json   # once; manifest.json is gitignored
npm run dev           # viewer on port 5190 (LAN-exposed), serving tours/sample (TOUR_DIR=... for another tour); ?debug=1 shows coordinates, ?scene=<id> opens a scene
npm run build         # `tsc && vite build`: tsc is the only static check (covers src/, spike/, viewer/); static viewer build in dist-viewer/
npm run tour:bundle   # viewer build + a tour's manifest and referenced assets in dist-publish/, ready for Cloudflare Pages (see tours/README.md)
npm run spike:convert -- <file.ply|.sog|.spz|.glb> --name <scene> [--sh 1] [--rad-chunked] [--crop-sphere x,y,z,r]   # convert into spike/assets/
npm run spike:dev     # loading measurement viewer on port 5180 (counts bytes served, saves results to spike/results/)
```

(`viewer:dev` / `viewer:build` are aliases of `dev` / `build`; `tools/publish/bundle.mjs` calls `viewer:build`.)

There is no test runner and no linter configured. `tsconfig.json` is strict with `noUnusedLocals`/`noUnusedParameters`, so unused imports or variables fail `npm run build`. The conversion tools (splat-transform, gltf-transform via npx; Spark's Rust `build-lod`, built into `tools/.cache/`) may not be runnable in a sandbox; test file handling with a stand-in via `SPARK_BUILD_LOD=<script>`.

`spike/` is a measurement viewer used to decide the web asset format on real phones; see `spike/README.md`. Converted assets under `spike/assets/` are gitignored. Spark 2.1 reads SPZ only up to v3, so SPZ output must be written with `--spz-version 3`.

## Architecture

**Wiring.** `viewer/main.ts` only reads the URL params and calls `startTour` in `src/viewer/tour.ts`, the viewer's composition root. Every module exports a `setupX(...)` factory returning a small interface object (closure state, no classes). Modules look up their own DOM elements by id from `viewer/index.html`, so adding UI means editing `viewer/index.html` + `viewer/style.css` and the module together. `src/viewer/index.ts` is the public API for other projects.

**Manifest.** `src/core/manifest.ts` defines and validates the manifest (plain data, no DOM/Three), filling defaults and reporting errors with the offending path. Scene-local coordinates: the splat and the entrance icons live under `SplatView.root`, which carries the scene transform (`rotation` degrees XYZ Euler with 180 added per flip, scale; `?debug=1` can compute `rotation` from three floor clicks); manifest positions are local, yaw/pitch are world-frame degrees.

**Rendering.** `scene.ts` builds the WebGL renderer, camera and `SparkRenderer`. Rendering goes through `setupFrameLoop`: the tick returns whether anything changed (camera moved, loading, streaming) and frames stop `settleMs` after the last change; then the rAF chain itself stops until an input event or `invalidate()`, so any new animated UI must call `invalidate()` or report a change. Do not use `renderer.setAnimationLoop` (its rAF keeps running empty after being cleared from inside its callback), and do not treat `sparkRenderer.activeSplats` changes as a change signal (the LoD varies it every sort, so a still view would never stop rendering).

**Entrances.** Coin-shaped icons (`entrance-markers.ts`) are opaque and depth-tested, so splats in front (Spark draws splats depth-tested and blended over opaque geometry) hide them; picking skips coins behind a splat surface. `entrance-interaction.ts`: mouse hover shows the popup and click opens; on touch the first tap shows it and a second tap (or "開く") opens. A pointerup within `CLICK_DRAG_THRESHOLD_PX` of pointerdown is a click, otherwise a look-drag.

**Controls.** `controls.ts` wraps Spark's `SparkControls` (FPS movement + pointer look) and the nipplejs joystick, which is rebuilt on resize/rotation because nipplejs measures its zone once. The mesh screen uses its own scene, camera and OrbitControls, with image-based light and neutral tone mapping.
