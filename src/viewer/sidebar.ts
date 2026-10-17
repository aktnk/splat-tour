import { entranceTargetLabel, type Entrance, type Manifest } from "../core/manifest";

// Table of contents of the tour: a drawer on the left, opened with the "☰"
// button, listing every scene with its entrances. Choosing a scene goes to its
// first view; choosing an entrance does what clicking its icon would (the
// tour decides how, see tour.ts). The drawer closes after a choice.

export interface Sidebar {
  /** Highlights the scene being shown. */
  setCurrent(sceneId: string): void;
  close(): void;
  isOpen(): boolean;
}

export interface SidebarHandlers {
  onScene(sceneId: string): void;
  onEntrance(sceneId: string, entrance: Entrance): void;
  onOpenChange?(open: boolean): void;
  /**
   * Rows whose description shows beside them: on mouse hover, or on the
   * first tap on touch screens (the second tap, or "開く", opens).
   */
  describes?(entrance: Entrance): boolean;
  onDescribe?(entrance: Entrance, row: HTMLElement): void;
  onDescribeEnd?(): void;
  isDescribing?(entrance: Entrance): boolean;
}

// Same colours as the coins (entrance-markers.ts).
function badgeClass(entrance: Entrance): string {
  return entrance.target.type === "scene" ? entrance.kind : entrance.target.type;
}

export function setupSidebar(manifest: Manifest, handlers: SidebarHandlers): Sidebar {
  const toggle = document.getElementById("sidebar-toggle") as HTMLButtonElement;
  const sidebar = document.getElementById("sidebar") as HTMLElement;
  const backdrop = document.getElementById("sidebar-backdrop") as HTMLElement;
  const titleEl = document.getElementById("sidebar-title") as HTMLElement;
  const list = document.getElementById("sidebar-list") as HTMLElement;
  const sceneItems = new Map<string, HTMLElement>();
  let open = false;

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    // The button just pressed inside the drawer must not keep focus in a
    // hidden part of the page (browsers warn and screen readers lose it).
    if (!open && sidebar.contains(document.activeElement)) {
      toggle.focus();
    }
    sidebar.classList.toggle("open", open);
    backdrop.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    // inert hides the closed drawer from assistive technology and keyboard focus.
    sidebar.inert = !open;
    handlers.onOpenChange?.(open);
  }

  titleEl.textContent = manifest.title;
  for (const scene of manifest.scenes) {
    const sceneButton = document.createElement("button");
    sceneButton.type = "button";
    sceneButton.className = "sidebar-scene";
    sceneButton.textContent = scene.title;
    sceneButton.addEventListener("click", () => {
      setOpen(false);
      handlers.onScene(scene.id);
    });

    const entranceList = document.createElement("ul");
    for (const entrance of scene.entrances) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sidebar-entrance";
      const badge = document.createElement("span");
      badge.className = `sidebar-badge ${badgeClass(entrance)}`;
      const title = document.createElement("span");
      title.className = "sidebar-entrance-title";
      title.textContent = entrance.title;
      const target = document.createElement("span");
      target.className = "sidebar-entrance-target";
      // A viewpoint leads nowhere else; its title says enough.
      target.textContent = entrance.target.type === "view" ? "" : entranceTargetLabel(manifest, entrance);
      button.append(badge, title, target);
      const describes = handlers.describes?.(entrance) ?? false;
      let lastPointer = "mouse";
      button.addEventListener("pointerdown", (event) => {
        lastPointer = event.pointerType;
      });
      if (describes) {
        button.addEventListener("pointerenter", (event) => {
          if (event.pointerType === "mouse") handlers.onDescribe?.(entrance, button);
        });
        button.addEventListener("pointerleave", (event) => {
          if (event.pointerType === "mouse") handlers.onDescribeEnd?.();
        });
      }
      button.addEventListener("click", () => {
        if (describes && lastPointer !== "mouse" && !handlers.isDescribing?.(entrance)) {
          handlers.onDescribe?.(entrance, button);
          return;
        }
        setOpen(false);
        handlers.onEntrance(scene.id, entrance);
      });
      const li = document.createElement("li");
      li.append(button);
      entranceList.append(li);
    }

    const item = document.createElement("li");
    item.append(sceneButton);
    if (scene.entrances.length > 0) item.append(entranceList);
    list.append(item);
    sceneItems.set(scene.id, item);
  }

  toggle.addEventListener("click", () => setOpen(!open));
  (document.getElementById("sidebar-close") as HTMLButtonElement).addEventListener("click", () => setOpen(false));
  backdrop.addEventListener("click", () => setOpen(false));
  sidebar.inert = true;

  return {
    setCurrent(sceneId: string) {
      for (const [id, item] of sceneItems) {
        item.classList.toggle("current", id === sceneId);
      }
    },
    close: () => setOpen(false),
    isOpen: () => open,
  };
}
