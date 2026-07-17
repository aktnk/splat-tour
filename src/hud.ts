export interface Hud {
  isVisible(): boolean;
}

export function setupHud(): Hud {
  const overlay = document.getElementById("hud-overlay") as HTMLElement;
  const toggleBtn = document.getElementById(
    "hud-toggle-btn",
  ) as HTMLButtonElement;

  let visible = false;

  function applyVisibility(): void {
    overlay.classList.toggle("hidden", !visible);
    toggleBtn.classList.toggle("active", visible);
  }

  toggleBtn.addEventListener("click", () => {
    visible = !visible;
    applyVisibility();
  });

  applyVisibility();

  return {
    isVisible() {
      return visible;
    },
  };
}
