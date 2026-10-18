import * as THREE from "three";
import {
  entranceTargetLabel,
  entranceThumbnail,
  findScene,
  isExternalPage,
  parseManifest,
  resolveAssetUrl,
  type Entrance,
  type Manifest,
  type Scene,
  type Vec3,
  type View,
} from "../core/manifest";
import { setupScene } from "./scene";
import { setupJoystick, setupSparkControls } from "./controls";
import { defaultFrameLoopOptions, setupFrameLoop } from "./frame-loop";
import { setupSplatView } from "./splat-view";
import { setupEntranceMarkers } from "./entrance-markers";
import { setupEntranceTooltip } from "./entrance-tooltip";
import { setupEntranceInteraction } from "./entrance-interaction";
import { setupMeshScreen } from "./mesh-screen";
import { setupOverlayScreens } from "./overlay-screens";
import { setupStatusOverlay } from "./status-overlay";
import { setupCollisionOverlay, setupVoxelOverlay } from "./collision-overlay";
import { setupDebugPanel } from "./debug-panel";
import { parseVoxelGrid } from "./voxel-grid";
import { setupWalker } from "./walk";
import { setupSidebar } from "./sidebar";
import { levelingRotation } from "./floor-align";
import { assertAssetAvailable } from "./asset-check";
import { captureExtension, captureFrame } from "./capture";

// Composition root of the web viewer: loads the manifest, shows the start
// scene and moves between scenes, the mesh screen and the web screen.
// No desktop-only APIs here, so an editor can reuse the same code as its preview.

const BASE_JOYSTICK_SPEED = 2.0;
// Hide the loading indicator even if the initial view shows no splats.
const LOADING_TIMEOUT_MS = 8000;
const DEBUG_UPDATE_MS = 500;
// Gliding to a viewpoint ("view" entrances): duration grows with distance.
const GLIDE_MIN_MS = 700;
const GLIDE_MAX_MS = 1800;
const GLIDE_MS_PER_UNIT = 250;

type Screen = "scene" | "mesh" | "web";

export interface TourOptions {
  canvas: HTMLCanvasElement;
  manifestUrl: string;
  debug: boolean;
  /** Scene to open instead of startSceneId (authoring aid). */
  startSceneId?: string;
}

async function fetchManifest(url: string): Promise<Manifest> {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    const hint =
      response.status === 404
        ? "\nツアーのフォルダで manifest_sample.json をコピーして manifest.json を作ってください。"
        : "";
    throw new Error(`manifest を読み込めません: ${url} (${response.status})${hint}`);
  }
  return parseManifest(await response.json());
}

export async function startTour({
  canvas,
  manifestUrl,
  debug: debugEnabled,
  startSceneId,
}: TourOptions): Promise<void> {
  const status = setupStatusOverlay(() => resetView());
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
  const meshScreen = setupMeshScreen(canvas, renderer);
  const debug = setupDebugPanel(debugEnabled, {
    onAlignStart: () => {
      alignPoints = [];
      debug.showAlignProgress(0);
    },
    onCapture: () => void saveCapture(),
    onCollisionFile: (file) => collisionOverlay.load(file),
    onCollisionOptions: (options) => collisionOverlay.setOptions(options),
    onVoxelFiles: async (json, bin) => {
      const grid = parseVoxelGrid(JSON.parse(await json.text()), await bin.arrayBuffer());
      walker.setGrid(grid, splatView.root);
      const mb = ((json.size + bin.size) / 1e6).toFixed(1);
      return `ボクセル ${grid.resolution} | ${mb} MB | 「歩く」で床の上を歩きます`;
    },
    onWalkSettings: (settings) => {
      walker.setOptions(settings);
      walker.setEnabled(settings.walking);
      showVoxels = settings.showVoxels;
      voxelCenter = null;
      if (!showVoxels) voxelOverlay.show(null, new THREE.Vector3());
      loop.invalidate();
    },
  });
  // Only used with ?debug=1; cleared when another scene loads.
  const collisionOverlay = setupCollisionOverlay(splatView.root, () => loop.invalidate());
  // ?debug=1 "歩いてみる": walking on voxel data picked in the panel.
  const walker = setupWalker({ eyeHeight: 1.6, radius: 0.25, stepHeight: 0.35, ignoreSpecks: true });
  // Where walking last stopped, shown with ?debug=1 "歩いてみる".
  const blockMarker = new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xff3b3b, depthTest: false, transparent: true, opacity: 0.8 }),
  );
  blockMarker.renderOrder = 1001;
  blockMarker.visible = false;
  scene.add(blockMarker);
  let shownBlock: ReturnType<typeof walker.blocked> = null;
  const voxelOverlay = setupVoxelOverlay(splatView.root, () => loop.invalidate());
  let showVoxels = false;
  // Scene-local point the shown voxels are around, refreshed as the camera moves.
  let voxelCenter: THREE.Vector3 | null = null;
  let lastTick = performance.now();
  const raycaster = new THREE.Raycaster();

  let screen: Screen = "scene";
  let current: Scene;
  try {
    current = findScene(manifest, startSceneId ?? manifest.startSceneId);
  } catch (err) {
    status.showError(err instanceof Error ? err.message : String(err));
    return;
  }
  let busy = false;
  // The view the current scene was entered with (initialView or an arrival).
  let entryView: View = { position: [0, 0, 0], yaw: 0, pitch: 0 };
  let loadStartedAt = 0;
  let loadingShown = false;
  // Floor points collected by the debug panel's floor alignment, or null.
  let alignPoints: Vec3[] | null = null;
  let lastDebugUpdate = 0;
  // The camera's glide to a viewpoint, while it lasts.
  let glide: {
    fromPosition: THREE.Vector3;
    fromQuaternion: THREE.Quaternion;
    toPosition: THREE.Vector3;
    toQuaternion: THREE.Quaternion;
    start: number;
    duration: number;
  } | null = null;
  const lastPosition = new THREE.Vector3(Infinity, 0, 0);
  const lastQuaternion = new THREE.Quaternion();

  const media = (entrance: Entrance) => {
    const thumbnail = entranceThumbnail(entrance);
    const { target } = entrance;
    // An external page is labelled with its site.
    const label =
      target.type === "url" && isExternalPage(target)
        ? new URL(target.url, window.location.href).host
        : entranceTargetLabel(manifest, entrance);
    return { thumbnail: thumbnail ? { url: assetUrl(thumbnail), label } : undefined };
  };
  const tooltip = setupEntranceTooltip({
    onOpen: (entrance) => void openEntrance(entrance),
    onHide: () => {
      interaction.releasePopup();
      loop.invalidate();
    },
  });
  const interaction = setupEntranceInteraction({
    canvas,
    camera,
    markers,
    tooltip,
    occluder: () => splatView.getMesh(),
    media,
    isEnabled: () => screen === "scene" && !busy,
    onActivate: (entrance) => void activate(entrance),
    onEmptyClick: (ndc) => {
      const mesh = splatView.getMesh();
      if (!debug.enabled || !mesh) {
        return;
      }
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObject(mesh, false)[0];
      const point = hit ? splatView.toLocal(hit.point) : null;
      debug.showPoint(point);
      if (alignPoints && point) {
        alignPoints.push(point);
        debug.showAlignProgress(alignPoints.length);
        if (alignPoints.length === 3) {
          finishFloorAlign(alignPoints as [Vec3, Vec3, Vec3]);
          alignPoints = null;
        }
      }
    },
    onChange: () => loop.invalidate(),
  });
  const overlays = setupOverlayScreens({ onBack: back });
  const sidebar = setupSidebar(manifest, {
    onScene: (sceneId) => void goToScene(sceneId),
    onEntrance: (sceneId, entrance) => {
      tooltip.hide();
      void openFromSidebar(sceneId, entrance);
    },
    onOpenChange: () => interaction.reset(),
    // Viewpoints have no icon in the scene: their description shows beside
    // their row in the table of contents instead.
    describes: (entrance) => entrance.target.type === "view",
    onDescribe: (entrance, row) => {
      interaction.releasePopup();
      tooltip.show(entrance, media(entrance));
      tooltip.placeBeside(row.getBoundingClientRect());
    },
    onDescribeEnd: () => tooltip.hideSoon(),
    isDescribing: (entrance) => tooltip.current() === entrance,
  });

  function setSplatControlsEnabled(enabled: boolean): void {
    controls.fpsMovement.enable = enabled;
    controls.pointerControls.enable = enabled;
  }

  function finishFloorAlign(points: [Vec3, Vec3, Vec3]): void {
    const rotation = levelingRotation(points, splatView.toLocal(camera.position));
    if (!rotation) {
      debug.showAlignResult(null);
      return;
    }
    // Keep the camera where it is in the scene while the scene turns under it.
    const view = splatView.currentView();
    splatView.setRotation(rotation);
    splatView.applyView({ ...view, pitch: 0 });
    const { scale } = current.transform;
    debug.showAlignResult(
      `"transform": ${JSON.stringify({ rotation, flipX: false, flipY: false, flipZ: false, scale })}`,
    );
    loop.invalidate();
  }

  // Debug panel: downloads the current view (or model) without the entrance
  // icons, sized for an entrance's thumbnail.
  async function saveCapture(): Promise<void> {
    if (screen === "web") {
      return;
    }
    const blob = await captureFrame(canvas, () => {
      if (screen === "mesh") {
        meshScreen.render();
        return;
      }
      markers.setVisible(false);
      renderer.render(scene, camera);
      markers.setVisible(true);
    });
    // Draw the icons again.
    loop.invalidate();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    // The time keeps captures of the same scene apart (e.g. one per entrance).
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    link.download = `${current.id}-${screen === "mesh" ? "model" : "view"}-${stamp}.${captureExtension(blob)}`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  }

  async function loadScene(sceneId: string, view: View): Promise<void> {
    busy = true;
    try {
      current = findScene(manifest, sceneId);
      entryView = view;
      alignPoints = null;
      glide = null;
      interaction.reset();
      markers.setEntrances([], 1);
      collisionOverlay.clear();
      walker.setGrid(null, null);
      showBlock(null);
      voxelOverlay.show(null, new THREE.Vector3());
      status.setTitles(manifest.title, current.title);
      sidebar.setCurrent(current.id);
      status.setLoading(true);
      loadingShown = true;
      loadStartedAt = performance.now();
      controls.fpsMovement.moveSpeed = baseMoveSpeed * current.camera.moveSpeed;

      const splatUrl = assetUrl(current.splat.url);
      await assertAssetAvailable(splatUrl);
      // The view is applied right after the transform, before the splat is
      // initialized, so streaming starts with the chunks around the arrival point.
      const loading = splatView.load(current, splatUrl);
      splatView.applyView(view);
      await loading;
      // Viewpoints have no icon; they are reached from the table of contents.
      markers.setEntrances(
        current.entrances.filter((e) => e.target.type !== "view"),
        current.transform.scale,
      );
    } catch (err) {
      status.showError(`「${current.title}」を読み込めません: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      busy = false;
      loop.invalidate();
    }
  }

  function resetView(): void {
    if (screen !== "scene" || busy) {
      return;
    }
    interaction.reset();
    glide = null;
    splatView.applyView(entryView);
    loop.invalidate();
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
    if (target.type === "view") {
      glideTo(target.view);
      return;
    }
    setSplatControlsEnabled(false);
    status.setResetVisible(false);
    if (target.type === "url") {
      screen = "web";
      overlays.showWeb(target.url, entrance.title);
      return;
    }
    screen = "mesh";
    overlays.showMesh(entrance.title);
    busy = true;
    status.setLoading(true);
    try {
      const meshUrl = assetUrl(target.url);
      await assertAssetAvailable(meshUrl);
      await meshScreen.open(meshUrl, target.exposure);
    } catch (err) {
      console.error(err);
      overlays.showMesh(`${entrance.title}（読み込めませんでした）`);
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
    status.setResetVisible(true);
    loop.invalidate();
  }

  // Moves the camera smoothly to a viewpoint of the current scene.
  function glideTo(view: View): void {
    const toPosition = splatView.root.localToWorld(new THREE.Vector3(...view.position));
    const toQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler((view.pitch * Math.PI) / 180, (view.yaw * Math.PI) / 180, 0, "YXZ"),
    );
    const distance = camera.position.distanceTo(toPosition);
    glide = {
      fromPosition: camera.position.clone(),
      fromQuaternion: camera.quaternion.clone(),
      toPosition,
      toQuaternion,
      start: performance.now(),
      duration: THREE.MathUtils.clamp(distance * GLIDE_MS_PER_UNIT, GLIDE_MIN_MS, GLIDE_MAX_MS),
    };
    loop.invalidate();
  }

  // "開く" in the popup, which may come from the table of contents and so
  // belong to another scene.
  async function openEntrance(entrance: Entrance): Promise<void> {
    sidebar.close();
    tooltip.hide();
    const scene = manifest.scenes.find((s) => s.entrances.includes(entrance));
    if (!scene || scene.id === current.id) {
      await activate(entrance);
    } else {
      await openFromSidebar(scene.id, entrance);
    }
  }

  // From the sidebar: a scene opens at its first view.
  async function goToScene(sceneId: string): Promise<void> {
    if (busy) {
      return;
    }
    back();
    const scene = findScene(manifest, sceneId);
    if (scene.id !== current.id) {
      await loadScene(scene.id, scene.initialView);
      return;
    }
    interaction.reset();
    entryView = scene.initialView;
    splatView.applyView(scene.initialView);
    loop.invalidate();
  }

  // From the sidebar: an entrance does what clicking its icon does. A model or
  // web page is opened from the scene the entrance is in, so "戻る" returns
  // there; a scene target is entered directly at its arrival view.
  async function openFromSidebar(sceneId: string, entrance: Entrance): Promise<void> {
    if (busy) {
      return;
    }
    back();
    const { target } = entrance;
    if (target.type === "view" && sceneId !== current.id) {
      // Open the other scene right at the viewpoint; "初期位置" stays its first view.
      const scene = findScene(manifest, sceneId);
      await loadScene(scene.id, target.view);
      entryView = scene.initialView;
      return;
    }
    if (target.type !== "scene" && sceneId !== current.id) {
      const scene = findScene(manifest, sceneId);
      await loadScene(scene.id, scene.initialView);
    }
    await activate(entrance);
  }

  function tickScene(): boolean {
    const now = performance.now();
    const dt = Math.min((now - lastTick) / 1000, 0.1);
    lastTick = now;
    let settling = false;
    const move = joystick.getMoveVector();
    const speed = BASE_JOYSTICK_SPEED * current.camera.moveSpeed;
    if (glide) {
      // Input waits until the glide ends; bounds are not applied meanwhile.
      const t = Math.min((performance.now() - glide.start) / glide.duration, 1);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      camera.position.lerpVectors(glide.fromPosition, glide.toPosition, eased);
      camera.quaternion.slerpQuaternions(glide.fromQuaternion, glide.toQuaternion, eased);
      if (t >= 1) {
        glide = null;
        // Spark's controls measure time since their last update.
        controls.sparkControls.lastTime = 0;
      }
    } else {
      const previous = camera.position.clone();
      controls.fpsMovement.extraMove.set(move.x * speed, 0, -move.y * speed);
      controls.update(camera);
      splatView.clampCamera(current.bounds);
      settling = walker.constrain(camera, previous, dt);
      if (walker.isEnabled() && walker.blocked() !== shownBlock) showBlock(walker.blocked());
    }
    if (showVoxels) updateVoxelOverlay();

    const moved =
      camera.position.distanceToSquared(lastPosition) > 1e-12 ||
      1 - Math.abs(camera.quaternion.dot(lastQuaternion)) > 1e-12;
    lastPosition.copy(camera.position);
    lastQuaternion.copy(camera.quaternion);
    // Cheap for a handful of coins, and covers hover changes too.
    markers.update(camera);
    if (moved) {
      interaction.updatePopupPosition();
    }

    const loading = splatView.isLoading() && performance.now() - loadStartedAt < LOADING_TIMEOUT_MS;
    if (loadingShown && !loading && !busy) {
      status.setLoading(false);
      loadingShown = false;
    }
    // activeSplats is not a change signal: the LoD varies it slightly on
    // every sort, which would keep a still view rendering forever.
    return moved || settling || busy || loading || splatView.isStreaming();
  }

  // ?debug=1: what stopped the last walking move (a red dot), to tell a real
  // obstacle from a floater or a hole in the scan.
  function showBlock(block: ReturnType<typeof walker.blocked>): void {
    shownBlock = block;
    blockMarker.visible = block !== null;
    if (!block) return;
    blockMarker.position.copy(block.point);
    blockMarker.scale.setScalar((walker.grid()?.resolution ?? 0.1) * splatView.root.scale.x * 0.8);
    debug.showWalkInfo(
      block.reason === "body"
        ? `止まった理由: 体に当たるボクセル（足元から ${block.height.toFixed(2)} の高さ、赤い点）`
        : "止まった理由: 進む先に、段差の高さ以内の床がない（床の穴・段差が高い・下り坂が急、赤い点）",
    );
  }

  // Redraws the voxels near the camera once it has moved a few voxels away.
  function updateVoxelOverlay(): void {
    const center = splatView.root.worldToLocal(camera.position.clone());
    if (voxelCenter && voxelCenter.distanceTo(center) < 0.5) return;
    voxelCenter = center;
    voxelOverlay.show(walker.grid(), center);
    const ground = walker.groundAt(camera.position);
    debug.showWalkInfo(
      ground === null ? "足元に床が見つかりません" : `足元の床 y=${ground.toFixed(2)}（目の高さまで ${(camera.position.y - ground).toFixed(2)}）`,
    );
  }

  function updateDebug(force: boolean): void {
    const now = performance.now();
    if (!debug.enabled || (!force && now - lastDebugUpdate < DEBUG_UPDATE_MS)) {
      return;
    }
    lastDebugUpdate = now;
    debug.update({
      sceneId: current.id,
      view: splatView.currentView(),
      fps: loop.getFps(),
      activeSplats: sparkRenderer.activeSplats,
      pixelRatio: renderer.getPixelRatio(),
      sleeping: loop.isSleeping(),
    });
  }

  const loop = setupFrameLoop(renderer, defaultFrameLoopOptions(), {
    tick() {
      let changed = false;
      if (screen === "scene") {
        changed = tickScene();
      } else if (screen === "mesh") {
        changed = meshScreen.update();
      }
      updateDebug(false);
      return changed;
    },
    render() {
      if (screen === "mesh") {
        meshScreen.render();
      } else if (screen === "scene") {
        renderer.render(scene, camera);
      }
    },
    onSleep: () => updateDebug(true),
    // Spark's controls measure time since their last update; after a sleep
    // that gap would turn a held key into a jump.
    onWake: () => {
      controls.sparkControls.lastTime = 0;
    },
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    if (sidebar.isOpen()) {
      sidebar.close();
    } else if (screen !== "scene") {
      back();
    } else {
      interaction.reset();
    }
  });

  await loadScene(current.id, current.initialView);
}
