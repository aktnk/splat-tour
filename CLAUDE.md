# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

splat-tour is a Tauri v2 desktop app: a virtual-tour viewer for 3D Gaussian Splatting (3DGS) scenes where the user can place entrance icons at 3D positions. Hovering an icon shows an annotation (text + image); clicking it opens the configured content (another 3DGS, a 3D mesh, or a web URL). Stack: Vite + TypeScript, Three.js, `@sparkjsdev/spark` (3DGS renderer), nipplejs (touch joystick). The spec is `docs/spec/specification.md` (Japanese) and the README holds a progress checklist. The code so far implements only part of the spec: currently clicking an icon in Explore mode only `console.log`s the annotation.

## Direction (spec vs. current code)

Decided by the spec; the code has not caught up yet, so the Architecture section below describes the *current* code.
- The end product is a tour published on the web and viewed in browsers (PC and smartphone). This Tauri app becomes the authoring tool only; the viewer is a separate web build that shares the rendering/controls code, with Tauri-dependent parts (file dialog, `plugin-fs`) kept out of the shared code. Publishing = exporting the project as a static bundle (manifest JSON + assets, no SQLite); assets are referenced by relative path and resolved against a configurable base URL.
- Storage moves to one SQLite3 database per project. Until that lands, annotations are in-memory only (lost on restart, cleared when another splat is opened). Editing UI moves to a left-side menu. Movement modes become walking (wall/ground collision) and drone.
- Kept as 3DGS settings: camera settings (speed, sensitivity, FOV), render settings (exposure, focal adjustment), X/Y/Z flips, WASD/QE nudging of the selected icon.
- Removed from the spec and the code: lock-on, HUD toggle, Reset View, annotation JSON export/import, sidecar JSON persistence. Don't reintroduce them.

## Commands

```bash
npm install
npm run tauri dev     # full app (starts Vite on fixed port 1420 via beforeDevCommand)
npm run dev           # frontend only in a browser — Tauri APIs (file dialog, fs, invoke) will not work
npm run build         # `tsc && vite build`; tsc is the only static check
```

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
