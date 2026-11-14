import * as THREE from "three";

// The ring on the floor under the mouse where a click would walk to (or the
// spot a flight would head for). Drawn over the splats (no depth test), as
// they are blended over opaque geometry and a floor ring would be lost in them.

export interface FloorCursor {
  /** Shows the ring at a world point (lying flat), or hides it (null). */
  set(point: THREE.Vector3 | null): void;
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
    set(point) {
      ring.visible = point !== null;
      if (point) ring.position.copy(point).y += 0.01;
    },
    visible: () => ring.visible,
  };
}
