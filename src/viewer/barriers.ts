import * as THREE from "three";
import type { Scene } from "../core/manifest";

// Invisible walls at entrance icons (Entrance.barrier): visitors cannot
// pass them, walking or flying, so they do not wander past an entrance into
// the unfinished edge of a scan. A wall is upright through the icon, as
// wide as the barrier says and unlimited in height (a jump or a flight does
// not get over it), standing across the direction visitors face as they
// walk up to it. The camera is kept STAND_OFF in front of it, so the icon
// is not passed or hidden (coins nearer than NEAR_HIDE disappear), and a
// move into it slides along it. Whichever side the camera is on is kept, so
// a wall never shuts anyone in.
//
// Scenes also have walls drawn freely (Scene.walls), e.g. across a gap in a
// scanned wall: lines through points on the floor, one wall per segment,
// kept LINE_STAND_OFF away (about a body).
//
// Walls work in world xz: the icon's scene-local position goes through the
// scene root (its rotation levels the floor), and the barrier's yaw is a
// world-frame view direction like a view's yaw.

/** How far in front of a wall the camera stays (world units): far enough that an icon at waist height is still in view. */
const STAND_OFF = 1.0;
/** How far from a drawn wall (Scene.walls) the camera stays: about a body (world units). */
const LINE_STAND_OFF = 0.3;
/** Extra reach past each end of a wall: about a body's radius (world units). */
const END_MARGIN = 0.2;
/** Height of the walls as drawn for ?debug=1 (they block at any height). */
const SHOWN_HEIGHT = 3;

interface Wall {
  /** Middle (the icon, or a segment's middle), world. */
  cx: number;
  cz: number;
  /** Middle height of the wall as drawn. */
  cy: number;
  /** Unit normal (the direction visitors face, for an icon); tangent across it. */
  nx: number;
  nz: number;
  half: number;
  standOff: number;
}

export interface Barriers {
  /** The walls of a scene's entrances and its drawn walls (none for null); call once its root has its transform. */
  setScene(scene: Scene | null, root: THREE.Object3D): void;
  /** Keeps a camera move (world) on its side of every wall, sliding along; true if it changed the move. */
  constrain(previous: THREE.Vector3, target: THREE.Vector3): boolean;
  /** Draws the walls (for ?debug=1 and the authoring tool). */
  setVisible(visible: boolean): void;
}

const DEG = Math.PI / 180;

export function setupBarriers(scene: THREE.Scene): Barriers {
  let walls: Wall[] = [];
  let visible = false;
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  const material = new THREE.MeshBasicMaterial({
    color: 0xff4040,
    transparent: true,
    opacity: 0.25,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  function draw(): void {
    for (const child of group.children) (child as THREE.Mesh).geometry.dispose();
    group.clear();
    if (!visible) return;
    for (const w of walls) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w.half * 2, SHOWN_HEIGHT), material);
      mesh.position.set(w.cx, w.cy, w.cz);
      // The plane faces +z; turn it to face along the normal.
      mesh.rotation.y = Math.atan2(w.nx, w.nz);
      mesh.renderOrder = 1000;
      group.add(mesh);
    }
  }

  return {
    setScene(s, root) {
      walls = [];
      if (s) {
        root.updateMatrixWorld(true);
        const start = root.localToWorld(new THREE.Vector3(...s.initialView.position));
        for (const e of s.entrances) {
          if (!e.barrier || e.target.type === "view") continue;
          const c = root.localToWorld(new THREE.Vector3(...e.position));
          let nx: number;
          let nz: number;
          if (e.barrier.yaw !== undefined) {
            // A camera with this yaw looks along (-sin, -cos).
            nx = -Math.sin(e.barrier.yaw * DEG);
            nz = -Math.cos(e.barrier.yaw * DEG);
          } else {
            nx = c.x - start.x;
            nz = c.z - start.z;
          }
          const n = Math.hypot(nx, nz);
          if (n < 1e-6) {
            nx = 0;
            nz = -1;
          } else {
            nx /= n;
            nz /= n;
          }
          walls.push({ cx: c.x, cy: c.y, cz: c.z, nx, nz, half: e.barrier.width / 2, standOff: STAND_OFF });
        }
        for (const line of s.walls) {
          const points = line.points.map((p) => root.localToWorld(new THREE.Vector3(...p)));
          for (let i = 1; i < points.length; i++) {
            const a = points[i - 1];
            const b = points[i];
            const length = Math.hypot(b.x - a.x, b.z - a.z);
            if (length < 1e-6) continue;
            walls.push({
              cx: (a.x + b.x) / 2,
              cz: (a.z + b.z) / 2,
              // Clicked on the floor: drawn from there up.
              cy: Math.min(a.y, b.y) + SHOWN_HEIGHT / 2,
              nx: -(b.z - a.z) / length,
              nz: (b.x - a.x) / length,
              half: length / 2,
              standOff: LINE_STAND_OFF,
            });
          }
        }
      }
      draw();
    },
    constrain(previous, target) {
      let changed = false;
      // Twice: a slide along one wall can run into the next at a corner.
      for (let pass = 0; pass < 2; pass++) for (const w of walls) {
        // Tangent (across the approach direction).
        const tx = -w.nz;
        const tz = w.nx;
        const s0 = (previous.x - w.cx) * w.nx + (previous.z - w.cz) * w.nz;
        const s1 = (target.x - w.cx) * w.nx + (target.z - w.cz) * w.nz;
        const u0 = (previous.x - w.cx) * tx + (previous.z - w.cz) * tz;
        const u1 = (target.x - w.cx) * tx + (target.z - w.cz) * tz;
        // The side the camera is on (in front, the way visitors come, if exactly on it).
        const side = s0 > 1e-9 ? 1 : -1;
        const reach = w.half + END_MARGIN;
        let blocked = side * s1 < w.standOff && Math.abs(u1) <= reach;
        if (!blocked && Math.sign(s1) !== Math.sign(s0) && s0 !== s1) {
          // Crossed between the frames (a fast move ending past an end).
          const u = u0 + ((u1 - u0) * s0) / (s0 - s1);
          blocked = Math.abs(u) <= reach;
        }
        // Already closer than the stand-off (placed there): only moves away are held back to it.
        if (!blocked || side * s1 >= side * s0) continue;
        const s = side * Math.min(w.standOff, side * s0);
        target.x = w.cx + w.nx * s + tx * u1;
        target.z = w.cz + w.nz * s + tz * u1;
        changed = true;
      }
      return changed;
    },
    setVisible(v) {
      visible = v;
      group.visible = v;
      draw();
    },
  };
}
