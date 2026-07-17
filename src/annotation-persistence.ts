import { invoke } from "@tauri-apps/api/core";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { AnnotationStore } from "./annotation-store";
import type { Annotation } from "./types";

export function sidecarPathFor(splatPath: string): string {
  return `${splatPath}.annotations.json`;
}

// The dialog plugin only grants fs scope to the exact splat file path the
// user picked, not to sibling files in the same folder, so the sidecar path
// needs its own explicit scope grant before it can be read/written.
function ensureSidecarScope(sidecarPath: string): Promise<void> {
  return invoke("allow_sidecar_path", { path: sidecarPath });
}

export async function loadAnnotationsForFile(
  store: AnnotationStore,
  splatPath: string,
): Promise<boolean> {
  const sidecarPath = sidecarPathFor(splatPath);
  try {
    await ensureSidecarScope(sidecarPath);
    const fileExists = await exists(sidecarPath);
    if (!fileExists) {
      store.replaceAll([]);
      return false;
    }
    const text = await readTextFile(sidecarPath);
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error("sidecar annotations file is not a JSON array");
    }
    store.replaceAll(parsed as Annotation[]);
    return true;
  } catch (err) {
    console.warn(
      `[annotations] failed to read sidecar file at ${sidecarPath}; starting with no annotations`,
      err,
    );
    store.replaceAll([]);
    return false;
  }
}

let writeChain: Promise<void> = Promise.resolve();

export function saveAnnotationsForFile(
  splatPath: string,
  annotations: Annotation[],
): Promise<void> {
  const sidecarPath = sidecarPathFor(splatPath);
  const payload = JSON.stringify(annotations, null, 2);
  writeChain = writeChain
    .then(() => ensureSidecarScope(sidecarPath))
    .then(() => writeTextFile(sidecarPath, payload))
    .catch((err) => {
      console.warn(
        `[annotations] failed to write sidecar file at ${sidecarPath}`,
        err,
      );
    });
  return writeChain;
}
