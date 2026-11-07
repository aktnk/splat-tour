import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Entrance } from "../core/manifest";

// One coin-shaped icon per entrance, placed under the scene root so it
// follows the scene transform. The coins are opaque and depth-tested, so the
// splats of a wall in front (Spark draws splats depth-tested, blended over
// opaque geometry) hide them; picking skips coins behind splats as well.
// Each coin turns towards the camera with a slight fixed tilt so its rim
// shows, and sits a little in front of its anchor so it does not sink into
// the surface it was placed on.
//
// Size: farther coins look smaller, as real objects do, but less steeply
// (DEPTH_FALLOFF < 1) and only between a minimum and a maximum size, so a
// far coin stays easy to click and a near one does not fill the screen.
// A constant screen size looked wrong: a far coin appeared as large as a
// near one. Sizes are angular (fractions of the view depth): the coin's
// diameter is about ICON_SIZE / (2 tan(fov / 2)) of the view height at
// REFERENCE_DEPTH. The depth is measured along the view direction, which is
// what the perspective projection divides by, so the size does not change
// with the position on screen.

const ICON_SIZE = 0.07; // coin diameter as a fraction of the view depth, at REFERENCE_DEPTH
const REFERENCE_DEPTH = 3; // scene units (after the scene scale)
const DEPTH_FALLOFF = 0.6; // 0: constant screen size, 1: fixed size in the scene
const MIN_ICON_SIZE = 0.035; // smallest, for far coins
const MAX_ICON_SIZE = 0.12; // largest, for near coins
const THICKNESS = 0.22; // rim depth relative to the diameter
const HOVER_SCALE = 1.25;
const YAW_TILT = (18 * Math.PI) / 180; // shows the rim when viewed head-on
const PITCH_FOLLOW = 0.75; // how far the coin tips towards a camera above/below
const LIFT = 0.06; // offset towards the camera, as a fraction of the distance
// Coins closer than this (world units) are hidden: a coin the camera stands
// at would fill the view.
const NEAR_HIDE = 0.25;

type IconKind = "entrance" | "exit" | "mesh" | "url" | "view";

// Look: far away a coin is a small glowing pearl in its kind's colour; within
// DOT_NEAR (or hovered) it becomes a medal: calm enamel in a gold bezel,
// lit by a room environment (as the model screen) so it does not look
// pasted onto the photographic scene. In scenes with walk voxels it casts a
// soft shadow on the floor below. Without a renderer (no environment light)
// the plain unlit coin is drawn instead.
// Calmer colours for the medal and the pearl: the kind still shows, without the
// signal-bright look against a photographic scene.
const CALM_COLOR: Record<IconKind, string> = {
  entrance: "#2d5b8c",
  exit: "#a3602a",
  mesh: "#2c7650",
  url: "#664a96",
  view: "#1e7a73",
};
const GOLD = "#c9a24c";
/** Medals are this much smaller than plain coins. */
const LIT_SIZE = 0.85;
/** World distance under which the pearl becomes a medal, and the pearl's size relative to a coin. */
const DOT_NEAR = 4;
const DOT_SIZE = 0.38;
/** Shadows: strongest opacity, and the height (world) over the floor at which they fade out. */
const SHADOW_OPACITY = 0.45;
const SHADOW_FADE_HEIGHT = 3;

const ICON_STYLE: Record<IconKind, { color: string; rim: string; glyph: string }> = {
  entrance: { color: "#2f6fe0", rim: "#1c4596", glyph: "入口" },
  exit: { color: "#e07a2f", rim: "#96501c", glyph: "出口" },
  mesh: { color: "#2e9d5b", rim: "#1c6639", glyph: "3D" },
  url: { color: "#8a4fd6", rim: "#58308f", glyph: "Web" },
  view: { color: "#12a39a", rim: "#0b6a64", glyph: "★" },
};

function iconKind(entrance: Entrance): IconKind {
  if (entrance.target.type === "mesh") return "mesh";
  if (entrance.target.type === "url") return "url";
  if (entrance.target.type === "view") return "view";
  return entrance.kind;
}

// Coin face: a bevelled disc (lighter top-left, darker bottom-right) with a
// white ring and the glyph.
function createFaceTexture(kind: IconKind): THREE.CanvasTexture {
  const size = 128;
  const c = size / 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const { color, rim, glyph } = ICON_STYLE[kind];

  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, size, size);
  const bevel = ctx.createLinearGradient(0, 0, size, size);
  bevel.addColorStop(0, "#ffffff");
  bevel.addColorStop(0.5, color);
  bevel.addColorStop(1, rim);
  ctx.beginPath();
  ctx.arc(c, c, c - 3, 0, Math.PI * 2);
  ctx.fillStyle = bevel;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(c, c, c - 14, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${glyphSize(glyph, 128)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowOffsetY = 3;
  ctx.shadowBlur = 4;
  ctx.fillText(glyph, c, c + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Face of a medal: an enamel disc (lighter in the middle) with a cream
// glyph and a fine light ring.
function createMedalFaceTexture(kind: IconKind): THREE.CanvasTexture {
  const size = 256;
  const c = size / 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const { glyph } = ICON_STYLE[kind];
  ctx.fillStyle = CALM_COLOR[kind];
  ctx.fillRect(0, 0, size, size);
  const shade = ctx.createRadialGradient(c * 0.8, c * 0.7, 4, c, c, c);
  shade.addColorStop(0, "rgba(255, 255, 255, 0.28)");
  shade.addColorStop(1, "rgba(0, 0, 0, 0.25)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(c, c, c - 22, 0, Math.PI * 2);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(240, 220, 160, 0.85)";
  ctx.stroke();
  ctx.fillStyle = "#fbf3dc";
  ctx.font = `bold ${glyphSize(glyph, 256)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowOffsetY = 4;
  ctx.shadowBlur = 6;
  ctx.fillText(glyph, c, c + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Font size (px) for a glyph on a face texture `size` px across: the more characters, the smaller. */
function glyphSize(glyph: string, size: number): number {
  return Math.round((size / 256) * (glyph.length === 1 ? 112 : glyph.length === 2 ? 84 : 72));
}

/** A soft round texture: white in the middle fading out (halo), or black (shadow). */
function createSoftDiscTexture(color: string): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

interface CoinParts {
  face: THREE.Material;
  rim: THREE.Material;
  /** Raised ring round each face (lit styles). */
  bezel?: THREE.Material;
}

export interface MarkerOptions {
  /** For the environment light of the medals and pearls; without it the plain unlit coins are drawn. */
  renderer?: THREE.WebGLRenderer;
}

export interface EntranceMarkers {
  setEntrances(entrances: Entrance[], rootScale: number): void;
  /** Re-orients and re-sizes the coins for the camera; call after it moves. */
  update(camera: THREE.Camera): void;
  /**
   * Entrance under the given normalized device coordinates, if any. Coins
   * behind the occluder (the splat mesh) are skipped.
   */
  pick(ndc: THREE.Vector2, camera: THREE.Camera, occluder: THREE.Object3D | null): Entrance | undefined;
  setHovered(id: string | null): void;
  /** World position of an entrance's icon. */
  worldPosition(id: string): THREE.Vector3 | undefined;
  /** Shows or hides all coins, e.g. to capture the scene without them. */
  setVisible(visible: boolean): void;
  /**
   * Floor height (world y) under a world point, for the coins' shadows, or
   * null to cast none (e.g. a scene without walk voxels).
   */
  setGround(groundAt: ((point: THREE.Vector3) => number | null) | null): void;
}

export function setupEntranceMarkers(root: THREE.Object3D, options: MarkerOptions = {}): EntranceMarkers {
  const lit = options.renderer !== undefined;
  const group = new THREE.Group();
  root.add(group);
  const unitRadius = 0.5;
  const faceGeometry = new THREE.CircleGeometry(unitRadius, 48);
  const rimGeometry = new THREE.CylinderGeometry(unitRadius, unitRadius, THICKNESS, 48, 1, true);
  rimGeometry.rotateX(Math.PI / 2);
  const bezelGeometry = new THREE.TorusGeometry(unitRadius - 0.025, 0.045, 10, 48);
  const dotGeometry = new THREE.SphereGeometry(unitRadius, 24, 16);
  const shadowGeometry = new THREE.PlaneGeometry(1, 1);
  shadowGeometry.rotateX(-Math.PI / 2);
  const materials = new Map<IconKind, CoinParts>();
  const dotMaterials = new Map<IconKind, THREE.Material>();
  const raycaster = new THREE.Raycaster();
  const environment =
    lit && options.renderer
      ? new THREE.PMREMGenerator(options.renderer).fromScene(new RoomEnvironment(), 0.04).texture
      : null;
  const haloTexture = lit ? createSoftDiscTexture("rgba(255, 244, 214, 0.9)") : null;
  const shadowTexture = lit ? createSoftDiscTexture("rgba(0, 0, 0, 1)") : null;
  let groundAt: ((point: THREE.Vector3) => number | null) | null = null;

  let entrancesById = new Map<string, Entrance>();
  let coinsById = new Map<string, THREE.Group>();
  let rootScale = 1;
  let hoveredId: string | null = null;

  function standard(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    // Colours as painted: the scene's tone mapping would grey them.
    return new THREE.MeshStandardMaterial({ envMap: environment, envMapIntensity: 1, toneMapped: false, ...params });
  }

  function materialsFor(kind: IconKind): CoinParts {
    let parts = materials.get(kind);
    if (!parts) {
      if (!lit) {
        parts = {
          face: new THREE.MeshBasicMaterial({ map: createFaceTexture(kind), toneMapped: false }),
          rim: new THREE.MeshBasicMaterial({ color: ICON_STYLE[kind].rim, toneMapped: false }),
        };
      } else {
        parts = {
          face: standard({ map: createMedalFaceTexture(kind), metalness: 0.1, roughness: 0.32 }),
          rim: standard({ color: GOLD, metalness: 1, roughness: 0.32 }),
          bezel: standard({ color: GOLD, metalness: 1, roughness: 0.25 }),
        };
      }
      materials.set(kind, parts);
    }
    return parts;
  }

  function dotMaterialFor(kind: IconKind): THREE.Material {
    let material = dotMaterials.get(kind);
    if (!material) {
      material = standard({
        color: CALM_COLOR[kind],
        metalness: 0.2,
        roughness: 0.25,
        emissive: new THREE.Color(CALM_COLOR[kind]),
        emissiveIntensity: 0.6,
      });
      dotMaterials.set(kind, material);
    }
    return material;
  }

  function createCoin(entrance: Entrance): THREE.Group {
    const kind = iconKind(entrance);
    const parts = materialsFor(kind);
    const coin = new THREE.Group();
    // The coin itself ("near" for "dot").
    const body = new THREE.Group();
    const front = new THREE.Mesh(faceGeometry, parts.face);
    front.position.z = THICKNESS / 2;
    const back = new THREE.Mesh(faceGeometry, parts.face);
    back.position.z = -THICKNESS / 2;
    back.rotation.y = Math.PI;
    const rim = new THREE.Mesh(rimGeometry, parts.rim);
    body.add(front, back, rim);
    if (parts.bezel) {
      for (const z of [THICKNESS / 2, -THICKNESS / 2]) {
        const bezel = new THREE.Mesh(bezelGeometry, parts.bezel);
        bezel.position.z = z;
        body.add(bezel);
      }
    }
    coin.add(body);
    coin.userData.body = body;
    if (haloTexture) {
      const dot = new THREE.Group();
      const pearl = new THREE.Mesh(dotGeometry, dotMaterialFor(kind));
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: haloTexture,
          color: CALM_COLOR[kind],
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
          toneMapped: false,
        }),
      );
      halo.scale.setScalar(2.6);
      dot.add(pearl, halo);
      dot.scale.setScalar(DOT_SIZE / LIT_SIZE);
      coin.add(dot);
      coin.userData.dot = dot;
    }
    if (shadowTexture) {
      const shadow = new THREE.Mesh(
        shadowGeometry,
        new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, toneMapped: false }),
      );
      shadow.visible = false;
      shadow.userData.isShadow = true;
      group.add(shadow);
      coin.userData.shadow = shadow;
    }
    coin.userData.entranceId = entrance.id;
    coin.userData.anchor = new THREE.Vector3(...entrance.position);
    return coin;
  }

  /** Lays a coin's shadow on the floor under its anchor, faded with the height. */
  function placeShadow(coin: THREE.Group, worldSize: number): void {
    const shadow = coin.userData.shadow as THREE.Mesh | undefined;
    if (!shadow) return;
    if (coin.userData.ground === undefined) {
      coin.userData.ground = groundAt ? groundAt(worldAnchor.clone()) : null;
    }
    const ground = coin.userData.ground as number | null;
    const height = ground === null ? -1 : worldAnchor.y - ground;
    shadow.visible = coin.visible && ground !== null && height > 0 && height < SHADOW_FADE_HEIGHT;
    if (!shadow.visible || ground === null) return;
    shadow.position.copy(root.worldToLocal(new THREE.Vector3(worldAnchor.x, ground + 0.01, worldAnchor.z)));
    root.getWorldQuaternion(rootQuaternion);
    shadow.quaternion.copy(rootQuaternion.invert());
    shadow.scale.setScalar((worldSize * 1.3) / rootScale);
    (shadow.material as THREE.MeshBasicMaterial).opacity = SHADOW_OPACITY * (1 - height / SHADOW_FADE_HEIGHT);
  }

  const worldAnchor = new THREE.Vector3();
  const toCamera = new THREE.Vector3();
  const viewDirection = new THREE.Vector3();
  const rootQuaternion = new THREE.Quaternion();

  function placeCoin(coin: THREE.Group, camera: THREE.Camera): void {
    worldAnchor.copy(coin.userData.anchor as THREE.Vector3);
    root.localToWorld(worldAnchor);
    toCamera.copy(camera.position).sub(worldAnchor);
    const distance = Math.max(toCamera.length(), 1e-3);
    toCamera.divideScalar(distance);
    coin.visible = distance > NEAR_HIDE;

    // Position: lifted towards the camera, back in root-local coordinates.
    const world = worldAnchor.clone().addScaledVector(toCamera, distance * LIFT);
    coin.position.copy(root.worldToLocal(world));

    // Orientation in world space, then expressed relative to the root.
    const yaw = Math.atan2(toCamera.x, toCamera.z) + YAW_TILT;
    const pitch = -Math.asin(THREE.MathUtils.clamp(toCamera.y, -1, 1)) * PITCH_FOLLOW;
    const worldQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
    root.getWorldQuaternion(rootQuaternion);
    coin.quaternion.copy(rootQuaternion.invert().multiply(worldQuaternion));

    // (Coins behind the camera are not drawn; the clamp only keeps the scale positive.)
    camera.getWorldDirection(viewDirection);
    const depth = Math.max(-toCamera.dot(viewDirection) * distance, 1e-3);
    const angular = THREE.MathUtils.clamp(
      ICON_SIZE * Math.pow(REFERENCE_DEPTH / depth, DEPTH_FALLOFF),
      MIN_ICON_SIZE,
      MAX_ICON_SIZE,
    );
    const hover = coin.userData.entranceId === hoveredId ? HOVER_SCALE : 1;
    const worldSize = angular * depth * hover * (lit ? LIT_SIZE : 1);
    coin.scale.setScalar(worldSize / rootScale);
    const dot = coin.userData.dot as THREE.Object3D | undefined;
    if (dot) {
      const near = distance < DOT_NEAR || coin.userData.entranceId === hoveredId;
      dot.visible = !near;
      (coin.userData.body as THREE.Object3D).visible = near;
    }
    placeShadow(coin, worldSize);
  }

  function clear(): void {
    for (const coin of coinsById.values()) {
      group.remove(coin);
      const shadow = coin.userData.shadow as THREE.Mesh | undefined;
      if (shadow) {
        group.remove(shadow);
        (shadow.material as THREE.Material).dispose();
      }
      for (const sprite of (coin.userData.dot as THREE.Object3D | undefined)?.children ?? []) {
        if (sprite instanceof THREE.Sprite) sprite.material.dispose();
      }
    }
    coinsById = new Map();
    entrancesById = new Map();
    hoveredId = null;
  }

  return {
    setEntrances(entrances: Entrance[], scale: number) {
      clear();
      rootScale = scale;
      for (const entrance of entrances) {
        const coin = createCoin(entrance);
        group.add(coin);
        coinsById.set(entrance.id, coin);
        entrancesById.set(entrance.id, entrance);
      }
    },
    update(camera: THREE.Camera) {
      for (const coin of coinsById.values()) {
        placeCoin(coin, camera);
      }
    },
    pick(ndc: THREE.Vector2, camera: THREE.Camera, occluder: THREE.Object3D | null) {
      raycaster.setFromCamera(ndc, camera);
      raycaster.far = Infinity;
      // Raycasts ignore `visible`; hidden coins (too near) and hidden parts
      // (a "dot" coin's other form) must not be picked, nor shadows.
      const shown = (o: THREE.Object3D | null): boolean => {
        for (let x = o; x && x !== group; x = x.parent) if (!x.visible) return false;
        return true;
      };
      const hit = raycaster
        .intersectObjects(group.children.filter((c) => c.visible && !c.userData.isShadow), true)
        .find((h) => shown(h.object) && !(h.object instanceof THREE.Sprite));
      let obj: THREE.Object3D | null = hit?.object ?? null;
      while (obj && obj.userData.entranceId === undefined) {
        obj = obj.parent;
      }
      const id = obj?.userData.entranceId as string | undefined;
      if (!hit || !id) {
        return undefined;
      }
      if (occluder) {
        // A splat surface clearly in front of the coin hides it.
        // (Distances are checked explicitly in case a raycast ignores far.)
        const limit = hit.distance * 0.97;
        raycaster.far = limit;
        const blocked = raycaster.intersectObject(occluder, false).some((h) => h.distance < limit);
        raycaster.far = Infinity;
        if (blocked) {
          return undefined;
        }
      }
      return entrancesById.get(id);
    },
    setHovered(id: string | null) {
      hoveredId = id;
    },
    worldPosition(id: string) {
      return coinsById.get(id)?.getWorldPosition(new THREE.Vector3());
    },
    setVisible(visible: boolean) {
      group.visible = visible;
    },
    setGround(fn) {
      groundAt = fn;
      for (const coin of coinsById.values()) delete coin.userData.ground;
    },
  };
}
