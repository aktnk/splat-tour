# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

splat-tour is a Tauri v2 desktop app: a virtual-tour viewer for 3D Gaussian Splatting (3DGS) scenes where the user can place entrance icons at 3D positions. Hovering an icon shows an annotation (text + image); clicking it opens the configured content (another 3DGS, a 3D mesh, or a web URL). Stack: Vite + TypeScript, Three.js, `@sparkjsdev/spark` (3DGS renderer), nipplejs (touch joystick). The spec is `docs/spec/specification.md` (Japanese) and the README holds a progress checklist. The code so far implements only part of the spec. There are two apps: the Tauri app in `src/` (future authoring tool; clicking an icon in Explore mode still only `console.log`s the annotation) and the web viewer in `viewer/` + `src/viewer/`, which plays a tour from a hand-written `manifest.json` (see `tours/README.md`).

## Direction (spec vs. current code)

Decided by the spec; the code has not caught up yet, so the Architecture section below describes the *current* code.
- Web delivery format (measured on an iPhone XR): 3DGS as streamed LoD `.rad` with SH1 (`paged: true`), 3D models as meshopt/WebP-optimized GLB. SH3 overheats/stalls phones. Keeping phones cool matters more than peak FPS: the viewer renders on demand, capped at 30fps and pixel ratio 1.5 on mobile (`src/viewer/frame-loop.ts`).
- The end product is a tour published on the web and viewed in browsers (PC and smartphone). This Tauri app becomes the authoring tool only; the viewer is a separate web build that shares the rendering/controls code, with Tauri-dependent parts (file dialog, `plugin-fs`) kept out of the shared code. Publishing = exporting the project as a static bundle (manifest JSON + assets, no SQLite); assets are referenced by relative path and resolved against a configurable base URL.
- Storage moves to one SQLite3 database per project. Until that lands, annotations are in-memory only (lost on restart, cleared when another splat is opened). Editing UI moves to a left-side menu. Movement modes become walking (wall/ground collision) and drone.
- Kept as 3DGS settings: camera settings (speed, sensitivity, FOV), render settings (exposure, focal adjustment), X/Y/Z flips, WASD/QE nudging of the selected icon.
- Removed from the spec and the code: lock-on, HUD toggle, Reset View, annotation JSON export/import, sidecar JSON persistence. Don't reintroduce them.

## Commands

```bash
npm install
npm run tauri dev     # full app (starts Vite on fixed port 1420 via beforeDevCommand)
npm run dev           # frontend only in a browser — Tauri APIs (file dialog, fs, invoke) will not work
npm run build         # `tsc && vite build`; tsc is the only static check (covers src/, spike/ and viewer/)
npm run viewer:dev    # web viewer on port 5190, serving tours/fuji-museum (TOUR_DIR=... for another tour); ?debug=1 shows coordinates
npm run viewer:build  # static viewer build into dist-viewer/ (tour data is published separately)
npm run spike:convert -- <file.ply|file.glb> --name <scene>   # loading spike: convert into spike/assets/
npm run spike:dev     # loading spike viewer on port 5180 (LAN-exposed, counts bytes served)
```

`spike/` is a throwaway measurement viewer for deciding the web asset format (SPZ vs streamed LoD `.rad`, GLB optimization) on real phones; see `spike/README.md`. It reuses `src/scene.ts` and `src/controls.ts`, so keep those free of Tauri imports. Converted assets under `spike/assets/` are gitignored. Spark 2.1 reads SPZ only up to v3, so SPZ output must be written with `--spz-version 3`.

**Web viewer.** `viewer/main.ts` only reads the URL params and calls `startTour` in `src/viewer/tour.ts`, the viewer's composition root (same `setupX` factory style). `src/core/manifest.ts` defines and validates the manifest (plain data, no DOM/Three/Tauri). Scene-local coordinates: the splat and the entrance sprites live under `SplatView.root`, which carries the scene transform (flips = π rotations, scale); manifest positions are local, yaw/pitch are world-frame degrees. `src/viewer/` must never import Tauri APIs; it reuses `src/scene.ts` and `src/controls.ts`. Rendering goes through `setupFrameLoop`: the tick returns whether anything changed (camera moved, loading, streaming, splat count changed) and frames stop `settleMs` after the last change, so any new animated UI must call `invalidate()` or report a change.

There is no test runner and no linter configured. `tsconfig.json` is strict with `noUnusedLocals`/`noUnusedParameters`, so unused imports or variables fail `npm run build`.

## Architecture

**Wiring.** `src/main.ts` `init()` is the composition root. Every module exports a `setupX(...)` factory that returns a small interface object (closure state, no classes); `init()` creates them all and connects them. Modules look up their own DOM elements by id (`getElementById`) from `index.html`, so adding UI means editing `index.html` + `style.css` and the module together. The render loop is `animate()` in `main.ts`: joystick → `controls.update` → `renderer.render`.

**Scene / rendering.** `scene.ts` builds the WebGL renderer, camera and a `SparkRenderer` (added to the scene). `splat-loader.ts` reads the picked file with Tauri `plugin-fs`, builds a `SplatMesh` (with `raycastable: true`, which is what makes click-to-place raycasting hit the splat surface), and swaps out the previous mesh. Format is chosen by file extension (`EXTENSION_TO_FILE_TYPE`; `.sog` maps to `PCSOGSZIP`). Flip buttons rotate the mesh by π on an axis.

**Camera input interplay.** `controls.ts` wraps Spark's `SparkControls` (FPS movement + pointer look) and the joystick. Selecting an annotation (`setSelectedAnnotation` in `main.ts`) disables `fpsMovement` so WASD/QE can nudge the annotation instead of moving the camera. That `document` `keydown` listener has its own `isFormElement` guard, so new global shortcuts can collide with it.

**Annotations** (the part that spans several files):
- `types.ts` — `Annotation { id, position, title, description, imagePath? }`.
- `annotation-store.ts` — single source of truth. Immutable array replaced on every mutation, with `subscribe` listeners.
- `annotation-markers.ts` — subscribes to the store and keeps one `THREE.Sprite` per annotation in a group (icon is drawn to a canvas texture). Sprites carry `userData.annotationId`, which is how raycast hits map back to annotations.
- `annotation-mode.ts` — Edit Mode ON/OFF toggle button only.
- `main.ts` — click handling: a `pointerup` within `CLICK_DRAG_THRESHOLD_PX` of `pointerdown` counts as a click (otherwise it's a look-drag). In Edit Mode: click a marker → select/deselect; click elsewhere while selected → move the selected annotation there; otherwise place a new one. Placement point is the splat raycast hit, or a fallback distance along the ray if nothing was hit.
- There is no persistence yet: opening a splat calls `annotationStore.replaceAll([])`.

**Tauri side.** `src-tauri/src/lib.rs` registers only the fs and dialog plugins (no custom commands). The dialog plugin grants fs scope to the exact file the user picked, which is enough to read the splat. New file access beyond this needs matching permissions in `src-tauri/capabilities/default.json`.

## Spec / README
- Feature spec: `docs/spec/specification.md`
- Progress checklist and setup: README.md
