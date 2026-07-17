import * as THREE from "three";
import { SplatFileType, SplatMesh } from "@sparkjsdev/spark";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";

const EXTENSION_TO_FILE_TYPE: Record<string, SplatFileType> = {
  ply: SplatFileType.PLY,
  splat: SplatFileType.SPLAT,
  spz: SplatFileType.SPZ,
  ksplat: SplatFileType.KSPLAT,
  sog: SplatFileType.PCSOGSZIP,
};

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

export type FlipAxis = "x" | "y" | "z";

export interface SplatLoader {
  currentMesh: SplatMesh | null;
  openFileDialog(): Promise<void>;
  flipModel(axis: FlipAxis): void;
}

export function setupSplatLoader(scene: THREE.Scene): SplatLoader {
  const loader: SplatLoader = {
    currentMesh: null,
    async openFileDialog() {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "3D Gaussian Splat",
            extensions: Object.keys(EXTENSION_TO_FILE_TYPE),
          },
        ],
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      await loadSplatFromPath(loader, scene, selected);
    },
    flipModel(axis: FlipAxis) {
      if (!loader.currentMesh) {
        return;
      }
      const current = loader.currentMesh.rotation[axis];
      loader.currentMesh.rotation[axis] = current === 0 ? Math.PI : 0;
    },
  };
  return loader;
}

async function loadSplatFromPath(
  loader: SplatLoader,
  scene: THREE.Scene,
  path: string,
): Promise<void> {
  const fileType = EXTENSION_TO_FILE_TYPE[extensionOf(path)];
  const fileBytes = await readFile(path);

  const mesh = new SplatMesh({
    fileBytes,
    fileType,
    fileName: path,
    raycastable: true,
  });
  await mesh.initialized;

  if (loader.currentMesh) {
    scene.remove(loader.currentMesh);
    loader.currentMesh.dispose();
  }

  scene.add(mesh);
  loader.currentMesh = mesh;
}
