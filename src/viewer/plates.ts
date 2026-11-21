import * as THREE from "three";
import type { Scene } from "../core/manifest";

// Plates covering holes in the scan (Scene.plates): a roof or a canopy with
// gaps, a floor with a hole. Each is a surface through points on the hole's
// rim, standing in for the missing surface: the walker (walk.ts) stands on
// it, bumps into it and flies against it like the scan's voxels.
//
// The surface passes through every point at its own height: the outline is
// cut into triangles (in the plane that fits the points best, so any shape,
// not only convex, is cut right), and each triangle is spanned by three of
// the points as clicked. Points at one height give a flat plate; points of a
// slope or of a warped rim give a plate that bends with them.
//
// Each triangle is solid in a slab under it (THICKNESS down, a little up),
// "under" being the side away from the sky (for an upright one, either).
// The points lie on the scan's surface around the hole, so the plate's top
// is that surface: a floor plate is walked level with the floor around it,
// a roof plate holds a drone flying over the roof at the roof's height.

/** How deep a plate is solid below its surface (world units): thicker than the walker's samples. */
const THICKNESS = 0.2;
/** How far above its surface a plate is solid (world units), so its top is not missed between samples. */
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

/** One triangle of a plate, ready for the inside test (world units). */
interface Triangle {
  /** A corner, and the unit normal (up-facing). */
  a: THREE.Vector3;
  normal: THREE.Vector3;
  /** The edges from `a`, and what the barycentric test needs of them. */
  e1: THREE.Vector3;
  e2: THREE.Vector3;
  d11: number;
  d12: number;
  d22: number;
  det: number;
}

interface Plate {
  /** The points (world) and the triangles' corner indices, for drawing. */
  points: THREE.Vector3[];
  indices: number[];
  triangles: Triangle[];
  /** Centre of the points and the squared radius around it holding every slab. */
  center: THREE.Vector3;
  reach2: number;
}

/** A plate through world points, or null if they lie on a line. */
function build(points: THREE.Vector3[]): Plate | null {
  const center = new THREE.Vector3();
  for (const p of points) center.add(p);
  center.divideScalar(points.length);
  // The plane that fits best (Newell's normal), only to cut the outline.
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
  const axis = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(axis, normal).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u);
  const offset = new THREE.Vector3();
  const outline = points.map((p) => {
    offset.subVectors(p, center);
    return new THREE.Vector2(offset.dot(u), offset.dot(v));
  });
  const indices = THREE.ShapeUtils.triangulateShape(outline, []).flat();
  const triangles: Triangle[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = points[indices[i]];
    const e1 = points[indices[i + 1]].clone().sub(a);
    const e2 = points[indices[i + 2]].clone().sub(a);
    const n = new THREE.Vector3().crossVectors(e1, e2);
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    if (n.y < 0) n.negate();
    const d11 = e1.dot(e1);
    const d12 = e1.dot(e2);
    const d22 = e2.dot(e2);
    triangles.push({ a, normal: n, e1, e2, d11, d12, d22, det: d11 * d22 - d12 * d12 });
  }
  if (triangles.length === 0) return null;
  let reach = 0;
  for (const p of points) reach = Math.max(reach, p.distanceTo(center));
  reach += THICKNESS;
  return { points, indices, triangles, center, reach2: reach * reach };
}

/** Whether a world offset from a triangle's corner is in its slab. */
function inSlab(t: Triangle, offset: THREE.Vector3): boolean {
  const h = offset.dot(t.normal);
  if (h > TOP || h < -THICKNESS) return false;
  // Where it falls on the triangle's plane, in barycentric coordinates.
  const p1 = offset.dot(t.e1);
  const p2 = offset.dot(t.e2);
  const b1 = (t.d22 * p1 - t.d12 * p2) / t.det;
  const b2 = (t.d11 * p2 - t.d12 * p1) / t.det;
  const EDGE = 1e-6;
  return b1 >= -EDGE && b2 >= -EDGE && b1 + b2 <= 1 + EDGE;
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
      const geometry = new THREE.BufferGeometry().setFromPoints(p.points);
      geometry.setIndex(p.indices);
      group.add(new THREE.Mesh(geometry, fill));
      group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(p.points), edge));
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
          const built = build(plate.points.map((p) => root.localToWorld(new THREE.Vector3(...p))));
          if (built) plates.push(built);
        }
      }
      draw();
    },
    any: () => plates.length > 0,
    solid(x, y, z) {
      for (const p of plates) {
        offset.set(x - p.center.x, y - p.center.y, z - p.center.z);
        if (offset.lengthSq() > p.reach2) continue;
        for (const t of p.triangles) {
          offset.set(x - t.a.x, y - t.a.y, z - t.a.z);
          if (inSlab(t, offset)) return true;
        }
      }
      return false;
    },
    setVisible(visible) {
      group.visible = visible;
      draw();
    },
  };
}
