import * as THREE from "three";
import {
  findScene,
  parseManifest,
  resolveAssetUrl,
  type Entrance,
  type Manifest,
  type Scene,
  type View,
} from "../core/manifest";
import { setupScene } from "../scene";
import { setupJoystick, setupSparkControls } from "../controls";
import { defaultFrameLoopOptions, setupFrameLoop } from "./frame-loop";
import { setupSplatView } from "./splat-view";
import { setupEntranceMarkers } from "./entrance-markers";
import { setupEntranceTooltip } from "./entrance-tooltip";
import { setupEntranceInteraction } from "./entrance-interaction";
import { setupMeshScreen } from "./mesh-screen";
import { setupOverlayScreens } from "./overlay-screens";
import { setupStatusOverlay } from "./status-overlay";
import { setupDebugPanel } from "./debug-panel";

// Composition root of the web viewer: loads the manifest, shows the start
// scene and moves between scenes, the mesh screen and the web screen.
// No Tauri APIs here, so the same code can run as the editor's preview.

const BASE_JOYSTICK_SPEED = 2.0;
// Hide the loading indicator even if the initial view shows no splats.
const LOADING_TIMEOUT_MS = 8000;
const DEBUG_UPDATE_MS = 500;

type Screen = "scene" | "mesh" | "web";

export interface TourOptions {
  canvas: HTMLCanvasElement;
  manifestUrl: string;
  debug: boolean;
}

async function fetchManifest(url: string): Promise<Manifest> {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`manifest を読み込めません: ${url} (${response.status})`);
  }
  return parseManifest(await response.json());
}

export async function startTour({ canvas, manifestUrl, debug: debugEnabled }: TourOptions): Promise<void> {
  const status = setupStatusOverlay();
  const absoluteManifestUrl = new URL(manifestUrl, window.location.href).href;
  let manifest: Manifest;
  try {
    manifest = await fetchManifest(absoluteManifestUrl);
  } catch (err) {
    status.showError(err instanceof Error ? err.message : String(err));
    return;
  }
  const assetUrl = (path: string) => resolveAssetUrl(manifest, absoluteManifestUrl, path);

  const { scene, camera, renderer, sparkRenderer } = setupScene(canvas);
  const controls = setupSparkControls(canvas);
  const joystick = setupJoystick(document.getElementById("joystick-zone") as HTMLElement);
  const baseMoveSpeed = controls.fpsMovement.moveSpeed;
  const splatView = setupSplatView(scene, camera, sparkRenderer);
  const markers = setupEntranceMarkers(splatView.root);
  const meshScreen = setupMeshScreen(canvas);
  const debug = setupDebugPanel(debugEnabled);
  const raycaster = new THREE.Raycaster();

  let screen: Screen = "scene";
  let current: Scene = findScene(manifest, manifest.startSceneId);
  let busy = false;
  let loadStartedAt = 0;
  let loadingShown = false;
  let lastActiveSplats = -1;
  let lastDebugUpdate = 0;
  const lastPosition = new THREE.Vector3(Infinity, 0, 0);
  const lastQuaternion = new THREE.Quaternion();

  const tooltip = setupEntranceTooltip((entrance) => void activate(entrance));
  const interaction = setupEntranceInteraction({
    canvas,
    camera,
    markers,
    tooltip,
    imageUrl: (entrance) => (entrance.image ? assetUrl(entrance.image) : undefined),
    isEnabled: () => screen === "scene" && !busy,
    onActivate: (entrance) => void activate(entrance),
    onEmptyClick: (ndc) => {
      const mesh = splatView.getMesh();
      if (!debug.enabled || !mesh) {
        return;
      }
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObject(mesh, false)[0];
      debug.showPoint(hit ? splatView.toLocal(hit.point) : null);
    },
    onChange: () => loop.invalidate(),
  });
  const overlays = setupOverlayScreens({ onBack: back, onExit: () => void exit() });

  function setSplatControlsEnabled(enabled: boolean): void {
    controls.fpsMovement.enable = enabled;
    controls.pointerControls.enable = enabled;
  }

  async function loadScene(sceneId: string, view: View): Promise<void> {
    busy = true;
    try {
      current = findScene(manifest, sceneId);
      interaction.reset();
      markers.setEntrances([], 1);
      status.setTitles(manifest.title, current.title);
      status.setLoading(true);
      loadingShown = true;
      loadStartedAt = performance.now();
      controls.fpsMovement.moveSpeed = baseMoveSpeed * current.camera.moveSpeed;

      // The view is applied right after the transform, before the splat is
      // initialized, so streaming starts with the chunks around the arrival point.
      const loading = splatView.load(current, assetUrl(current.splat.url));
      splatView.applyView(view);
      await loading;
      markers.setEntrances(current.entrances, current.transform.scale);
    } catch (err) {
      status.showError(`「${current.title}」を読み込めません: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      busy = false;
      loop.invalidate();
    }
  }

  async function activate(entrance: Entrance): Promise<void> {
    if (busy || screen !== "scene") {
      return;
    }
    interaction.reset();
    const { target } = entrance;
    if (target.type === "scene") {
      await loadScene(target.sceneId, target.arrival);
      return;
    }
    setSplatControlsEnabled(false);
    if (target.type === "url") {
      screen = "web";
      overlays.showWeb(target.url, entrance.title);
      return;
    }
    screen = "mesh";
    overlays.showBar(entrance.title);
    busy = true;
    status.setLoading(true);
    try {
      await meshScreen.open(assetUrl(target.url));
    } catch (err) {
      console.error(err);
      overlays.showBar(`${entrance.title}（読み込めませんでした）`);
    } finally {
      busy = false;
      status.setLoading(false);
      loop.invalidate();
    }
  }

  // Back to the scene the entrance was opened from, at the same view.
  function back(): void {
    if (screen === "scene") {
      return;
    }
    meshScreen.close();
    overlays.hide();
    screen = "scene";
    setSplatControlsEnabled(true);
    loop.invalidate();
  }

  // Back to the start of the tour.
  async function exit(): Promise<void> {
    back();
    const start = findScene(manifest, manifest.startSceneId);
    if (current.id !== start.id) {
      await loadScene(start.id, start.initialView);
    } else {
      interaction.reset();
      splatView.applyView(start.initialView);
    }
  }

  function tickScene(): boolean {
    const move = joystick.getMoveVector();
    const speed = BASE_JOYSTICK_SPEED * current.camera.moveSpeed;
    controls.fpsMovement.extraMove.set(move.x * speed, 0, -move.y * speed);
    controls.update(camera);

    const moved =
      camera.position.distanceToSquared(lastPosition) > 1e-12 ||
      1 - Math.abs(camera.quaternion.dot(lastQuaternion)) > 1e-12;
    lastPosition.copy(camera.position);
    lastQuaternion.copy(camera.quaternion);
    if (moved) {
      interaction.updatePopupPosition();
    }

    const loading = splatView.isLoading() && performance.now() - loadStartedAt < LOADING_TIMEOUT_MS;
    if (loadingShown && !loading && !busy) {
      status.setLoading(false);
      loadingShown = false;
    }
    const splatsChanged = sparkRenderer.activeSplats !== lastActiveSplats;
    lastActiveSplats = sparkRenderer.activeSplats;
    return moved || busy || loading || splatsChanged || splatView.isStreaming();
  }

  const loop = setupFrameLoop(
    renderer,
    defaultFrameLoopOptions(),
    () => {
      let changed = false;
      if (screen === "scene") {
        changed = tickScene();
      } else if (screen === "mesh") {
        changed = meshScreen.update();
      }
      const now = performance.now();
      if (debug.enabled && now - lastDebugUpdate > DEBUG_UPDATE_MS) {
        lastDebugUpdate = now;
        debug.update({
          sceneId: current.id,
          view: splatView.currentView(),
          fps: loop.getFps(),
          activeSplats: sparkRenderer.activeSplats,
          pixelRatio: renderer.getPixelRatio(),
        });
      }
      return changed;
    },
    () => {
      if (screen === "mesh") {
        renderer.render(meshScreen.scene, meshScreen.camera);
      } else if (screen === "scene") {
        renderer.render(scene, camera);
      }
    },
  );

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    if (screen !== "scene") {
      back();
    } else {
      interaction.reset();
    }
  });

  await loadScene(current.id, current.initialView);
}
