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
  };

  return store;
}
