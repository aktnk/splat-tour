import type { Entrance } from "../core/manifest";

// Description popup for an entrance (title, text, optional image, optional
// capture of where it leads). On touch
// screens it is also how an entrance is opened, via its "開く" button or a
// second tap on the icon.

export interface TooltipMedia {
  /** The entrance's own image (`image`). */
  imageUrl?: string;
  /** Capture of the destination (`preview`), labelled with where it leads. */
  preview?: { url: string; label: string };
}

export interface EntranceTooltip {
  show(entrance: Entrance, media: TooltipMedia): void;
  hide(): void;
  current(): Entrance | null;
  /** Screen position (CSS px) of the icon, or null when it is off screen. */
  moveTo(position: { x: number; y: number } | null): void;
}

export function setupEntranceTooltip(onOpen: (entrance: Entrance) => void): EntranceTooltip {
  const el = document.getElementById("tooltip") as HTMLElement;
  const imageEl = document.getElementById("tooltip-image") as HTMLImageElement;
  const titleEl = document.getElementById("tooltip-title") as HTMLElement;
  const descriptionEl = document.getElementById("tooltip-description") as HTMLElement;
  const openBtn = document.getElementById("tooltip-open-btn") as HTMLButtonElement;
  const previewEl = document.getElementById("tooltip-preview") as HTMLElement;
  const previewImageEl = document.getElementById("tooltip-preview-image") as HTMLImageElement;
  const previewLabelEl = document.getElementById("tooltip-preview-label") as HTMLElement;
  let shown: Entrance | null = null;
  let lastPosition: { x: number; y: number } | null = null;

  // Images change the popup's height once loaded; keep it on screen.
  for (const img of [imageEl, previewImageEl]) {
    img.addEventListener("load", () => tooltip.moveTo(lastPosition));
  }

  openBtn.addEventListener("click", () => {
    if (shown) {
      onOpen(shown);
    }
  });

  const tooltip: EntranceTooltip = {
    show(entrance: Entrance, { imageUrl, preview }: TooltipMedia) {
      if (shown?.id === entrance.id) {
        return;
      }
      shown = entrance;
      titleEl.textContent = entrance.title;
      descriptionEl.textContent = entrance.description;
      descriptionEl.hidden = entrance.description === "";
      if (imageUrl) {
        imageEl.src = imageUrl;
        imageEl.alt = entrance.title;
        imageEl.hidden = false;
      } else {
        imageEl.removeAttribute("src");
        imageEl.hidden = true;
      }
      if (preview) {
        previewImageEl.src = preview.url;
        previewImageEl.alt = preview.label;
        previewLabelEl.textContent = preview.label;
        previewEl.hidden = false;
      } else {
        previewImageEl.removeAttribute("src");
        previewEl.hidden = true;
      }
      el.hidden = false;
    },
    hide() {
      shown = null;
      el.hidden = true;
    },
    current() {
      return shown;
    },
    moveTo(position: { x: number; y: number } | null) {
      lastPosition = position;
      if (!shown) {
        return;
      }
      el.style.visibility = position ? "visible" : "hidden";
      if (!position) {
        return;
      }
      // Keep the popup on screen: prefer above-right of the icon.
      const margin = 8;
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      const x = Math.min(Math.max(position.x + 16, margin), window.innerWidth - width - margin);
      const y = Math.min(Math.max(position.y - height - 16, margin), window.innerHeight - height - margin);
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    },
  };
  return tooltip;
}
