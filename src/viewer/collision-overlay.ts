import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

// ?debug=1 aid for the walking mode: shows a collision mesh made by
// splat-transform (`--collision-mesh`, .collision.glb) over the scene, in its
// local frame (under SplatView.root, like the splat), to check that it lines
// up and what it blocks. Floors, walls and ceilings are coloured by facing.
// Axis corrections help find out how the tool's frame relates to the splat's.

export type AxisCorrection = "" | "x" | "y" | "z";

export interface CollisionOverlayInfo {
  triangles: number;
  bytes: number;
  /** Size of the mesh's bounding box in scene-local units. */
  size: [number, number, number];
}

export interface CollisionOverlay {
  /** Loads a GLB file; replaces the previous mesh. */
  load(file: File): Promise<CollisionOverlayInfo>;
  setOptions(options: { axis: AxisCorrection; wireframe: boolean; visible: boolean }): void;
  clear(): void;
}

const ROTATIONS: Record<AxisCorrection, THREE.Euler> = {
  "": new THREE.Euler(0, 0, 0),
  x: new THREE.Euler(Math.PI, 0, 0),
  y: new THREE.Euler(0, Math.PI, 0),
  z: new THREE.Euler(0, 0, Math.PI),
};

export function setupCollisionOverlay(root: THREE.Object3D, onChange: () => void): CollisionOverlay {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const holder = new THREE.Group();
  holder.name = "collision-overlay";
  root.add(holder);
  // Normals in view space make floors, walls and ceilings different colours.
  // Faces are shaded flat; wireframe lines have no face, so they use the
  // vertex normals (computed when the mesh has none).
  const material = new THREE.MeshNormalMaterial({
    flatShading: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  let model: THREE.Object3D | null = null;

  function clear(): void {
    if (!model) return;
    holder.remove(model);
    model.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.geometry.dispose();
    });
    model = null;
    onChange();
  }

  return {
    async load(file) {
      const gltf = await loader.parseAsync(await file.arrayBuffer(), "");
      clear();
      model = gltf.scene;
      let triangles = 0;
      model.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        obj.material = material;
        // Drawn after the splats, which would otherwise cover it.
        obj.renderOrder = 1000;
        if (!obj.geometry.attributes.normal) obj.geometry.computeVertexNormals();
        // Not pickable: clicks report the splat surface as before.
        obj.raycast = () => {};
        const index = obj.geometry.index;
        triangles += (index ? index.count : obj.geometry.attributes.position.count) / 3;
      });
      holder.add(model);
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      // Measured in the scene's local frame, without the scene transform.
      box.applyMatrix4(new THREE.Matrix4().copy(root.matrixWorld).invert());
      const size = box.getSize(new THREE.Vector3());
      onChange();
      return { triangles: Math.round(triangles), bytes: file.size, size: [size.x, size.y, size.z] };
    },
    setOptions({ axis, wireframe, visible }) {
      holder.rotation.copy(ROTATIONS[axis]);
      material.wireframe = wireframe;
      material.flatShading = !wireframe;
      material.needsUpdate = true;
      holder.visible = visible;
      onChange();
    },
    clear,
  };
}
