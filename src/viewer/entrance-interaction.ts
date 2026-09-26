import * as THREE from "three";
import type { Entrance } from "../core/manifest";
import type { EntranceMarkers } from "./entrance-markers";
import type { EntranceTooltip } from "./entrance-tooltip";

// Pointer handling for entrances.
// Mouse: hovering an icon shows its description, clicking opens it.
// Touch: the first tap shows the description, a second tap (or "開く") opens it.
// A pointerup that moved more than CLICK_DRAG_THRESHOLD_PX is a look-drag.

const CLICK_DRAG_THRESHOLD_PX = 6;

export interface EntranceInteractionOptions {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  markers: EntranceMarkers;
  tooltip: EntranceTooltip;
  imageUrl(entrance: Entrance): string | undefined;
  isEnabled(): boolean;
  onActivate(entrance: Entrance): void;
  /** Click or tap that hit no entrance. */
  onEmptyClick?(ndc: THREE.Vector2): void;
  /** Something visible changed (hover highlight, popup). */
  onChange(): void;
}

export interface EntranceInteraction {
  /** Hides the popup and hover highlight, e.g. when leaving the scene. */
  reset(): void;
  /** Re-anchors the popup to its icon after the camera moved. */
  updatePopupPosition(): void;
}

export function setupEntranceInteraction(options: EntranceInteractionOptions): EntranceInteraction {
  const { canvas, camera, markers, tooltip } = options;
  let pointerDown: { x: number; y: number } | null = null;
  let pendingHover: PointerEvent | null = null;

  function ndcOf(event: PointerEvent): THREE.Vector2 {
    const rect = canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  function show(entrance: Entrance): void {
    markers.setHovered(entrance.id);
    tooltip.show(entrance, options.imageUrl(entrance));
    updatePopupPosition();
    options.onChange();
  }

  function reset(): void {
    markers.setHovered(null);
    tooltip.hide();
    canvas.style.cursor = "";
    options.onChange();
  }

  function updatePopupPosition(): void {
    const entrance = tooltip.current();
    const world = entrance ? markers.worldPosition(entrance.id) : undefined;
    if (!world) {
      return;
    }
    const ndc = world.project(camera);
    const onScreen = ndc.z < 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
    const rect = canvas.getBoundingClientRect();
    tooltip.moveTo(
      onScreen
        ? {
            x: rect.left + ((ndc.x + 1) / 2) * rect.width,
            y: rect.top + ((1 - ndc.y) / 2) * rect.height,
          }
        : null,
    );
  }

  // Hover picking runs at most once per animation frame.
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse" || pointerDown) {
      return;
    }
    if (!pendingHover) {
      requestAnimationFrame(() => {
        const e = pendingHover;
        pendingHover = null;
        if (!e || !options.isEnabled()) {
          return;
        }
        const hit = markers.pick(ndcOf(e), camera);
        if (hit) {
          canvas.style.cursor = "pointer";
          show(hit);
        } else if (tooltip.current()) {
          reset();
        }
      });
    }
    pendingHover = event;
  });

  canvas.addEventListener("pointerdown", (event) => {
    if (event.isPrimary) {
      pointerDown = { x: event.clientX, y: event.clientY };
    }
  });

  canvas.addEventListener("pointerup", (event) => {
    if (!event.isPrimary || !pointerDown) {
      return;
    }
    const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
    pointerDown = null;
    if (moved > CLICK_DRAG_THRESHOLD_PX || !options.isEnabled()) {
      return;
    }
    const ndc = ndcOf(event);
    const hit = markers.pick(ndc, camera);
    if (!hit) {
      if (event.pointerType !== "mouse") {
        reset();
      }
      options.onEmptyClick?.(ndc);
      return;
    }
    if (event.pointerType === "mouse" || tooltip.current()?.id === hit.id) {
      options.onActivate(hit);
    } else {
      show(hit);
    }
  });

  return { reset, updatePopupPosition };
}
