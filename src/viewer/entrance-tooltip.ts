import type { Entrance } from "../core/manifest";

// Description popup for an entrance (title, text, optional image). On touch
// screens it is also how an entrance is opened, via its "開く" button or a
// second tap on the icon.

export interface EntranceTooltip {
  show(entrance: Entrance, imageUrl: string | undefined): void;
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
  let shown: Entrance | null = null;

  openBtn.addEventListener("click", () => {
    if (shown) {
      onOpen(shown);
    }
  });

  return {
    show(entrance: Entrance, imageUrl: string | undefined) {
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
}
