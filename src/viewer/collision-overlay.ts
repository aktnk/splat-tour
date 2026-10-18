import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { VoxelGrid } from "./voxel-grid";

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

export interface VoxelOverlay {
  /** Shows the solid voxels around a scene-local point, or nothing with a null grid. */
  show(grid: VoxelGrid | null, center: THREE.Vector3): void;
}

const VOXEL_RADIUS = 30; // in voxels around the camera
const VOXEL_LIMIT = 60000;

// ?debug=1: the solid voxels near the camera as small boxes, to compare the
// voxel data the walking mode uses with the scene and the collision mesh.
export function setupVoxelOverlay(root: THREE.Object3D, onChange: () => void): VoxelOverlay {
  const material = new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.35, depthWrite: false });
  let mesh: THREE.InstancedMesh | null = null;
  const matrix = new THREE.Matrix4();

  return {
    show(grid, center) {
      if (mesh) {
        root.remove(mesh);
        mesh.geometry.dispose();
        mesh.dispose();
        mesh = null;
      }
      if (grid) {
        const voxels = grid.solidVoxelsNear(center.x, center.y, center.z, VOXEL_RADIUS * grid.resolution, VOXEL_LIMIT);
        const size = grid.resolution * 0.9;
        mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(size, size, size), material, Math.max(voxels.length, 1));
        mesh.count = voxels.length;
        voxels.forEach(([x, y, z], i) => mesh?.setMatrixAt(i, matrix.makeTranslation(x, y, z)));
        mesh.renderOrder = 1000;
        mesh.raycast = () => {};
        root.add(mesh);
      }
      onChange();
    },
  };
}

