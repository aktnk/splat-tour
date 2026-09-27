import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

// Full-screen viewer for a GLB model: its own scene and camera, rotated and
// zoomed with OrbitControls (mouse drag / wheel, one-finger rotate, pinch).
// The splat scene stays loaded underneath so "戻る" returns instantly.
//
// Lighting: scanned models were too dark with a couple of direct lights, so
// the scene gets image-based light from a neutral room environment plus a
// headlight that follows the camera, and is rendered with neutral tone
// mapping (the splat scene's ACES darkens and desaturates). Materials that
// are fully metallic without a metalness map are treated as non-metal: that
// is the glTF default when an exporter omits it, and such "metal" only
// reflects the environment instead of showing its colour.

export interface MeshScreen {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Loads and frames the model; rejects if it cannot be loaded. */
  open(url: string, exposure: number): Promise<void>;
  close(): void;
  /** Applies pending control input; true when the view changed. */
  update(): boolean;
  render(): void;
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

function useNonMetalDefaults(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial && material.metalness >= 0.99 && !material.metalnessMap) {
        material.metalness = 0;
      }
    }
  });
}

export function setupMeshScreen(canvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer): MeshScreen {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#1b1d22");
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 1000);
  const headlight = new THREE.DirectionalLight(0xffffff, 1.5);
  headlight.position.set(0.5, 1, 1);
  camera.add(headlight);
  scene.add(camera);
  let exposure = 1;
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
    async open(url: string, modelExposure: number) {
      close();
      exposure = modelExposure;
      const gltf = await loader.loadAsync(url);
      model = gltf.scene;
      useNonMetalDefaults(model);
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
    render() {
      const { toneMapping, toneMappingExposure } = renderer;
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = exposure;
      renderer.render(scene, camera);
      renderer.toneMapping = toneMapping;
      renderer.toneMappingExposure = toneMappingExposure;
    },
  };
}
