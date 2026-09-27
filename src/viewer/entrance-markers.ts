import * as THREE from "three";
import type { Entrance } from "../core/manifest";

// One coin-shaped icon per entrance, placed under the scene root so it
// follows the scene transform. The coins are opaque and depth-tested, so the
// splats of a wall in front (Spark draws splats depth-tested, blended over
// opaque geometry) hide them; picking skips coins behind splats as well.
// Each coin keeps a constant screen size, turns towards the camera with a
// slight fixed tilt so its rim shows, and sits a little in front of its
// anchor so it does not sink into the surface it was placed on.

const ICON_SIZE = 0.07; // coin diameter as a fraction of the distance
const THICKNESS = 0.22; // rim depth relative to the diameter
const HOVER_SCALE = 1.25;
const YAW_TILT = (18 * Math.PI) / 180; // shows the rim when viewed head-on
const PITCH_FOLLOW = 0.75; // how far the coin tips towards a camera above/below
const LIFT = 0.06; // offset towards the camera, as a fraction of the distance

type IconKind = "entrance" | "exit" | "mesh" | "url";

const ICON_STYLE: Record<IconKind, { color: string; rim: string; glyph: string }> = {
  entrance: { color: "#2f6fe0", rim: "#1c4596", glyph: "→" },
  exit: { color: "#e07a2f", rim: "#96501c", glyph: "←" },
  mesh: { color: "#2e9d5b", rim: "#1c6639", glyph: "3D" },
  url: { color: "#8a4fd6", rim: "#58308f", glyph: "Web" },
};

function iconKind(entrance: Entrance): IconKind {
  if (entrance.target.type === "mesh") return "mesh";
  if (entrance.target.type === "url") return "url";
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
  ctx.font = `bold ${glyph.length > 1 ? 36 : 56}px system-ui, sans-serif`;
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

interface CoinParts {
  face: THREE.MeshBasicMaterial;
  rim: THREE.MeshBasicMaterial;
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
}

export function setupEntranceMarkers(root: THREE.Object3D): EntranceMarkers {
  const group = new THREE.Group();
  root.add(group);
  const unitRadius = 0.5;
  const faceGeometry = new THREE.CircleGeometry(unitRadius, 48);
  const rimGeometry = new THREE.CylinderGeometry(unitRadius, unitRadius, THICKNESS, 48, 1, true);
  rimGeometry.rotateX(Math.PI / 2);
  const materials = new Map<IconKind, CoinParts>();
  const raycaster = new THREE.Raycaster();

  let entrancesById = new Map<string, Entrance>();
  let coinsById = new Map<string, THREE.Group>();
  let rootScale = 1;
  let hoveredId: string | null = null;

  function materialsFor(kind: IconKind): CoinParts {
    let parts = materials.get(kind);
    if (!parts) {
      parts = {
        face: new THREE.MeshBasicMaterial({ map: createFaceTexture(kind), toneMapped: false }),
        rim: new THREE.MeshBasicMaterial({ color: ICON_STYLE[kind].rim, toneMapped: false }),
      };
      materials.set(kind, parts);
    }
    return parts;
  }

  function createCoin(entrance: Entrance): THREE.Group {
    const parts = materialsFor(iconKind(entrance));
    const coin = new THREE.Group();
    const front = new THREE.Mesh(faceGeometry, parts.face);
    front.position.z = THICKNESS / 2;
    const back = new THREE.Mesh(faceGeometry, parts.face);
    back.position.z = -THICKNESS / 2;
    back.rotation.y = Math.PI;
    const rim = new THREE.Mesh(rimGeometry, parts.rim);
    coin.add(front, back, rim);
    coin.userData.entranceId = entrance.id;
    coin.userData.anchor = new THREE.Vector3(...entrance.position);
    return coin;
  }

  const worldAnchor = new THREE.Vector3();
  const toCamera = new THREE.Vector3();
  const rootQuaternion = new THREE.Quaternion();

  function placeCoin(coin: THREE.Group, camera: THREE.Camera): void {
    worldAnchor.copy(coin.userData.anchor as THREE.Vector3);
    root.localToWorld(worldAnchor);
    toCamera.copy(camera.position).sub(worldAnchor);
    const distance = Math.max(toCamera.length(), 1e-3);
    toCamera.divideScalar(distance);

    // Position: lifted towards the camera, back in root-local coordinates.
    const world = worldAnchor.clone().addScaledVector(toCamera, distance * LIFT);
    coin.position.copy(root.worldToLocal(world));

    // Orientation in world space, then expressed relative to the root.
    const yaw = Math.atan2(toCamera.x, toCamera.z) + YAW_TILT;
    const pitch = -Math.asin(THREE.MathUtils.clamp(toCamera.y, -1, 1)) * PITCH_FOLLOW;
    const worldQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
    root.getWorldQuaternion(rootQuaternion);
    coin.quaternion.copy(rootQuaternion.invert().multiply(worldQuaternion));

    const hover = coin.userData.entranceId === hoveredId ? HOVER_SCALE : 1;
    coin.scale.setScalar((ICON_SIZE * distance * hover) / rootScale);
  }

  function clear(): void {
    for (const coin of coinsById.values()) {
      group.remove(coin);
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
      const hit = raycaster.intersectObjects(group.children, true)[0];
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
  };
}
