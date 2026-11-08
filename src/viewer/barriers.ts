import * as THREE from "three";
import type { Scene } from "../core/manifest";

// Invisible walls: at entrance icons (Entrance.barrier), so visitors do not
// wander past an entrance into the unfinished edge of a scan, and drawn
// freely (Scene.walls: lines through points on the floor, one wall per
// segment), e.g. across a gap in a scanned wall.
//
// Walking, a wall is part of the collision world (bodyBlocked, used by
// walk.ts like the scan's voxels): a slab WALL_THICKNESS thick, from the
// floor below it up `height`, so the walker bumps into it, slides along it
// and rounds its corners exactly as along a scanned wall, and a walkway
// above it is not blocked. An entrance's wall stands ENTRANCE_SETBACK in
// front of the icon (on the side visitors come from), so the icon is still
// in view where the walker stops.
//
// Flying, the walls are unlimited in height (constrain): a flight must not
// get over one into the dark. The camera is kept STAND_OFF in front of an
// entrance's icon and LINE_STAND_OFF off a drawn wall, sliding along;
// whichever side it is on is kept, so a wall never shuts anyone in.
//
// An entrance wall stands across the direction visitors face as they walk
// up (the barrier's yaw, a world-frame view direction, or from the scene's
// first view towards the icon). Everything is in world coordinates: points
// go through the scene root (its rotation levels the floor).

/** Flying: how far in front of an entrance's icon the camera stays (world units), so the icon stays in view. */
const STAND_OFF = 1.0;
/** Flying: how far from a drawn wall the camera stays: about a body (world units). */
const LINE_STAND_OFF = 0.3;
/** Flying: extra reach past each end of a wall: about a body's radius (world units). */
const END_MARGIN = 0.2;
/** Walking: thickness of a wall's slab (world units), a couple of voxels. */
const WALL_THICKNESS = 0.2;
/** Walking: an entrance's wall stands this far in front of its icon (world units). */
const ENTRANCE_SETBACK = 0.8;
/** Walking: a drawn wall starts this far below its lowest point (clicked on the floor). */
const BELOW_FLOOR = 0.1;
/** Walking: where the floor below an entrance is unknown, its wall starts this far below the icon. */
const ICON_ABOVE_FLOOR = 1.5;

/** A wall in the horizontal plane (world xz): middle, unit normal, half length. */
interface Line {
  cx: number;
  cz: number;
  nx: number;
  nz: number;
  half: number;
}

/** Flying form: unlimited in height. */
interface FlyWall extends Line {
  standOff: number;
}

/** Walking form: a slab between two heights. */
interface BodyWall extends Line {
  bottom: number;
  top: number;
}

export interface Barriers {
  /** The walls of a scene's entrances and its drawn walls (none for null); call once its root has its transform. */
  setScene(scene: Scene | null, root: THREE.Object3D): void;
  /**
   * Floor height (world y) under a world point, or null: where an entrance's
   * wall starts when walking (else a guess below its icon).
   */
  setGround(groundAt: ((point: THREE.Vector3) => number | null) | null): void;
  /** Flying: keeps a camera move (world) on its side of every wall, sliding along; true if it changed the move. */
  constrain(previous: THREE.Vector3, target: THREE.Vector3): boolean;
  /** Walking: whether a world point is inside a wall's slab (for the walker's body, like a solid voxel). */
  bodyBlocked(x: number, y: number, z: number): boolean;
  /** Draws the walls as walking meets them (for ?debug=1 and the authoring tool). */
  setVisible(visible: boolean): void;
}

const DEG = Math.PI / 180;

export function setupBarriers(scene: THREE.Scene): Barriers {
  let flyWalls: FlyWall[] = [];
  let bodyWalls: BodyWall[] = [];
  let current: { scene: Scene; root: THREE.Object3D } | null = null;
  let groundAt: ((point: THREE.Vector3) => number | null) | null = null;
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
    for (const w of bodyWalls) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w.half * 2, w.top - w.bottom), material);
      mesh.position.set(w.cx, (w.bottom + w.top) / 2, w.cz);
      // The plane faces +z; turn it to face along the normal.
      mesh.rotation.y = Math.atan2(w.nx, w.nz);
      mesh.renderOrder = 1000;
      group.add(mesh);
    }
  }

  function build(): void {
    flyWalls = [];
    bodyWalls = [];
    if (!current) return;
    const { scene: s, root } = current;
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
      const half = e.barrier.width / 2;
      flyWalls.push({ cx: c.x, cz: c.z, nx, nz, half, standOff: STAND_OFF });
      // Visitors face +n as they come, so they are on the -n side.
      const floor = groundAt?.(c.clone()) ?? null;
      const bottom = floor ?? c.y - ICON_ABOVE_FLOOR;
      bodyWalls.push({
        cx: c.x - nx * ENTRANCE_SETBACK,
        cz: c.z - nz * ENTRANCE_SETBACK,
        nx,
        nz,
        half,
        bottom,
        top: bottom + e.barrier.height,
      });
    }
    for (const line of s.walls) {
      const points = line.points.map((p) => root.localToWorld(new THREE.Vector3(...p)));
      const bottom = Math.min(...points.map((p) => p.y)) - BELOW_FLOOR;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        if (length < 1e-6) continue;
        const segment: Line = {
          cx: (a.x + b.x) / 2,
          cz: (a.z + b.z) / 2,
          nx: -(b.z - a.z) / length,
          nz: (b.x - a.x) / length,
          half: length / 2,
        };
        flyWalls.push({ ...segment, standOff: LINE_STAND_OFF });
        // Half a slab longer at each end, so the segments of a line close at their corners.
        bodyWalls.push({ ...segment, half: segment.half + WALL_THICKNESS / 2, bottom, top: bottom + BELOW_FLOOR + line.height });
      }
    }
  }

  return {
    setScene(s, root) {
      current = s ? { scene: s, root } : null;
      build();
      draw();
    },
    setGround(fn) {
      groundAt = fn;
      build();
      draw();
    },
    constrain(previous, target) {
      let changed = false;
      // Twice: a slide along one wall can run into the next at a corner.
      for (let pass = 0; pass < 2; pass++) for (const w of flyWalls) {
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
    bodyBlocked(x, y, z) {
      for (const w of bodyWalls) {
        if (y < w.bottom || y > w.top) continue;
        const dx = x - w.cx;
        const dz = z - w.cz;
        if (Math.abs(dx * w.nx + dz * w.nz) > WALL_THICKNESS / 2) continue;
        if (Math.abs(-dx * w.nz + dz * w.nx) <= w.half) return true;
      }
      return false;
    },
    setVisible(v) {
      visible = v;
      group.visible = v;
      draw();
    },
  };
}
