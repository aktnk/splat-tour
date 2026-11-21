// The gear button at the bottom right and the switches it opens ("歩く /
// 飛ぶ", "大人 / 子供", "クリックで移動 ON / OFF"; move-mode.ts). The gear
// shows only while some switch is available (it is hidden in scenes that
// can only be flown), and the panel closes with it.

export interface SettingsPanel {
  close(): void;
}

export function setupSettingsPanel(onToggle: () => void): SettingsPanel {
  const button = document.getElementById("settings-btn") as HTMLButtonElement;
  const panel = document.getElementById("settings-panel") as HTMLElement;
  const rows = Array.from(panel.querySelectorAll<HTMLElement>(".settings-row"));
  let open = false;

  // Only what changed is written: the observer below would see its own writes.
  function show(): void {
    const any = rows.some((row) => !row.hidden);
    if (button.hidden !== !any) button.hidden = !any;
    if (panel.hidden !== (!open || !any)) panel.hidden = !open || !any;
    const expanded = String(open && any);
    if (button.getAttribute("aria-expanded") !== expanded) button.setAttribute("aria-expanded", expanded);
    button.classList.toggle("open", open && any);
  }

  button.addEventListener("click", () => {
    // Space jumps; it must not press this button again.
    button.blur();
    open = !open;
    show();
    onToggle();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && open) {
      open = false;
      show();
      onToggle();
    }
  });
  // The rows are shown and hidden by their switches as scenes and modes change.
  const observer = new MutationObserver(show);
  for (const row of rows) observer.observe(row, { attributes: true, attributeFilter: ["hidden"] });
  show();

  return {
    close() {
      open = false;
      show();
    },
  };
}
