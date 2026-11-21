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
  /** Colour (e.g. 0xffffff) and opacity (0-1, of the box edges; their faces a third of it) of the boxes; orange at 0.45 by default. */
  setStyle(style: { color: number; opacity: number }): void;
  /**
   * How far around the point voxels are shown (scene-local units) and at
   * most how many (the nearest); null for the default, 30 voxels and 60000.
   * Applies from the next show().
   */
  setRange(radius: number | null, limit?: number): void;
}

const VOXEL_RADIUS = 30; // in voxels around the camera
const VOXEL_LIMIT = 60000;
// Far away, parts of the tree are drawn as one box once their edge is at most
// this times their distance (40 cm blocks of 10 cm voxels from about 13 m).
const VOXEL_DETAIL = 0.03;
// Brightness by face (+x, -x, +y, -y, +z, -z): lit from above, so boxes read
// as boxes even where only the front layer shows.
const FACE_SHADES = [0.78, 0.7, 1, 0.5, 0.88, 0.62];

/**
 * Each face drawn as a frame: its edges at full strength, its inside at a
 * third, so every box stays visible as a box while the scene shows through.
 */
function frameTexture(): THREE.CanvasTexture | null {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "rgba(255,255,255,1)";
  ctx.fillRect(0, 0, size, size);
  ctx.clearRect(3, 3, size - 6, size - 6);
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.fillRect(3, 3, size - 6, size - 6);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A unit cube whose faces are shaded by direction (vertex colours). */
function shadedCube(): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const colors: number[] = [];
  // BoxGeometry has 4 vertices per face, in the face order above.
  for (const shade of FACE_SHADES) for (let v = 0; v < 4; v++) colors.push(shade, shade, shade);
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

// ?debug=1: the solid voxels near the camera as small boxes, to compare the
// voxel data the walking mode uses with the scene and the collision mesh.
// Drawn nearest first with depth written, so only the front layer shows (one
// see-through layer over the splats, which write no depth); stacked layers
// of a wide range would hide the scene behind them.
export function setupVoxelOverlay(root: THREE.Object3D, onChange: () => void): VoxelOverlay {
  const material = new THREE.MeshBasicMaterial({
    color: 0xff9a3c,
    transparent: true,
    opacity: 0.45,
    depthWrite: true,
    vertexColors: true,
    map: frameTexture(),
  });
  const cube = shadedCube();
  let mesh: THREE.InstancedMesh | null = null;
  const matrix = new THREE.Matrix4();
  let range: number | null = null;
  let limit = VOXEL_LIMIT;

  return {
    setRange(radius, max = VOXEL_LIMIT) {
      range = radius;
      limit = max;
    },
    setStyle({ color, opacity }) {
      material.color.set(color);
      material.opacity = opacity;
      onChange();
    },
    show(grid, center) {
      if (mesh) {
        root.remove(mesh);
        mesh.dispose();
        mesh = null;
      }
      if (grid) {
        const boxes = grid.boxesNear(center.x, center.y, center.z, range ?? VOXEL_RADIUS * grid.resolution, limit, VOXEL_DETAIL);
        mesh = new THREE.InstancedMesh(cube, material, Math.max(boxes.length, 1));
        mesh.count = boxes.length;
        // A little smaller than the voxel, so neighbours stay apart.
        boxes.forEach(([x, y, z, edge], i) => {
          const size = edge - grid.resolution * 0.1;
          mesh?.setMatrixAt(i, matrix.makeScale(size, size, size).setPosition(x, y, z));
        });
        mesh.renderOrder = 1000;
        mesh.raycast = () => {};
        root.add(mesh);
      }
      onChange();
    },
  };
}

