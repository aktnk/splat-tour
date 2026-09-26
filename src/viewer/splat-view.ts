import * as THREE from "three";
import { SplatMesh, type SparkRenderer } from "@sparkjsdev/spark";
import type { Scene, Vec3, View } from "../core/manifest";

// Owns the splat of the current scene. The splat and everything positioned in
// scene-local coordinates (entrance markers) live under `root`, which carries
// the scene transform, so a flip or scale moves them together.

const DEG = Math.PI / 180;

export interface SplatView {
  root: THREE.Group;
  getMesh(): SplatMesh | null;
  /** Replaces the current splat; resolves once it is initialized. */
  load(scene: Scene, url: string): Promise<void>;
  /** True until the loaded splat has produced visible splats. */
  isLoading(): boolean;
  /** True while streamed chunks are being fetched or uploaded. */
  isStreaming(): boolean;
  applyView(view: View): void;
  currentView(): View;
  toLocal(world: THREE.Vector3): Vec3;
}

export function setupSplatView(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  sparkRenderer: SparkRenderer,
): SplatView {
  const root = new THREE.Group();
  scene.add(root);
  let mesh: SplatMesh | null = null;

  function applyTransform(s: Scene): void {
    const { flipX, flipY, flipZ, scale } = s.transform;
    root.rotation.set(flipX ? Math.PI : 0, flipY ? Math.PI : 0, flipZ ? Math.PI : 0);
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);
  }

  const view: SplatView = {
    root,
    getMesh() {
      return mesh;
    },
    async load(s: Scene, url: string) {
      if (mesh) {
        root.remove(mesh);
        mesh.dispose();
        mesh = null;
      }
      applyTransform(s);
      sparkRenderer.focalAdjustment = s.render.focalAdjustment;
      camera.fov = s.camera.fov;
      camera.updateProjectionMatrix();

      const next = new SplatMesh({ url, paged: s.splat.paged });
      next.recolor.setScalar(s.render.exposure);
      mesh = next;
      root.add(next);
      await next.initialized;
    },
    isLoading() {
      return mesh !== null && (!mesh.isInitialized || sparkRenderer.activeSplats === 0);
    },
    isStreaming() {
      const pager = sparkRenderer.pager;
      return pager !== undefined && (pager.fetchers.length > 0 || pager.fetched.length > 0);
    },
    applyView(v: View) {
      camera.position.copy(root.localToWorld(new THREE.Vector3(...v.position)));
      camera.quaternion.setFromEuler(new THREE.Euler(v.pitch * DEG, v.yaw * DEG, 0, "YXZ"));
    },
    currentView() {
      const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
      return {
        position: view.toLocal(camera.position),
        yaw: Math.round((euler.y / DEG) * 10) / 10,
        pitch: Math.round((euler.x / DEG) * 10) / 10,
      };
    },
    toLocal(world: THREE.Vector3) {
      const local = root.worldToLocal(world.clone());
      const round = (n: number) => Math.round(n * 1000) / 1000;
      return [round(local.x), round(local.y), round(local.z)];
    },
  };
  return view;
}
