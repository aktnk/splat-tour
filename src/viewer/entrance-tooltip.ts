import type { Entrance } from "../core/manifest";

// Description popup for an entrance (title, text, optional image, optional
// capture of where it leads). On touch screens it is also how an entrance is
// opened, via its "開く" button or a second tap. URLs in the description
// become links that open in a new tab.
//
// The popup is shown next to an entrance's icon, or beside its row in the
// table of contents. When the pointer leaves the icon or row it hides after
// a short delay, and stays while the pointer is over the popup itself, so
// its links can be clicked.

export interface TooltipMedia {
  /** The entrance's own image (`image`). */
  imageUrl?: string;
  /** Capture of the destination (`preview`), labelled with where it leads. */
  preview?: { url: string; label: string };
}

export interface EntranceTooltip {
  show(entrance: Entrance, media: TooltipMedia): void;
  hide(): void;
  /** Hides after a short delay unless the pointer moves onto the popup. */
  hideSoon(): void;
  current(): Entrance | null;
  /** Screen position (CSS px) of the icon, or null when it is off screen. */
  moveTo(position: { x: number; y: number } | null): void;
  /** Places the popup beside an element, e.g. a row of the table of contents. */
  placeBeside(rect: DOMRect): void;
}

export interface TooltipHandlers {
  onOpen(entrance: Entrance): void;
  /** The popup was hidden (directly or after hideSoon). */
  onHide?(): void;
}

const HIDE_DELAY_MS = 400;
const URL_PATTERN = /https?:\/\/[^\s<>"'（）「」『』、。]+/g;

/** Text with its URLs turned into links that open in a new tab. */
function linkify(target: HTMLElement, text: string): void {
  target.replaceChildren();
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    target.append(text.slice(last, index));
    const link = document.createElement("a");
    link.href = match[0];
    link.textContent = match[0];
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    target.append(link);
    last = index + match[0].length;
  }
  target.append(text.slice(last));
}

export function setupEntranceTooltip({ onOpen, onHide }: TooltipHandlers): EntranceTooltip {
  const el = document.getElementById("tooltip") as HTMLElement;
  const imageEl = document.getElementById("tooltip-image") as HTMLImageElement;
  const titleEl = document.getElementById("tooltip-title") as HTMLElement;
  const descriptionEl = document.getElementById("tooltip-description") as HTMLElement;
  const openBtn = document.getElementById("tooltip-open-btn") as HTMLButtonElement;
  const previewEl = document.getElementById("tooltip-preview") as HTMLElement;
  const previewImageEl = document.getElementById("tooltip-preview-image") as HTMLImageElement;
  const previewLabelEl = document.getElementById("tooltip-preview-label") as HTMLElement;
  let shown: Entrance | null = null;
  // Where the popup was last placed, to keep it on screen when images load.
  let placement: { point: { x: number; y: number } | null } | { beside: DOMRect } = { point: null };
  let hideTimer = 0;
  let pointerOver = false;

  for (const img of [imageEl, previewImageEl]) {
    img.addEventListener("load", () => place());
  }
  openBtn.addEventListener("click", () => {
    if (shown) {
      onOpen(shown);
    }
  });
  el.addEventListener("pointerenter", () => {
    pointerOver = true;
    window.clearTimeout(hideTimer);
  });
  el.addEventListener("pointerleave", (event) => {
    pointerOver = false;
    if (event.pointerType === "mouse") {
      tooltip.hideSoon();
    }
  });

  function clampTo(x: number, y: number): void {
    const margin = 8;
    const left = Math.min(Math.max(x, margin), window.innerWidth - el.offsetWidth - margin);
    const top = Math.min(Math.max(y, margin), window.innerHeight - el.offsetHeight - margin);
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  function place(): void {
    if (!shown) {
      return;
    }
    if ("beside" in placement) {
      el.style.visibility = "visible";
      const { beside } = placement;
      if (beside.right + 8 + el.offsetWidth <= window.innerWidth - 8) {
        clampTo(beside.right + 8, beside.top);
      } else if (beside.bottom + 8 + el.offsetHeight <= window.innerHeight - 8) {
        // No room beside it (phones): below, leaving the row tappable.
        clampTo(beside.left + 16, beside.bottom + 8);
      } else {
        clampTo(beside.left + 16, beside.top - el.offsetHeight - 8);
      }
      return;
    }
    const position = placement.point;
    el.style.visibility = position ? "visible" : "hidden";
    if (position) {
      // Prefer above-right of the icon.
      clampTo(position.x + 16, position.y - el.offsetHeight - 16);
    }
  }

  const tooltip: EntranceTooltip = {
    show(entrance: Entrance, { imageUrl, preview }: TooltipMedia) {
      window.clearTimeout(hideTimer);
      if (shown?.id === entrance.id) {
        return;
      }
      shown = entrance;
      titleEl.textContent = entrance.title;
      linkify(descriptionEl, entrance.description);
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
      window.clearTimeout(hideTimer);
      if (!shown) {
        return;
      }
      shown = null;
      pointerOver = false;
      el.hidden = true;
      onHide?.();
    },
    hideSoon() {
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        if (!pointerOver) {
          tooltip.hide();
        }
      }, HIDE_DELAY_MS);
    },
    current() {
      return shown;
    },
    moveTo(position) {
      placement = { point: position };
      place();
    },
    placeBeside(rect) {
      placement = { beside: rect };
      place();
    },
  };
  return tooltip;
}
