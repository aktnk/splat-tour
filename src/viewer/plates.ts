import * as THREE from "three";
import type { Scene } from "../core/manifest";

// Plates covering holes in the scan (Scene.plates): a roof or a canopy with
// gaps, a floor with a hole. Each is a flat polygon through points on the
// hole's rim, fitted to a plane, standing in for the missing surface: the
// walker (walk.ts) stands on it, bumps into it and flies against it like the
// scan's voxels.
//
// A plate is solid in a slab under its plane (THICKNESS down, a little up),
// "under" being the side away from the sky (for an upright plate, either).
// Its points lie on the scan's surface around the hole, so its top is that
// surface: a floor plate is walked level with the floor around it, a roof
// plate holds a drone flying over the roof at the roof's height.

/** How deep a plate is solid below its plane (world units): thicker than the walker's samples. */
const THICKNESS = 0.2;
/** How far above its plane a plate is solid (world units), so its top is not missed between samples. */
const TOP = 0.02;

export interface Plates {
  /** A scene's plates (none for null); call once its root has its transform. */
  setScene(scene: Scene | null, root: THREE.Object3D): void;
  /** Whether the scene has any plate. */
  any(): boolean;
  /** Whether a world point is inside a plate. */
  solid(x: number, y: number, z: number): boolean;
  /** Draws the plates (for ?debug=1 and the authoring tool). */
  setVisible(visible: boolean): void;
}

interface Plate {
  /** Centre of its points and the plane's unit normal (up-facing), in world units. */
  center: THREE.Vector3;
  normal: THREE.Vector3;
  /** Two unit directions in the plane. */
  u: THREE.Vector3;
  v: THREE.Vector3;
  /** The outline in the plane (along u, v from the centre). */
  outline: THREE.Vector2[];
  /** Squared radius around the centre holding the whole slab. */
  reach2: number;
}

/** The plane through world points (Newell's normal, facing up), or null if they lie on a line. */
function fit(points: THREE.Vector3[]): Plate | null {
  const center = new THREE.Vector3();
  for (const p of points) center.add(p);
  center.divideScalar(points.length);
  const normal = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    normal.x += (a.y - b.y) * (a.z + b.z);
    normal.y += (a.z - b.z) * (a.x + b.x);
    normal.z += (a.x - b.x) * (a.y + b.y);
  }
  if (normal.lengthSq() < 1e-12) return null;
  normal.normalize();
  if (normal.y < 0) normal.negate();
  // In-plane directions: from the axis least along the normal.
  const axis = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(axis, normal).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u);
  const offset = new THREE.Vector3();
  let reach = 0;
  const outline = points.map((p) => {
    offset.subVectors(p, center);
    reach = Math.max(reach, offset.length());
    return new THREE.Vector2(offset.dot(u), offset.dot(v));
  });
  reach += THICKNESS;
  return { center, normal, u, v, outline, reach2: reach * reach };
}

/** Whether (a, b) is inside an outline (even-odd rule). */
function insideOutline(outline: THREE.Vector2[], a: number, b: number): boolean {
  let hit = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const pi = outline[i];
    const pj = outline[j];
    if (pi.y > b !== pj.y > b && a < ((pj.x - pi.x) * (b - pi.y)) / (pj.y - pi.y) + pi.x) hit = !hit;
  }
  return hit;
}

export function setupPlates(scene: THREE.Scene): Plates {
  let plates: Plate[] = [];
  const group = new THREE.Group();
  group.name = "plates";
  group.visible = false;
  scene.add(group);
  const fill = new THREE.MeshBasicMaterial({
    color: 0x7cf29a,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const edge = new THREE.LineBasicMaterial({ color: 0x7cf29a, transparent: true, opacity: 0.9, depthTest: false });
  const offset = new THREE.Vector3();

  function draw(): void {
    for (const child of group.children) (child as THREE.Mesh).geometry.dispose();
    group.clear();
    if (!group.visible) return;
    for (const p of plates) {
      // The outline on its plane, back in world units.
      const world = p.outline.map((q) => p.center.clone().addScaledVector(p.u, q.x).addScaledVector(p.v, q.y));
      const triangles = THREE.ShapeUtils.triangulateShape(p.outline, []);
      const geometry = new THREE.BufferGeometry().setFromPoints(world);
      geometry.setIndex(triangles.flat());
      group.add(new THREE.Mesh(geometry, fill));
      group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(world), edge));
    }
    for (const child of group.children) child.renderOrder = 999;
  }

  return {
    setScene(s, root) {
      plates = [];
      if (s) {
        root.updateMatrixWorld(true);
        for (const plate of s.plates) {
          if (plate.points.length < 3) continue;
          const fitted = fit(plate.points.map((p) => root.localToWorld(new THREE.Vector3(...p))));
          if (fitted) plates.push(fitted);
        }
      }
      draw();
    },
    any: () => plates.length > 0,
    solid(x, y, z) {
      for (const p of plates) {
        offset.set(x - p.center.x, y - p.center.y, z - p.center.z);
        if (offset.lengthSq() > p.reach2) continue;
        const h = offset.dot(p.normal);
        if (h > TOP || h < -THICKNESS) continue;
        if (insideOutline(p.outline, offset.dot(p.u), offset.dot(p.v))) return true;
      }
      return false;
    },
    setVisible(visible) {
      group.visible = visible;
      draw();
    },
  };
}
