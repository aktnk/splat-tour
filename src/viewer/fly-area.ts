import * as THREE from "three";
import type { Scene } from "../core/manifest";

// Where flying may go outdoors (Scene.flyArea): inside an outline drawn
// through points on the ground, from just above the lowest of them up
// `height`. A flight that would leave is held at the edge (sliding along
// it), so visitors cannot drift off into the unscanned dark around an
// outdoor capture. Walking is not limited by it (the voxels are its ground).
//
// The outline is taken in the horizontal plane of the world (its points go
// through the scene root, whose rotation levels the ground), so it may be
// any shape, not only convex.

/** How far above the outline's lowest point the camera stays (world units). */
const ABOVE_GROUND = 0.3;
/** How far inside the outline a camera held at its edge is put (world units). */
const INSIDE = 0.05;

export interface FlyArea {
  /** A scene's fly area (none for null or a scene without one); call once its root has its transform. */
  setScene(scene: Scene | null, root: THREE.Object3D): void;
  /** Flying: keeps a world point inside the area; true if it moved it. */
  constrain(position: THREE.Vector3): boolean;
  /** Draws the outline at the bottom and top of the area (for ?debug=1 and the authoring tool). */
  setVisible(visible: boolean): void;
}

interface Area {
  /** The outline in world xz. */
  xs: number[];
  zs: number[];
  bottom: number;
  top: number;
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

export function setupFlyArea(scene: THREE.Scene): FlyArea {
  let area: Area | null = null;
  const group = new THREE.Group();
  group.name = "fly-area";
  group.visible = false;
  scene.add(group);
  const material = new THREE.LineBasicMaterial({ color: 0x4fd1ff, transparent: true, opacity: 0.8, depthTest: false });

  function draw(): void {
    for (const child of group.children) (child as THREE.Line).geometry.dispose();
    group.clear();
    if (!area || !group.visible) return;
    const ring = (y: number) =>
      new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(area!.xs.map((x, i) => new THREE.Vector3(x, y, area!.zs[i]))),
        material,
      );
    group.add(ring(area.bottom), ring(area.top));
    const posts: THREE.Vector3[] = [];
    area.xs.forEach((x, i) => posts.push(new THREE.Vector3(x, area!.bottom, area!.zs[i]), new THREE.Vector3(x, area!.top, area!.zs[i])));
    group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(posts), material));
    for (const child of group.children) child.renderOrder = 999;
  }

  return {
    setScene(s, root) {
      area = null;
      const fly = s?.flyArea;
      if (fly && fly.points.length >= 3) {
        root.updateMatrixWorld(true);
        const world = fly.points.map((p) => root.localToWorld(new THREE.Vector3(...p)));
        const bottom = Math.min(...world.map((p) => p.y));
        area = {
          xs: world.map((p) => p.x),
          zs: world.map((p) => p.z),
          bottom: bottom + ABOVE_GROUND,
          top: bottom + fly.height,
        };
      }
      draw();
    },
    constrain(position) {
      if (!area) return false;
      let changed = false;
      if (!inside(area, position.x, position.z)) {
        const [x, z] = nearestInside(area, position.x, position.z);
        position.x = x;
        position.z = z;
        changed = true;
      }
      const y = Math.min(area.top, Math.max(area.bottom, position.y));
      if (y !== position.y) {
        position.y = y;
        changed = true;
      }
      return changed;
    },
    setVisible(visible) {
      group.visible = visible;
      draw();
    },
  };
}
