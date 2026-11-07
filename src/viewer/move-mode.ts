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
      // Space jumps; it must not press this button again.
      button.blur();
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

export type EyeLevel = "adult" | "child";

/** "大人 / 子ども" switch, shown while walking: the eye height (walk.childEyeHeight for a child). */
export interface EyeLevelSwitch {
  setAvailable(available: boolean): void;
  level(): EyeLevel;
}

export function setupEyeLevelSwitch(onChange: (level: EyeLevel) => void): EyeLevelSwitch {
  const el = document.getElementById("eye-level") as HTMLElement;
  const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>("button[data-level]"));
  // Kept across scenes: a visitor stays a child or an adult.
  let level: EyeLevel = "adult";
  for (const button of buttons) {
    button.addEventListener("click", () => {
      button.blur();
      const next = button.dataset.level as EyeLevel;
      if (next === level) return;
      level = next;
      for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.level === level));
      onChange(level);
    });
  }
  return {
    setAvailable(available) {
      el.hidden = !available;
    },
    level: () => level,
  };
}
