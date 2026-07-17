import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { Annotation } from "./types";

export type AnnotationListener = (annotations: Annotation[]) => void;

export interface AnnotationStore {
  getAll(): Annotation[];
  get(id: string): Annotation | undefined;
  add(input: Omit<Annotation, "id">): Annotation;
  update(id: string, patch: Partial<Omit<Annotation, "id">>): void;
  remove(id: string): void;
  replaceAll(next: Annotation[]): void;
  subscribe(listener: AnnotationListener): () => void;
  exportToFile(): Promise<void>;
  importFromFile(): Promise<void>;
}

export function setupAnnotationStore(): AnnotationStore {
  let annotations: Annotation[] = [];
  const listeners = new Set<AnnotationListener>();

  function notify(): void {
    for (const listener of listeners) {
      listener(annotations);
    }
  }

  const store: AnnotationStore = {
    getAll() {
      return annotations;
    },
    get(id: string) {
      return annotations.find((a) => a.id === id);
    },
    add(input: Omit<Annotation, "id">) {
      const annotation: Annotation = { ...input, id: crypto.randomUUID() };
      annotations = [...annotations, annotation];
      notify();
      return annotation;
    },
    update(id: string, patch: Partial<Omit<Annotation, "id">>) {
      annotations = annotations.map((a) =>
        a.id === id ? { ...a, ...patch } : a,
      );
      notify();
    },
    remove(id: string) {
      annotations = annotations.filter((a) => a.id !== id);
      notify();
    },
    replaceAll(next: Annotation[]) {
      annotations = next;
      notify();
    },
    subscribe(listener: AnnotationListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async exportToFile() {
      const path = await save({
        filters: [{ name: "Annotations", extensions: ["json"] }],
      });
      if (!path) {
        return;
      }
      await writeTextFile(path, JSON.stringify(annotations, null, 2));
    },
    async importFromFile() {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Annotations", extensions: ["json"] }],
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      const text = await readTextFile(selected);
      const parsed = JSON.parse(text) as Annotation[];
      store.replaceAll(parsed);
    },
  };

  return store;
}
