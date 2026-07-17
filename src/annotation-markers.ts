import * as THREE from "three";
import type { AnnotationStore } from "./annotation-store";

const SPRITE_SCALE = 0.2;

function createIconTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

  const noteColor = "#3c82f6";
  const foldColor = "#2f68c9";
  const x = 8;
  const y = 6;
  const w = 48;
  const h = 52;
  const radius = 6;
  const fold = 14;

  // Note body (rounded rect with a folded top-right corner)
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - fold, y);
  ctx.lineTo(x + w, y + fold);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
  ctx.fillStyle = noteColor;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();

  // Folded corner
  ctx.beginPath();
  ctx.moveTo(x + w - fold, y);
  ctx.lineTo(x + w, y + fold);
  ctx.lineTo(x + w - fold, y + fold);
  ctx.closePath();
  ctx.fillStyle = foldColor;
  ctx.fill();

  // Text lines
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (const ly of [y + h * 0.45, y + h * 0.62, y + h * 0.79]) {
    ctx.beginPath();
    ctx.moveTo(x + 8, ly);
    ctx.lineTo(x + w - 10, ly);
    ctx.stroke();
  }

  return new THREE.CanvasTexture(canvas);
}

export interface AnnotationMarkers {
  group: THREE.Group;
  getAnnotationId(object: THREE.Object3D | null): string | undefined;
  getSprite(id: string): THREE.Sprite | undefined;
}

export function setupAnnotationMarkers(
  scene: THREE.Scene,
  store: AnnotationStore,
): AnnotationMarkers {
  const group = new THREE.Group();
  scene.add(group);

  const texture = createIconTexture();
  const spritesById = new Map<string, THREE.Sprite>();

  function sync(): void {
    const annotations = store.getAll();
    const currentIds = new Set(annotations.map((a) => a.id));

    for (const [id, sprite] of spritesById) {
      if (!currentIds.has(id)) {
        group.remove(sprite);
        spritesById.delete(id);
      }
    }

    for (const annotation of annotations) {
      let sprite = spritesById.get(annotation.id);
      if (!sprite) {
        const material = new THREE.SpriteMaterial({
          map: texture,
          transparent: false,
          alphaTest: 0.5,
          toneMapped: false,
        });
        sprite = new THREE.Sprite(material);
        sprite.scale.setScalar(SPRITE_SCALE);
        sprite.userData.annotationId = annotation.id;
        group.add(sprite);
        spritesById.set(annotation.id, sprite);
      }
      sprite.position.set(
        annotation.position.x,
        annotation.position.y,
        annotation.position.z,
      );
    }
  }

  store.subscribe(sync);
  sync();

  return {
    group,
    getAnnotationId(object: THREE.Object3D | null) {
      return object?.userData.annotationId as string | undefined;
    },
    getSprite(id: string) {
      return spritesById.get(id);
    },
  };
}
