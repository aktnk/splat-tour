import * as THREE from "three";
import {
  entranceTargetLabel,
  entranceThumbnail,
  findScene,
  isExternalPage,
  manifestWarnings,
  parseManifest,
  resolveAssetUrl,
  voxelBinPath,
  type Entrance,
  type Manifest,
  type Scene,
  type Vec3,
  type View,
} from "../core/manifest";
import { setupScene } from "./scene";
import { setupJoystick, setupSparkControls } from "./controls";
import { defaultFrameLoopOptions, setupFrameLoop } from "./frame-loop";
import { sceneMatrix, setupSplatView } from "./splat-view";
import { setupEntranceMarkers } from "./entrance-markers";
import { setupEntranceTooltip } from "./entrance-tooltip";
import { setupEntranceInteraction } from "./entrance-interaction";
import { setupMeshScreen } from "./mesh-screen";
import { setupOverlayScreens } from "./overlay-screens";
import { setupStatusOverlay } from "./status-overlay";
import { setupCollisionOverlay, setupVoxelOverlay } from "./collision-overlay";
import { setupDebugPanel } from "./debug-panel";
import { parseVoxelGrid } from "./voxel-grid";
import { setupWalker, type WalkOptions } from "./walk";
import { setupEyeLevelSwitch, setupMoveModeSwitch } from "./move-mode";
import { setupBarriers } from "./barriers";
import { setupSidebar } from "./sidebar";
import { setupSceneTransition } from "./scene-transition";
import { setupPrefetch } from "./prefetch";
import { setupFloorCursor } from "./floor-cursor";
import { levelingRotation } from "./floor-align";
import { assertAssetAvailable } from "./asset-check";
import { captureExtension, captureFrame } from "./capture";

// Composition root of the web viewer: loads the manifest, shows the start
// scene and moves between scenes, the mesh screen and the web screen.
// No desktop-only APIs here, so an editor can reuse the same code as its preview.

const BASE_JOYSTICK_SPEED = 2.0;
// The look stick (touch screens), at full tilt (radians per second); the
// rate grows with the square of the tilt, so a small tilt turns slowly.
const LOOK_YAW_SPEED = (60 * Math.PI) / 180;
const LOOK_PITCH_SPEED = (40 * Math.PI) / 180;
const MAX_PITCH = (85 * Math.PI) / 180;
// For voxels tried with ?debug=1 "歩いてみる" (a scene's walk settings have their own).
const CHILD_EYE_HEIGHT = 1.1;
const JUMP_HEIGHT = 0.5;
// Hide the loading indicator even if the initial view shows no splats.
// The first chunk of a streamed splat can take a while on a slow network.
const LOADING_TIMEOUT_MS = 30000;
const DEBUG_UPDATE_MS = 500;
// Gliding to a viewpoint ("view" entrances): duration grows with distance.
const GLIDE_MIN_MS = 700;
const GLIDE_MAX_MS = 1800;
const GLIDE_MS_PER_UNIT = 250;
/** From the table of contents, the camera stops this far in front of an icon (world units), near enough for the medal. */
const APPROACH_DISTANCE = 1.8;
/** Within this distance of an entrance to another scene (world units), that scene starts loading ahead. */
const PREFETCH_DISTANCE = 6;
const PREFETCH_CHECK_MS = 500;
/** Clicking a spot: the farthest it reaches (world units). */
const CLICK_MOVE_MAX = 60;
/** Walking to a clicked spot: it stands this far back from what the ray hit (world units), off a wall. */
const CLICK_BACK_OFF = 0.3;
/** Walking to a clicked spot: close enough (world units). */
const CLICK_ARRIVE = 0.1;
/** Walking to a clicked spot: the turn towards it at the start (ms). */
const CLICK_TURN_MS = 400;
/** Walking to a clicked spot: stopped by a wall for this long ends it (ms). */
const CLICK_STUCK_MS = 300;
/** Flying to a clicked spot: stop this far before it (world units). */
const CLICK_FLY_STOP = 1.0;
/** Mouse wheel: metres per pixel of scroll, and the fastest it is walked (times the move speed). */
const WHEEL_M_PER_PX = 0.005;
const WHEEL_SPEED_FACTOR = 2;

type Screen = "scene" | "mesh" | "web";

export interface TourOptions {
  canvas: HTMLCanvasElement;
  manifestUrl: string;
  debug: boolean;
  /** Scene to open instead of startSceneId (authoring aid). */
  startSceneId?: string;
}

/** The manifest, and the fields of the file it does not use (see manifestWarnings). */
async function fetchManifest(url: string): Promise<{ manifest: Manifest; warnings: string[] }> {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    const hint =
      response.status === 404
        ? "\nツアーのフォルダで manifest_sample.json をコピーして manifest.json を作ってください。"
        : "";
    throw new Error(`manifest を読み込めません: ${url} (${response.status})${hint}`);
  }
  const json: unknown = await response.json();
  return { manifest: parseManifest(json), warnings: manifestWarnings(json) };
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
  let manifestNotes: string[];
  try {
    ({ manifest, warnings: manifestNotes } = await fetchManifest(absoluteManifestUrl));
  } catch (err) {
    status.showError(err instanceof Error ? err.message : String(err));
    return;
  }
  const assetUrl = (path: string) => resolveAssetUrl(manifest, absoluteManifestUrl, path);

  const { scene, camera, renderer, sparkRenderer } = setupScene(canvas);
  const transition = setupSceneTransition(renderer.domElement);
  const controls = setupSparkControls(canvas);
  const joystick = setupJoystick(document.getElementById("joystick-zone") as HTMLElement);
  // Right stick on touch screens: turns the view while held.
  const lookStick = setupJoystick(document.getElementById("look-zone") as HTMLElement);
  const lookEuler = new THREE.Euler(0, 0, 0, "YXZ");
  const baseMoveSpeed = controls.fpsMovement.moveSpeed;
  const splatView = setupSplatView(scene, camera, sparkRenderer);
  const markers = setupEntranceMarkers(splatView.root, { renderer });
  // Invisible walls at entrances (drawn with ?debug=1).
  const barriers = setupBarriers(scene);
  barriers.setVisible(debugEnabled);
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
      moveMode.setAvailable(true);
      const mb = ((json.size + bin.size) / 1e6).toFixed(1);
      return `ボクセル ${grid.resolution} | ${mb} MB | 「歩く」で床の上を歩きます`;
    },
    onWalkSettings: (settings) => {
      walkBase = { ...settings, childEyeHeight: CHILD_EYE_HEIGHT, jumpHeight: JUMP_HEIGHT };
      applyEyeLevel();
      walker.setEnabled(settings.walking);
      moveMode.setMode(walker.isEnabled() ? "walk" : "fly");
      updateWalkControls();
      showVoxels = settings.showVoxels;
      voxelCenter = null;
      if (!showVoxels) voxelOverlay.show(null, new THREE.Vector3());
      loop.invalidate();
    },
  });
  // Fields the viewer ignores (often misspelt): in the console, and on the debug panel.
  for (const note of manifestNotes) console.warn(`manifest.json: ${note}`);
  debug.showWarnings(manifestNotes);
  // Only used with ?debug=1; cleared when another scene loads.
  const collisionOverlay = setupCollisionOverlay(splatView.root, () => loop.invalidate());
  // ?debug=1 "歩いてみる": walking on voxel data picked in the panel.
  // Walking: the scene's walk settings, or voxels tried with ?debug=1 "歩いてみる".
  const walker = setupWalker({ eyeHeight: 1.6, radius: 0.2, stepHeight: 0.35, jumpHeight: JUMP_HEIGHT, ignoreSpecks: true });
  // The invisible walls stop the walking body as the scan's voxels do.
  walker.setBodyObstacle((x, y, z) => barriers.bodyBlocked(x, y, z));
  // The walking settings in use (the scene's, or the debug panel's), before the eye level applies.
  let walkBase: (WalkOptions & { childEyeHeight: number }) | null = null;
  const moveMode = setupMoveModeSwitch((mode) => {
    walker.setEnabled(mode === "walk");
    updateWalkControls();
    loop.invalidate();
  });
  const eyeLevel = setupEyeLevelSwitch(() => {
    applyEyeLevel();
    // The eye eases to the new height.
    loop.invalidate();
  });
  const jumpButton = document.getElementById("jump-btn") as HTMLButtonElement;
  // On pointerdown, not click: with a thumb on the move stick, phones may
  // not send a click for a second finger's tap.
  jumpButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    jump();
  });
  // Space after a click must not press it again (a pointerdown did the jump).
  jumpButton.addEventListener("click", () => jumpButton.blur());

  function applyEyeLevel(): void {
    if (!walkBase) return;
    const eyeHeight = eyeLevel.level() === "child" ? walkBase.childEyeHeight : walkBase.eyeHeight;
    walker.setOptions({ ...walkBase, eyeHeight });
  }

  /** "大人 / 子ども" and the jump button, while walking. */
  function updateWalkControls(): void {
    const walking = walker.isEnabled();
    eyeLevel.setAvailable(walking);
    jumpButton.hidden = !walking || (walkBase?.jumpHeight ?? 0) <= 0;
  }

  function jump(): void {
    if (screen !== "scene" || glide || !walker.isEnabled()) return;
    walker.jump();
    loop.invalidate();
  }
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
  // Clicking (tapping) a spot to go there: walking along the floor, or a
  // glide when flying; the ring shows where a click would walk to.
  const floorCursor = setupFloorCursor(scene);
  let autoWalk: {
    target: THREE.Vector3;
    turnFrom: THREE.Quaternion;
    turnTo: THREE.Quaternion;
    start: number;
    turned: boolean;
    stuckSince: number | null;
  } | null = null;
  // Mouse wheel: distance still to walk (or fly) forward (negative: back).
  let pendingWheel = 0;
  let lastMouse: THREE.Vector2 | null = null;
  let hoverQueued = false;

  let screen: Screen = "scene";
  /** The screen shown; the 3DGS scene's own controls (sticks, jump, walk switches) hide on the others (style.css). */
  function setScreen(next: Screen): void {
    screen = next;
    document.body.dataset.screen = next;
  }
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

  const prefetch = setupPrefetch();
  // Starts loading the scene an entrance leads to (its popup shows, or the visitor is near).
  const prefetchTarget = (entrance: Entrance) => {
    const { target } = entrance;
    if (target.type !== "scene") return;
    const next = manifest.scenes.find((s) => s.id === target.sceneId);
    if (next && next !== current) prefetch.splat(assetUrl(next.splat.url));
  };
  let lastPrefetchCheck = 0;
  const media = (entrance: Entrance) => {
    prefetchTarget(entrance);
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
    onEmptyClick: (ndc, event) => {
      const mesh = splatView.getMesh();
      if (!debug.enabled || !mesh) {
        clickMove(ndc);
        return;
      }
      // ?debug=1: a click reads the point; Shift+click goes there.
      if (event.shiftKey && !alignPoints) {
        clickMove(ndc);
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
    // Keep the scene being left on screen until the next one draws something.
    if (splatView.getMesh() && screen === "scene") transition.hold(() => renderer.render(scene, camera));
    try {
      current = findScene(manifest, sceneId);
      entryView = view;
      alignPoints = null;
      glide = null;
      interaction.reset();
      markers.setEntrances([], 1);
      markers.setGround(null);
      barriers.setScene(null, splatView.root);
      barriers.setGround(null);
      collisionOverlay.clear();
      walker.setGrid(null, null);
      walkBase = null;
      moveMode.setAvailable(false);
      updateWalkControls();
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
      barriers.setScene(current, splatView.root);
      if (current.walk) void loadWalk(current);
    } catch (err) {
      transition.reveal();
      status.showError(`「${current.title}」を読み込めません: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      busy = false;
      loop.invalidate();
    }
  }

  // The scene's collision voxels, loaded after its splat; until then (or if
  // they cannot be read) the scene is flown as without walk settings.
  async function loadWalk(s: Scene): Promise<void> {
    const settings = s.walk;
    if (!settings) return;
    try {
      const [meta, bin] = await Promise.all([
        fetch(assetUrl(settings.voxels)).then((r) => {
          if (!r.ok) throw new Error(`${settings.voxels}: ${r.status}`);
          return r.json();
        }),
        fetch(assetUrl(voxelBinPath(settings.voxels))).then((r) => {
          if (!r.ok) throw new Error(`${voxelBinPath(settings.voxels)}: ${r.status}`);
          return r.arrayBuffer();
        }),
      ]);
      if (current !== s) return;
      walker.setGrid(parseVoxelGrid(meta, bin), splatView.root);
      // Coin shadows fall, and entrance walls stand, on the floor the voxels know.
      markers.setGround((point) => walker.groundAt(point));
      barriers.setGround((point) => walker.groundAt(point));
      walkBase = { ...settings, ignoreSpecks: true };
      applyEyeLevel();
      walker.setEnabled(settings.start === "walk");
      // The view the scene opened at keeps its height until the visitor moves.
      walker.hold();
      moveMode.setMode(settings.start);
      moveMode.setAvailable(true);
      updateWalkControls();
      loop.invalidate();
    } catch (err) {
      console.warn(`「${s.title}」の歩行用データを読めませんでした（飛んで移動します）:`, err);
    }
  }

  function resetView(): void {
    if (screen !== "scene" || busy) {
      return;
    }
    interaction.reset();
    glide = null;
    splatView.applyView(entryView);
    walker.hold();
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
      setScreen("web");
      overlays.showWeb(target.url, entrance.title);
      return;
    }
    setScreen("mesh");
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
    setScreen("scene");
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
      return;
    }
    if (busy) {
      return;
    }
    back();
    if (entrance.target.type === "view") {
      await openFromSidebar(scene.id, entrance);
      return;
    }
    // A model or web page is opened from the scene it is in, so "戻る"
    // returns there; a scene target is entered directly at its arrival view.
    if (entrance.target.type !== "scene") await loadScene(scene.id, scene.initialView);
    await activate(entrance);
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
    walker.hold();
    loop.invalidate();
  }

  // A view in front of an entrance's icon, facing it: from the side visitors
  // come from (its wall's direction, else from where the camera is, or from
  // the scene's first view in another scene), at the icon's height.
  function approachView(scene: Scene, entrance: Entrance): View {
    const matrix = scene.id === current.id ? splatView.root.matrixWorld : sceneMatrix(scene);
    const icon = new THREE.Vector3(...entrance.position).applyMatrix4(matrix);
    let dx: number;
    let dz: number;
    if (entrance.barrier && entrance.barrier.yaw !== undefined) {
      // A camera with this yaw looks along (-sin, -cos).
      dx = -Math.sin((entrance.barrier.yaw * Math.PI) / 180);
      dz = -Math.cos((entrance.barrier.yaw * Math.PI) / 180);
    } else {
      const from =
        scene.id === current.id ? camera.position : new THREE.Vector3(...scene.initialView.position).applyMatrix4(matrix);
      dx = icon.x - from.x;
      dz = icon.z - from.z;
      if (Math.hypot(dx, dz) < 1e-3) {
        // Standing at the icon: keep facing the way the camera (or the first view) does.
        const yaw =
          scene.id === current.id
            ? new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ").y
            : (scene.initialView.yaw * Math.PI) / 180;
        dx = -Math.sin(yaw);
        dz = -Math.cos(yaw);
      }
    }
    const length = Math.hypot(dx, dz);
    dx /= length;
    dz /= length;
    const stand = new THREE.Vector3(icon.x - dx * APPROACH_DISTANCE, icon.y, icon.z - dz * APPROACH_DISTANCE);
    return {
      position: stand.applyMatrix4(matrix.clone().invert()).toArray() as Vec3,
      yaw: (Math.atan2(-dx, -dz) * 180) / Math.PI,
      pitch: 0,
    };
  }

  // From the sidebar: a viewpoint is gone to; for any other entrance the
  // camera goes in front of its icon (in its scene), where its popup and
  // "開く" are, rather than opening it at once.
  async function openFromSidebar(sceneId: string, entrance: Entrance): Promise<void> {
    if (busy) {
      return;
    }
    back();
    const scene = findScene(manifest, sceneId);
    const view = entrance.target.type === "view" ? entrance.target.view : approachView(scene, entrance);
    if (sceneId !== current.id) {
      // Open the other scene right there; "初期位置" stays its first view.
      await loadScene(scene.id, view);
      entryView = scene.initialView;
      return;
    }
    interaction.reset();
    glideTo(view);
  }

  /** Where clicking at a screen point goes: a floor spot to walk to, or a surface to fly towards. */
  function clickTarget(ndc: THREE.Vector2): { point: THREE.Vector3; walk: boolean } | null {
    raycaster.setFromCamera(ndc, camera);
    const { origin, direction } = raycaster.ray;
    if (walker.isEnabled()) {
      const hit = walker.raycast(origin, direction, CLICK_MOVE_MAX);
      if (!hit) return null;
      // A little back along the ray, so a wall's spot is the floor in front of it.
      const from = hit.clone().addScaledVector(direction, -CLICK_BACK_OFF);
      const ground = walker.groundAt(from);
      return ground === null ? null : { point: new THREE.Vector3(from.x, ground, from.z), walk: true };
    }
    const mesh = splatView.getMesh();
    if (!mesh) return null;
    const hit = raycaster.intersectObject(mesh, false)[0];
    return hit && hit.distance <= CLICK_MOVE_MAX ? { point: hit.point.clone(), walk: false } : null;
  }

  function stopClickMove(): void {
    autoWalk = null;
    pendingWheel = 0;
  }

  // Goes to a clicked spot: walks there facing the way it goes, or flies there.
  function clickMove(ndc: THREE.Vector2): void {
    if (screen !== "scene" || busy || glide) return;
    const target = clickTarget(ndc);
    if (!target) return;
    stopClickMove();
    const dx = target.point.x - camera.position.x;
    const dz = target.point.z - camera.position.z;
    const horizontal = Math.hypot(dx, dz);
    if (target.walk) {
      if (horizontal < CLICK_ARRIVE * 2) return;
      floorCursor.set(target.point);
      autoWalk = {
        target: target.point,
        turnFrom: camera.quaternion.clone(),
        // Facing the way it walks, looking ahead.
        turnTo: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(-dx, -dz), 0, "YXZ")),
        start: performance.now(),
        turned: false,
        stuckSince: null,
      };
    } else {
      const along = target.point.clone().sub(camera.position);
      const length = along.length();
      if (length <= CLICK_FLY_STOP + 0.1) return;
      const end = camera.position.clone().addScaledVector(along, (length - CLICK_FLY_STOP) / length);
      // Not through an invisible wall.
      barriers.constrain(camera.position.clone(), end);
      floorCursor.set(null);
      glideTo({
        position: splatView.toLocal(end),
        yaw: (Math.atan2(-along.x, -along.z) * 180) / Math.PI,
        pitch: (Math.atan2(along.y, horizontal) * 180) / Math.PI,
      });
    }
    loop.invalidate();
  }

  // The ring under the mouse (walking only: the voxels are cheap to hit, the splat is not).
  function updateHover(): void {
    hoverQueued = false;
    const over = lastMouse !== null && screen === "scene" && !busy && walker.isEnabled() && !autoWalk;
    // Over an entrance's icon, a click opens it instead (the interaction sets the pointer cursor).
    const target = over && canvas.style.cursor !== "pointer" ? clickTarget(lastMouse as THREE.Vector2) : null;
    if (!autoWalk) floorCursor.set(target?.point ?? null);
    loop.invalidate();
  }
  function queueHover(): void {
    if (hoverQueued) return;
    hoverQueued = true;
    requestAnimationFrame(updateHover);
  }
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse" || event.buttons !== 0) return;
    const rect = canvas.getBoundingClientRect();
    lastMouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    queueHover();
  });
  canvas.addEventListener("pointerleave", () => {
    lastMouse = null;
    queueHover();
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      if (screen !== "scene" || busy || glide) return;
      event.preventDefault();
      autoWalk = null;
      const pixels = event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1);
      pendingWheel -= pixels * WHEEL_M_PER_PX;
      loop.invalidate();
    },
    { passive: false },
  );
  document.addEventListener("keydown", (event) => {
    const { keycodeMoveMapping, keycodeRotateMapping } = controls.fpsMovement;
    if (keycodeMoveMapping[event.code] || keycodeRotateMapping[event.code]) stopClickMove();
  });

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
        // Walking, the eye stays at the viewpoint's height until the visitor moves.
        walker.hold();
        // Spark's controls measure time since their last update.
        controls.sparkControls.lastTime = 0;
      }
    } else {
      const previous = camera.position.clone();
      const look = lookStick.getMoveVector();
      if (look.x !== 0 || look.y !== 0) {
        lookEuler.setFromQuaternion(camera.quaternion, "YXZ");
        lookEuler.y -= look.x * Math.abs(look.x) * LOOK_YAW_SPEED * dt;
        lookEuler.x = Math.min(
          Math.max(lookEuler.x + look.y * Math.abs(look.y) * LOOK_PITCH_SPEED * dt, -MAX_PITCH),
          MAX_PITCH,
        );
        lookEuler.z = 0;
        camera.quaternion.setFromEuler(lookEuler);
      }
      if (move.x !== 0 || move.y !== 0) stopClickMove();
      const walkSpeed = controls.fpsMovement.moveSpeed;
      let clickStep = 0;
      if (autoWalk) {
        // Turns to face the way it goes; afterwards looking around is free.
        if (!autoWalk.turned) {
          const t = Math.min((now - autoWalk.start) / CLICK_TURN_MS, 1);
          camera.quaternion.slerpQuaternions(autoWalk.turnFrom, autoWalk.turnTo, 1 - (1 - t) * (1 - t));
          autoWalk.turned = t >= 1;
        }
        const dx = autoWalk.target.x - camera.position.x;
        const dz = autoWalk.target.z - camera.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance < CLICK_ARRIVE) {
          autoWalk = null;
          floorCursor.set(null);
        } else {
          clickStep = Math.min(distance, walkSpeed * dt);
          camera.position.x += (dx / distance) * clickStep;
          camera.position.z += (dz / distance) * clickStep;
        }
      }
      if (pendingWheel !== 0) {
        const step = Math.sign(pendingWheel) * Math.min(Math.abs(pendingWheel), walkSpeed * WHEEL_SPEED_FACTOR * dt);
        const forward = camera.getWorldDirection(new THREE.Vector3());
        if (walker.isEnabled()) forward.setY(0).normalize();
        camera.position.addScaledVector(forward, step);
        pendingWheel -= step;
      }
      controls.fpsMovement.extraMove.set(move.x * speed, 0, -move.y * speed);
      controls.update(camera);
      splatView.clampCamera(current.bounds);
      // Walking meets the walls as part of the collision (walk.ts); flying, as unlimited walls.
      if (!walker.isEnabled()) barriers.constrain(previous, camera.position);
      settling = walker.constrain(camera, previous, dt);
      if (walker.isEnabled() && walker.blocked() !== shownBlock) showBlock(walker.blocked());
      if (autoWalk && clickStep > 0) {
        // Stopped by a wall (no real progress for a moment): give up there.
        const progressed = Math.hypot(camera.position.x - previous.x, camera.position.z - previous.z) > clickStep * 0.3;
        if (progressed) autoWalk.stuckSince = null;
        else if (autoWalk.stuckSince === null) autoWalk.stuckSince = now;
        else if (now - autoWalk.stuckSince > CLICK_STUCK_MS) {
          autoWalk = null;
          floorCursor.set(null);
        }
      }
      // A wheel step that went nowhere (a wall) is not kept for later.
      if (pendingWheel !== 0 && camera.position.distanceToSquared(previous) < 1e-10) pendingWheel = 0;
    }
    if (showVoxels) updateVoxelOverlay();

    const moved =
      camera.position.distanceToSquared(lastPosition) > 1e-12 ||
      1 - Math.abs(camera.quaternion.dot(lastQuaternion)) > 1e-12;
    lastPosition.copy(camera.position);
    lastQuaternion.copy(camera.quaternion);
    // Cheap for a handful of coins, and covers hover changes too.
    markers.update(camera);
    if (!busy && performance.now() - lastPrefetchCheck > PREFETCH_CHECK_MS) {
      lastPrefetchCheck = performance.now();
      for (const e of current.entrances) {
        if (e.target.type !== "scene") continue;
        const at = splatView.root.localToWorld(new THREE.Vector3(...e.position));
        if (at.distanceTo(camera.position) < PREFETCH_DISTANCE) prefetchTarget(e);
      }
    }
    if (moved) {
      interaction.updatePopupPosition();
    }

    const loading = splatView.isLoading() && performance.now() - loadStartedAt < LOADING_TIMEOUT_MS;
    if (loadingShown && !loading && !busy) {
      status.setLoading(false);
      loadingShown = false;
      // The next scene draws its first, coarse level: fade the last one out over it.
      transition.reveal();
    }
    // activeSplats is not a change signal: the LoD varies it slightly on
    // every sort, which would keep a still view rendering forever.
    if (moved && lastMouse && !autoWalk) queueHover();
    return moved || settling || busy || loading || splatView.isStreaming() || autoWalk !== null || pendingWheel !== 0;
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
    if (event.code === "Space" && !event.repeat) {
      const t = event.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      if (t instanceof HTMLButtonElement || t instanceof HTMLAnchorElement) return;
      if (walker.isEnabled() && screen === "scene") {
        event.preventDefault();
        jump();
      }
      return;
    }
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
