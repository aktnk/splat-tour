// "歩く / 飛ぶ" switch, shown in scenes that have walk settings: walking keeps
// the camera on the floor (walk.ts), flying is the free movement every scene
// has.

export type MoveMode = "walk" | "fly";

export interface MoveModeSwitch {
  /** Shows the switch (the scene can be walked) or hides it. */
  setAvailable(available: boolean): void;
  setMode(mode: MoveMode): void;
  mode(): MoveMode;
}

export function setupMoveModeSwitch(onChange: (mode: MoveMode) => void): MoveModeSwitch {
  const el = document.getElementById("move-mode") as HTMLElement;
  const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>("button[data-mode]"));
  let mode: MoveMode = "fly";

  function show(): void {
    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    }
  }

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const next = button.dataset.mode as MoveMode;
      if (next === mode) return;
      mode = next;
      show();
      onChange(mode);
    });
  }

  return {
    setAvailable(available) {
      el.hidden = !available;
    },
    setMode(next) {
      mode = next;
      show();
    },
    mode: () => mode,
  };
}
