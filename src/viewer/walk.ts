import * as THREE from "three";
import type { VoxelGrid } from "./voxel-grid";

// Walking on a voxel grid (voxel-grid.ts): the camera stays eyeHeight above
// the ground under it, steps up and down by at most stepHeight (stairs),
// stops at walls and slides along them (at any angle, and around corners),
// and never walks off where there is
// no ground (a hole in a scan is a no-go spot, not a pit; holes narrower
// than the body are stepped over). The body is a column of `radius` from just
// above the step height to the eyes; under a low ceiling the eyes come down
// (crouching, to MIN_CROUCH of eyeHeight) instead of the walk stopping. Specks (lumps smaller than about
// SPECK_SIZE across, e.g. floaters) can be ignored for the body.
//
// Distances are in world units; the grid answers in scene-local units, so
// points go through the scene root (its rotation levels the floor, its
// scale is the scene's). World +Y is up.

export interface WalkOptions {
  eyeHeight: number;
  radius: number;
  stepHeight: number;
  /** Lets the body pass through specks (see above). */
  ignoreSpecks: boolean;
}

/** Why the last move stopped, for ?debug=1. */
export interface WalkBlock {
  /** "body": something at body height; "ground": no ground to step on (a hole, a drop, or a rise above a step). */
  reason: "body" | "ground";
  /** World point of the voxel the body hit, or where the ground was looked for. */
  point: THREE.Vector3;
  /** Height of `point` above the feet. */
  height: number;
}

interface Stand {
  ground: number;
  /** Eye height above the ground (lower than eyeHeight when crouching). */
  head: number;
}

export interface Walker {
  /** The grid of the current scene and its root, or null to stop walking. */
  setGrid(grid: VoxelGrid | null, root: THREE.Object3D | null): void;
  setOptions(options: WalkOptions): void;
  setEnabled(enabled: boolean): void;
  grid(): VoxelGrid | null;
  /** Why the last move stopped, or null if it did not. */
  blocked(): WalkBlock | null;
  isEnabled(): boolean;
  /** Ground height under a world point, or null (no grid, or no ground near). */
  groundAt(position: THREE.Vector3, from?: number): number | null;
  /**
   * Applies walking to a camera that the controls moved from `previous`.
   * Returns true while the camera is still easing to its height.
   */
  constrain(camera: THREE.Camera, previous: THREE.Vector3, dt: number): boolean;
}

/** How far down to look for ground when starting to walk (in eye heights). */
const LANDING_SEARCH = 30;
/** Eases the eye height towards the ground: fraction per second (exponential). */
const EASE_RATE = 12;
const DIRECTIONS = 8;
const MAX_SUBSTEPS = 40;
/** Lumps up to about this size across (world units) count as specks. */
const SPECK_SIZE = 0.3;
/** Lowest crouch, as a share of eyeHeight; lower gaps are not walked into. */
const MIN_CROUCH = 0.6;
/** Space kept between the eyes and a ceiling, in voxels. */
const HEAD_CLEARANCE_VOXELS = 1;
/** Turns tried when a step is blocked, smallest first (radians). */
const SLIDE_ANGLES = [10, 20, 30, 40, 50, 60, 70, 80, 90].map((deg) => (deg * Math.PI) / 180);
/** How far a slide may back off from what it hit, in voxels. */
const BACKOFFS = [0, 0.15, 0.3];
/** Half the square (in voxels) a surface's direction is read from. */
const NORMAL_REACH = 2;

export function setupWalker(initial: WalkOptions): Walker {
  let grid: VoxelGrid | null = null;
  let root: THREE.Object3D | null = null;
  let options = initial;
  let enabled = false;
  let block: WalkBlock | null = null;
  let lastFailure: WalkBlock | null = null;
  // The ground last stood on (world y), kept while the camera only walks.
  let feet: number | null = null;
  // Where the walker left the camera; if it is elsewhere now, it was moved otherwise.
  const placed = new THREE.Vector3();
  // Which way the last slide turned (1 or -1).
  let slideSide = 1;
  const local = new THREE.Vector3();
  const probe = new THREE.Vector3();

  /** Voxel size in world units (the scene scale applies). */
  function worldStep(): number {
    return grid && root ? grid.resolution * root.getWorldScale(probe).x : 0.1;
  }

  function solid(x: number, y: number, z: number): boolean {
    if (!grid || !root) return false;
    local.set(x, y, z);
    root.worldToLocal(local);
    return grid.isSolid(local.x, local.y, local.z);
  }

  /** Whether a voxel is something to stand on or bump into (specks may not be). */
  function obstacle(x: number, y: number, z: number): boolean {
    if (!solid(x, y, z) || !grid || !root) return false;
    if (!options.ignoreSpecks) return true;
    const voxelsAcross = SPECK_SIZE / (grid.resolution * root.getWorldScale(probe).x);
    return !grid.isSpeck(local.x, local.y, local.z, Math.max(8, Math.round(voxelsAcross ** 3)));
  }

  /** Top of the highest solid voxel at (x, z) between `top` and `bottom` (world y), or null. */
  function surface(x: number, z: number, top: number, bottom: number): number | null {
    const step = worldStep() / 2;
    let wasFree = !obstacle(x, top, z);
    for (let y = top - step; y >= bottom; y -= step) {
      const isSolid = obstacle(x, y, z);
      if (isSolid && wasFree) return y + step / 2;
      wasFree = !isSolid;
    }
    return null;
  }

  /**
   * The eye height above `ground` the body fits at (x, z): eyeHeight, or
   * lower under a ceiling; null if it does not fit even crouching.
   */
  function bodyFits(x: number, z: number, ground: number): number | null {
    const { eyeHeight, radius, stepHeight } = options;
    const step = worldStep();
    const clearance = step * HEAD_CLEARANCE_VOXELS;
    // Up each column of the body (middle and rim) to the first thing in it:
    // the lowest one sets how high the eyes can be.
    let head = eyeHeight;
    for (let i = -1; i < DIRECTIONS; i++) {
      const a = (i / DIRECTIONS) * Math.PI * 2;
      const px = i < 0 ? x : x + Math.cos(a) * radius;
      const pz = i < 0 ? z : z + Math.sin(a) * radius;
      for (let h = ground + stepHeight + step / 2; h <= ground + head + clearance; h += step) {
        if (!obstacle(px, h, pz)) continue;
        head = h - ground - clearance;
        if (head < eyeHeight * MIN_CROUCH) {
          lastFailure = { reason: "body", point: new THREE.Vector3(px, h, pz), height: h - ground };
          return null;
        }
        break;
      }
    }
    return Math.min(head, eyeHeight);
  }

  /** Ground at (x, z) in a height window; under the body's rim too, so narrow holes are crossed. */
  function groundUnder(x: number, z: number, top: number, bottom: number): number | null {
    let best = surface(x, z, top, bottom);
    if (best !== null) return best;
    for (let i = 0; i < DIRECTIONS; i++) {
      const a = (i / DIRECTIONS) * Math.PI * 2;
      const rim = surface(x + Math.cos(a) * options.radius, z + Math.sin(a) * options.radius, top, bottom);
      if (rim !== null && (best === null || rim > best)) best = rim;
    }
    return best;
  }

  /**
   * Horizontal direction out of the solid around a world point: away from
   * the solid voxels in a small square around it at its height (a slanted
   * wall's normal, roughly; a corner's bisector).
   */
  function surfaceNormal(point: THREE.Vector3): [number, number] {
    const step = worldStep();
    let nx = 0;
    let nz = 0;
    for (let i = -NORMAL_REACH; i <= NORMAL_REACH; i++) {
      for (let k = -NORMAL_REACH; k <= NORMAL_REACH; k++) {
        if ((i !== 0 || k !== 0) && obstacle(point.x + i * step, point.y, point.z + k * step)) {
          nx -= i;
          nz -= k;
        }
      }
    }
    return [nx, nz];
  }

  /**
   * A blocked step (sx, sz) from (x, z), redirected. First along what was
   * hit: the part of the step across the surface (its direction read from
   * the voxels around the hit point) is dropped and the body backs off a
   * little, since a slanted wall is a staircase of voxels that a parallel
   * step would still catch. Then the step turned by the smallest of
   * SLIDE_ANGLES that works, away from the hit point first (else the side
   * that worked last time), so the walker rounds a corner instead of
   * wobbling at it. Null if nothing works.
   */
  function slide(
    x: number,
    z: number,
    sx: number,
    sz: number,
    ground: number,
    hit: WalkBlock | null,
  ): [number, number, Stand] | null {
    // Turn away from what was hit (it is on one side of the step), else
    // the way the last slide went.
    let preferred = slideSide;
    if (hit) {
      const cross = sx * (hit.point.z - z) - sz * (hit.point.x - x);
      if (Math.abs(cross) > 1e-9) preferred = cross < 0 ? 1 : -1;
    }
    if (hit?.reason === "body") {
      let [nx, nz] = surfaceNormal(hit.point);
      const n = Math.hypot(nx, nz);
      if (n > 1e-9) {
        nx /= n;
        nz /= n;
        const into = sx * nx + sz * nz;
        const tx = sx - into * nx;
        const tz = sz - into * nz;
        // Straight into the surface there is nothing to slide along; and a
        // slide towards what was hit (a misread tip) would only wobble.
        const turn = sx * tz - sz * tx;
        if (into < 0 && Math.hypot(tx, tz) > Math.hypot(sx, sz) * 0.05 && turn * preferred > 0) {
          for (const backoff of BACKOFFS) {
            const px = x + tx + nx * backoff * worldStep();
            const pz = z + tz + nz * backoff * worldStep();
            const stand = standAt(px, pz, ground);
            if (stand !== null) return [px, pz, stand];
          }
        }
      }
    }
    // Backing off from the hit point too, as along a surface above.
    let ax = 0;
    let az = 0;
    if (hit) {
      ax = x - hit.point.x;
      az = z - hit.point.z;
      const a = Math.hypot(ax, az) || 1;
      ax /= a;
      az /= a;
    }
    const stepLength = Math.hypot(sx, sz);
    for (const angle of SLIDE_ANGLES) {
      // At least a little progress even when turned all the way.
      const length = Math.max(Math.cos(angle), 0.2);
      for (const side of [preferred, -preferred]) {
        const c = Math.cos(angle * side);
        const s = Math.sin(angle * side);
        for (const backoff of BACKOFFS) {
          const away = backoff * worldStep();
          if (away > stepLength * 2) break;
          const nx = x + (sx * c - sz * s) * length + ax * away;
          const nz = z + (sx * s + sz * c) * length + az * away;
          const stand = standAt(nx, nz, ground);
          if (stand !== null) {
            slideSide = side;
            return [nx, nz, stand];
          }
        }
      }
    }
    return null;
  }

  /** Where to stand at (x, z) coming from `ground` (ground and eye height above it), or null if it cannot be walked to. */
  function standAt(x: number, z: number, ground: number): Stand | null {
    const { stepHeight } = options;
    // Up a step at most, down as far as a step plus some slack for slopes.
    const next = groundUnder(x, z, ground + stepHeight + worldStep(), ground - stepHeight - worldStep());
    if (next === null) {
      lastFailure = { reason: "ground", point: new THREE.Vector3(x, ground, z), height: 0 };
      return null;
    }
    const head = bodyFits(x, z, next);
    return head === null ? null : { ground: next, head };
  }

  const walker: Walker = {
    setGrid(g, r) {
      grid = g;
      root = r;
      feet = null;
      if (!g) enabled = false;
    },
    setOptions(o) {
      options = o;
    },
    setEnabled(on) {
      enabled = on && grid !== null;
      feet = null;
    },
    isEnabled: () => enabled,
    grid: () => grid,
    blocked: () => block,
    groundAt(position, from = position.y) {
      if (!grid || !root) return null;
      return surface(position.x, position.z, from, from - options.eyeHeight * LANDING_SEARCH);
    },
    constrain(camera, previous, dt) {
      if (!enabled || !grid || !root) return false;
      // Where the feet are: the ground last stood on, unless the camera was
      // moved some other way (a glide, a jump to a view); then the first ground below the eye.
      const kept = feet !== null && previous.distanceToSquared(placed) < 1e-8;
      const ground = kept ? feet : walker.groundAt(previous);
      if (ground === null) {
        // Nothing below (e.g. started in the air over a hole): leave the camera free.
        return false;
      }
      const target = camera.position;
      // The controls move along the view, so looking down shortens the
      // horizontal part; walking keeps the whole length on the ground.
      let dx = target.x - previous.x;
      let dz = target.z - previous.z;
      const horizontal = Math.hypot(dx, dz);
      if (horizontal > 1e-9) {
        const scale = target.distanceTo(previous) / horizontal;
        dx *= scale;
        dz *= scale;
      }
      // In short steps, so a slow frame's long move still stops at a wall.
      const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(Math.hypot(dx, dz) / (worldStep() / 2))));
      let x = previous.x;
      let z = previous.z;
      // Where the camera stands now (crouching if the ceiling is low).
      let next: Stand = { ground, head: bodyFits(previous.x, previous.z, ground) ?? options.eyeHeight * MIN_CROUCH };
      let hit: WalkBlock | null = null;
      for (let i = 0; i < steps; i++) {
        const nx = x + dx / steps;
        const nz = z + dz / steps;
        const ahead = standAt(nx, nz, next.ground);
        if (ahead !== null) {
          [x, z, next] = [nx, nz, ahead];
          continue;
        }
        hit ??= lastFailure;
        // Slide along whatever was hit, at any angle: the step turned away
        // from it as little as works (shortened by the cosine, as sliding
        // along a wall does), around a corner too.
        const slid = slide(x, z, dx / steps, dz / steps, next.ground, lastFailure);
        if (slid === null) break;
        [x, z, next] = slid;
      }
      target.x = x;
      target.z = z;
      feet = next.ground;
      if (dx !== 0 || dz !== 0) block = hit;
      const eye = next.ground + next.head;
      const ease = 1 - Math.exp(-EASE_RATE * Math.max(dt, 0));
      // Vertical input is ignored; the eye eases to its height over the ground.
      target.y = previous.y + (eye - previous.y) * ease;
      const settled = Math.abs(eye - target.y) < 1e-3;
      if (settled) target.y = eye;
      placed.copy(target);
      return !settled;
    },
  };
  return walker;
}
