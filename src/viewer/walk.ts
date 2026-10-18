import * as THREE from "three";
import type { VoxelGrid } from "./voxel-grid";

// Walking on a voxel grid (voxel-grid.ts): the camera stays eyeHeight above
// the ground under it, steps up and down by at most stepHeight (stairs),
// stops at walls and slides along them, and never walks off where there is
// no ground (a hole in a scan is a no-go spot, not a pit). The body is a
// column of `radius` from just above the step height to the eyes.
//
// Distances are in world units; the grid answers in scene-local units, so
// points go through the scene root (its rotation levels the floor, its
// scale is the scene's). World +Y is up.

export interface WalkOptions {
  eyeHeight: number;
  radius: number;
  stepHeight: number;
}

export interface Walker {
  /** The grid of the current scene and its root, or null to stop walking. */
  setGrid(grid: VoxelGrid | null, root: THREE.Object3D | null): void;
  setOptions(options: WalkOptions): void;
  setEnabled(enabled: boolean): void;
  grid(): VoxelGrid | null;
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

export function setupWalker(initial: WalkOptions): Walker {
  let grid: VoxelGrid | null = null;
  let root: THREE.Object3D | null = null;
  let options = initial;
  let enabled = false;
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

  /** Top of the highest solid voxel at (x, z) between `top` and `bottom` (world y), or null. */
  function surface(x: number, z: number, top: number, bottom: number): number | null {
    const step = worldStep() / 2;
    let wasFree = !solid(x, top, z);
    for (let y = top - step; y >= bottom; y -= step) {
      const isSolid = solid(x, y, z);
      if (isSolid && wasFree) return y + step / 2;
      wasFree = !isSolid;
    }
    return null;
  }

  /** Whether the body fits standing on `ground` at (x, z). */
  function bodyFree(x: number, z: number, ground: number): boolean {
    const { eyeHeight, radius, stepHeight } = options;
    const step = worldStep();
    for (let h = ground + stepHeight + step / 2; h <= ground + eyeHeight; h += step) {
      if (solid(x, h, z)) return false;
      for (let i = 0; i < DIRECTIONS; i++) {
        const a = (i / DIRECTIONS) * Math.PI * 2;
        if (solid(x + Math.cos(a) * radius, h, z + Math.sin(a) * radius)) return false;
      }
    }
    return true;
  }

  /** The ground to stand on at (x, z) coming from `ground`, or null if it cannot be walked to. */
  function standAt(x: number, z: number, ground: number): number | null {
    const { stepHeight } = options;
    // Up a step at most, down as far as a step plus some slack for slopes.
    const next = surface(x, z, ground + stepHeight + worldStep(), ground - stepHeight - worldStep());
    if (next === null || !bodyFree(x, z, next)) return null;
    return next;
  }

  const walker: Walker = {
    setGrid(g, r) {
      grid = g;
      root = r;
      if (!g) enabled = false;
    },
    setOptions(o) {
      options = o;
    },
    setEnabled(on) {
      enabled = on && grid !== null;
    },
    isEnabled: () => enabled,
    grid: () => grid,
    groundAt(position, from = position.y) {
      if (!grid || !root) return null;
      return surface(position.x, position.z, from, from - options.eyeHeight * LANDING_SEARCH);
    },
    constrain(camera, previous, dt) {
      if (!enabled || !grid || !root) return false;
      const { eyeHeight } = options;
      // Where the feet are now: the first ground below the previous eye.
      const ground = walker.groundAt(previous);
      if (ground === null) {
        // Nothing below (e.g. started in the air over a hole): leave the camera free.
        return false;
      }
      const target = camera.position;
      // In short steps, so a slow frame's long move still stops at a wall.
      const dx = target.x - previous.x;
      const dz = target.z - previous.z;
      const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(Math.hypot(dx, dz) / (worldStep() / 2))));
      let x = previous.x;
      let z = previous.z;
      let next = ground;
      for (let i = 0; i < steps; i++) {
        const nx = x + dx / steps;
        const nz = z + dz / steps;
        const ahead = standAt(nx, nz, next);
        if (ahead !== null) {
          [x, z, next] = [nx, nz, ahead];
          continue;
        }
        // Slide along the wall: keep one of the two horizontal components.
        const alongX = standAt(nx, z, next);
        if (alongX !== null) {
          [x, next] = [nx, alongX];
          continue;
        }
        const alongZ = standAt(x, nz, next);
        if (alongZ === null) break;
        [z, next] = [nz, alongZ];
      }
      target.x = x;
      target.z = z;
      const eye = next + eyeHeight;
      const ease = 1 - Math.exp(-EASE_RATE * Math.max(dt, 0));
      // Vertical input is ignored; the eye eases to its height over the ground.
      target.y = previous.y + (eye - previous.y) * ease;
      if (Math.abs(eye - target.y) < 1e-3) {
        target.y = eye;
        return false;
      }
      return true;
    },
  };
  return walker;
}
