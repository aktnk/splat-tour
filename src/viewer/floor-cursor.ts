import * as THREE from "three";

// The ring under the mouse where a click would walk to: on the floor, or
// flat against the wall the walk would end at. Drawn over the splats (no
// depth test), as they are blended over opaque geometry and a ring on a
// surface would be lost in them.

export interface FloorCursor {
  /**
   * Shows the ring at a world point, lying flat on the floor, or facing
   * `normal` (flat against a wall); hides it for null.
   */
  set(point: THREE.Vector3 | null, normal?: THREE.Vector3): void;
  visible(): boolean;
}

const RADIUS = 0.25;

export function setupFloorCursor(scene: THREE.Scene): FloorCursor {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(RADIUS * 0.72, RADIUS, 40),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.7,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 999;
  ring.visible = false;
  scene.add(ring);
  return {
    set(point, normal) {
      ring.visible = point !== null;
      if (!point) return;
      if (normal) {
        // The ring faces +z: turn it to the wall's normal, just off its face.
        ring.position.copy(point).addScaledVector(normal, 0.02);
        ring.lookAt(ring.position.clone().add(normal));
      } else {
        ring.rotation.set(-Math.PI / 2, 0, 0);
        ring.position.copy(point).y += 0.01;
      }
    },
    visible: () => ring.visible,
  };
}
