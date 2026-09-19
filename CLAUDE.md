# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

splat-tour is a Tauri v2 desktop app: a virtual-tour viewer for 3D Gaussian Splatting (3DGS) scenes where the user can place annotation icons at 3D positions. Stack: Vite + TypeScript, Three.js, `@sparkjsdev/spark` (3DGS renderer), nipplejs (touch joystick). The README is written in Japanese and tracks an implementation roadmap (next step: step 4, popup display in Explore mode; currently clicking an icon in Explore mode only `console.log`s the annotation).

## Commands

```bash
npm install
npm run tauri dev     # full app (starts Vite on fixed port 1420 via beforeDevCommand)
npm run dev           # frontend only in a browser — Tauri APIs (file dialog, fs, invoke) will not work
npm run build         # `tsc && vite build`; tsc is the only static check
```

There is no test runner and no linter configured. `tsconfig.json` is strict with `noUnusedLocals`/`noUnusedParameters`, so unused imports or variables fail `npm run build`.

## Architecture

**Wiring.** `src/main.ts` `init()` is the composition root. Every module exports a `setupX(...)` factory that returns a small interface object (closure state, no classes); `init()` creates them all and connects them. Modules look up their own DOM elements by id (`getElementById`) from `index.html`, so adding UI means editing `index.html` + `style.css` and the module together. The render loop is `animate()` in `main.ts`: joystick → `controls.update` → `lockOnCamera.update` → `renderer.render`.

**Scene / rendering.** `scene.ts` builds the WebGL renderer, camera and a `SparkRenderer` (added to the scene). `splat-loader.ts` reads the picked file with Tauri `plugin-fs`, builds a `SplatMesh` (with `raycastable: true`, which is what makes click-to-place raycasting hit the splat surface), and swaps out the previous mesh. Format is chosen by file extension (`EXTENSION_TO_FILE_TYPE`; `.sog` maps to `PCSOGSZIP`). Flip buttons rotate the mesh by π on an axis; Reset View undoes camera pose, flips and lock-on.

**Camera input interplay.** `controls.ts` wraps Spark's `SparkControls` (FPS movement + pointer look) and the joystick. Two features toggle Spark control flags and must be kept consistent with each other:
- Lock-on (`lockon-camera.ts`, Space/L/F) disables `pointerControls`, force-looks at a hard-coded origin target and scales speed by distance.
- Selecting an annotation (`setSelectedAnnotation` in `main.ts`) disables `fpsMovement` so WASD/QE can nudge the annotation instead of moving the camera.
Both attach their own `document` `keydown` listeners (each with its own `isFormElement` guard), so new global shortcuts can collide with these.

**Annotations** (the part that spans several files):
- `types.ts` — `Annotation { id, position, title, description, imagePath? }`.
- `annotation-store.ts` — single source of truth. Immutable array replaced on every mutation, with `subscribe` listeners; also manual JSON export/import via dialogs.
- `annotation-markers.ts` — subscribes to the store and keeps one `THREE.Sprite` per annotation in a group (icon is drawn to a canvas texture). Sprites carry `userData.annotationId`, which is how raycast hits map back to annotations.
- `annotation-mode.ts` — Edit Mode ON/OFF toggle button only.
- `main.ts` — click handling: a `pointerup` within `CLICK_DRAG_THRESHOLD_PX` of `pointerdown` counts as a click (otherwise it's a look-drag). In Edit Mode: click a marker → select/deselect; click elsewhere while selected → move the selected annotation there; otherwise place a new one. Placement point is the splat raycast hit, or a fallback distance along the ray if nothing was hit.
- `annotation-persistence.ts` — auto-persistence to a sidecar file `<splat path>.annotations.json` next to the opened splat. `main.ts` subscribes to the store and saves on every change (guarded by `isLoadingAnnotations` so loading doesn't trigger a save, and by `sidecarExists` so an empty store doesn't create a file). Writes are serialized through a promise chain.

**Tauri side.** `src-tauri/src/lib.rs` registers the fs and dialog plugins and one command, `allow_sidecar_path`. The dialog plugin only grants fs scope to the exact file the user picked, so the sidecar path needs its own scope grant; the frontend calls `invoke("allow_sidecar_path")` before every sidecar read/write. New file access beyond this needs matching permissions in `src-tauri/capabilities/default.json`.

## README.md
Please read if you need more info: README.md
