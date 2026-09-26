import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

// Full-screen viewer for a GLB model: its own scene and camera, rotated and
// zoomed with OrbitControls (mouse drag / wheel, one-finger rotate, pinch).
// The splat scene stays loaded underneath so "戻る" returns instantly.

export interface MeshScreen {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Loads and frames the model; rejects if it cannot be loaded. */
  open(url: string): Promise<void>;
  close(): void;
  /** Applies pending control input; true when the view changed. */
  update(): boolean;
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) value.dispose();
        }
        material.dispose();
      }
    }
  });
}

export function setupMeshScreen(canvas: HTMLCanvasElement): MeshScreen {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#1b1d22");
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.position.set(3, 5, 4);
  scene.add(key);

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 1000);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  let controls: OrbitControls | null = null;
  let model: THREE.Object3D | null = null;
  let changed = false;

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  function close(): void {
    controls?.dispose();
    controls = null;
    if (model) {
      scene.remove(model);
      disposeObject(model);
      model = null;
    }
  }

  return {
    scene,
    camera,
    async open(url: string) {
      close();
      const gltf = await loader.loadAsync(url);
      model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3()).length() || 1;
      model.position.sub(box.getCenter(new THREE.Vector3()));
      scene.add(model);

      camera.near = size / 100;
      camera.far = size * 100;
      camera.position.set(0, size * 0.2, size * 1.1);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();

      controls = new OrbitControls(camera, canvas);
      controls.minDistance = size * 0.2;
      controls.maxDistance = size * 5;
      controls.addEventListener("change", () => {
        changed = true;
      });
      changed = true;
    },
    close,
    update() {
      const result = changed;
      changed = false;
      return result;
    },
  };
}
