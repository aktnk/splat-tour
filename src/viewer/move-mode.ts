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

/**
 * "◯ クリックで移動" (on touch "タップで移動") toggle: whether a click or tap
 * on the floor goes there and the ring shows where. Remembered in this
 * browser (a convenience: it works without storage too).
 */
export interface ClickMoveSwitch {
  enabled(): boolean;
}

const CLICK_MOVE_KEY = "splat-tour:clickMove";

export function setupClickMoveSwitch(onChange: (enabled: boolean) => void): ClickMoveSwitch {
  const button = document.getElementById("click-move") as HTMLButtonElement | null;
  let enabled = true;
  try {
    enabled = localStorage.getItem(CLICK_MOVE_KEY) !== "off";
  } catch {
    // No storage (private window, blocked): on, as by default.
  }
  if (!button) return { enabled: () => enabled };
  const touch = window.matchMedia("(hover: none), (pointer: coarse)").matches;
  const label = touch ? "タップで移動" : "クリックで移動";
  function show(): void {
    button!.setAttribute("aria-pressed", String(enabled));
    button!.textContent = `◯ ${label}：${enabled ? "入" : "切"}`;
    button!.title = enabled
      ? `床を${touch ? "タップ" : "クリック"}すると、そこへ移動します（押すと切）`
      : `床の${touch ? "タップ" : "クリック"}では移動しません（押すと入）`;
  }
  show();
  button.addEventListener("click", () => {
    // Space jumps; it must not press this button again.
    button.blur();
    enabled = !enabled;
    try {
      localStorage.setItem(CLICK_MOVE_KEY, enabled ? "on" : "off");
    } catch {
      // Only a convenience.
    }
    show();
    onChange(enabled);
  });
  return { enabled: () => enabled };
}
