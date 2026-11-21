import * as THREE from "three";
import type { Scene } from "../core/manifest";

// The outer boundary of a scene (Scene.boundary): an outline drawn through
// points on the ground, standing as a wall of no height limit, so visitors
// cannot leave the capture into its unscanned dark, walking or flying.
// Walking, it joins the body's obstacles (walk.ts slides along it as along a
// scanned wall); flying, a move that would leave is held at the edge,
// sliding along it.
//
// The outline is taken in the horizontal plane of the world (its points go
// through the scene root, whose rotation levels the ground), so it may be
// any shape, not only convex.

/** How far inside the outline a camera held at its edge is put (world units). */
const INSIDE = 0.05;
/** How tall the drawn fence is (world units above the lowest point; the wall itself has no top). */
const DRAWN_HEIGHT = 10;

export interface Boundary {
  /** A scene's boundary (none for null or a scene without one); call once its root has its transform. */
  setScene(scene: Scene | null, root: THREE.Object3D): void;
  /** Whether a world point is outside the outline (always false without one). */
  outside(x: number, z: number): boolean;
  /** Flying: keeps a world point inside the outline; true if it moved it. */
  constrain(position: THREE.Vector3): boolean;
  /** Draws the outline as a fence (for ?debug=1 and the authoring tool). */
  setVisible(visible: boolean): void;
}

interface Area {
  /** The outline in world xz. */
  xs: number[];
  zs: number[];
  /** The lowest point (world y), where the drawn fence starts. */
  bottom: number;
}

/** Whether (x, z) is inside the outline (even-odd rule). */
function inside(a: Area, x: number, z: number): boolean {
  let hit = false;
  for (let i = 0, j = a.xs.length - 1; i < a.xs.length; j = i++) {
    const zi = a.zs[i];
    const zj = a.zs[j];
    if (zi > z !== zj > z && x < ((a.xs[j] - a.xs[i]) * (z - zi)) / (zj - zi) + a.xs[i]) hit = !hit;
  }
  return hit;
}

/** The nearest point of the outline to (x, z), moved INSIDE towards the inside of its edge. */
function nearestInside(a: Area, x: number, z: number): [number, number] {
  let best: [number, number] = [a.xs[0], a.zs[0]];
  let bestD = Infinity;
  for (let i = 0, j = a.xs.length - 1; i < a.xs.length; j = i++) {
    const ax = a.xs[j];
    const az = a.zs[j];
    const dx = a.xs[i] - ax;
    const dz = a.zs[i] - az;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = (x - px) ** 2 + (z - pz) ** 2;
    if (d < bestD) {
      bestD = d;
      best = [px, pz];
    }
  }
  // A little inside: towards the point the camera came from would be outside, so try both normals.
  const [px, pz] = best;
  const dx = px - x;
  const dz = pz - z;
  const len = Math.hypot(dx, dz) || 1;
  const candidate: [number, number] = [px + (dx / len) * INSIDE, pz + (dz / len) * INSIDE];
  return inside(a, candidate[0], candidate[1]) ? candidate : best;
}

export function setupBoundary(scene: THREE.Scene): Boundary {
  let area: Area | null = null;
  const group = new THREE.Group();
  group.name = "boundary";
  group.visible = false;
  scene.add(group);
  const material = new THREE.LineBasicMaterial({ color: 0x4fd1ff, transparent: true, opacity: 0.8, depthTest: false });

  function draw(): void {
    for (const child of group.children) (child as THREE.Line).geometry.dispose();
    group.clear();
    if (!area || !group.visible) return;
    const a = area;
    const ring = (y: number) =>
      new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(a.xs.map((x, i) => new THREE.Vector3(x, y, a.zs[i]))), material);
    const top = a.bottom + DRAWN_HEIGHT;
    group.add(ring(a.bottom), ring(top));
    const posts: THREE.Vector3[] = [];
    a.xs.forEach((x, i) => posts.push(new THREE.Vector3(x, a.bottom, a.zs[i]), new THREE.Vector3(x, top, a.zs[i])));
    group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(posts), material));
    for (const child of group.children) child.renderOrder = 999;
  }

  return {
    setScene(s, root) {
      area = null;
      const outline = s?.boundary;
      if (outline && outline.points.length >= 3) {
        root.updateMatrixWorld(true);
        const world = outline.points.map((p) => root.localToWorld(new THREE.Vector3(...p)));
        area = { xs: world.map((p) => p.x), zs: world.map((p) => p.z), bottom: Math.min(...world.map((p) => p.y)) };
      }
      draw();
    },
    outside(x, z) {
      return area !== null && !inside(area, x, z);
    },
    constrain(position) {
      if (!area || inside(area, position.x, position.z)) return false;
      const [x, z] = nearestInside(area, position.x, position.z);
      position.x = x;
      position.z = z;
      return true;
    },
    setVisible(visible) {
      group.visible = visible;
      draw();
    },
  };
}
