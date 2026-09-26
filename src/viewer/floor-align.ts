import * as THREE from "three";
import type { Vec3 } from "../core/manifest";

// Levels a tilted capture: from three points on the floor (scene-local
// coordinates) finds the scene rotation that turns the floor's normal into
// world up, so looking around with the controls stays horizontal.

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Returns the scene rotation in degrees (XYZ Euler), or null when the points
 * are (nearly) on one line. `viewer` is a scene-local point above the floor
 * (the camera), used to pick which side of the floor is up.
 */
export function levelingRotation(points: [Vec3, Vec3, Vec3], viewer: Vec3): Vec3 | null {
  const [a, b, c] = points.map((p) => new THREE.Vector3(...p));
  const normal = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
  const longestEdge = Math.max(b.distanceTo(a), c.distanceTo(a), c.distanceTo(b));
  if (normal.length() < 1e-3 * longestEdge * longestEdge) {
    return null;
  }
  normal.normalize();
  if (normal.dot(new THREE.Vector3(...viewer).sub(a)) < 0) {
    normal.negate();
  }
  const quaternion = new THREE.Quaternion().setFromUnitVectors(normal, UP);
  const euler = new THREE.Euler().setFromQuaternion(quaternion, "XYZ");
  const deg = (r: number) => Math.round((r * 180) / Math.PI * 10) / 10;
  return [deg(euler.x), deg(euler.y), deg(euler.z)];
}
