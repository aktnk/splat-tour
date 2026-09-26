import * as THREE from "three";
import type { Entrance } from "../core/manifest";

// One screen-size-constant sprite per entrance, placed under the scene root so
// it follows the scene transform. Drawn on top of the splats so an entrance
// behind a wall is still findable.

const ICON_SIZE = 0.07; // fraction of the view height at distance 1
const HOVER_SCALE = 1.25;

type IconKind = "entrance" | "exit" | "mesh" | "url";

const ICON_STYLE: Record<IconKind, { color: string; glyph: string }> = {
  entrance: { color: "#2f6fe0", glyph: "→" },
  exit: { color: "#e07a2f", glyph: "←" },
  mesh: { color: "#2e9d5b", glyph: "3D" },
  url: { color: "#8a4fd6", glyph: "Web" },
};

function iconKind(entrance: Entrance): IconKind {
  if (entrance.target.type === "mesh") return "mesh";
  if (entrance.target.type === "url") return "url";
  return entrance.kind;
}

function createIconTexture(kind: IconKind): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const { color, glyph } = ICON_STYLE[kind];

  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${glyph.length > 1 ? 36 : 56}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(glyph, size / 2, size / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export interface EntranceMarkers {
  setEntrances(entrances: Entrance[], rootScale: number): void;
  /** Entrance under the given normalized device coordinates, if any. */
  pick(ndc: THREE.Vector2, camera: THREE.Camera): Entrance | undefined;
  setHovered(id: string | null): void;
  /** World position of an entrance's icon. */
  worldPosition(id: string): THREE.Vector3 | undefined;
}

export function setupEntranceMarkers(root: THREE.Object3D): EntranceMarkers {
  const group = new THREE.Group();
  root.add(group);
  const textures = new Map<IconKind, THREE.CanvasTexture>();
  const raycaster = new THREE.Raycaster();
  let entrancesById = new Map<string, Entrance>();
  let spritesById = new Map<string, THREE.Sprite>();
  let baseScale = ICON_SIZE;
  let hoveredId: string | null = null;

  function textureFor(kind: IconKind): THREE.CanvasTexture {
    let texture = textures.get(kind);
    if (!texture) {
      texture = createIconTexture(kind);
      textures.set(kind, texture);
    }
    return texture;
  }

  function clear(): void {
    for (const sprite of spritesById.values()) {
      group.remove(sprite);
      sprite.material.dispose();
    }
    spritesById = new Map();
    entrancesById = new Map();
    hoveredId = null;
  }

  return {
    setEntrances(entrances: Entrance[], rootScale: number) {
      clear();
      // The root scale would otherwise grow or shrink the icons.
      baseScale = ICON_SIZE / rootScale;
      for (const entrance of entrances) {
        const material = new THREE.SpriteMaterial({
          map: textureFor(iconKind(entrance)),
          sizeAttenuation: false,
          depthTest: false,
          depthWrite: false,
          transparent: true,
          toneMapped: false,
        });
        const sprite = new THREE.Sprite(material);
        sprite.position.set(...entrance.position);
        sprite.scale.setScalar(baseScale);
        sprite.renderOrder = 10;
        sprite.userData.entranceId = entrance.id;
        group.add(sprite);
        spritesById.set(entrance.id, sprite);
        entrancesById.set(entrance.id, entrance);
      }
    },
    pick(ndc: THREE.Vector2, camera: THREE.Camera) {
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(group.children, false)[0];
      const id = hit?.object.userData.entranceId as string | undefined;
      return id ? entrancesById.get(id) : undefined;
    },
    setHovered(id: string | null) {
      if (id === hoveredId) {
        return;
      }
      if (hoveredId) {
        spritesById.get(hoveredId)?.scale.setScalar(baseScale);
      }
      hoveredId = id;
      if (id) {
        spritesById.get(id)?.scale.setScalar(baseScale * HOVER_SCALE);
      }
    },
    worldPosition(id: string) {
      return spritesById.get(id)?.getWorldPosition(new THREE.Vector3());
    },
  };
}
