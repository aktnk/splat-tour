// Authoring aid shown with ?debug=1 until the editor can export manifests:
// shows the current view and the scene-local point under a click, as JSON
// ready to paste into the manifest.

export interface DebugSnapshot {
  sceneId: string;
  view: unknown;
  fps: number;
  activeSplats: number;
  pixelRatio: number;
}

export interface DebugPanel {
  enabled: boolean;
  update(snapshot: DebugSnapshot): void;
  showPoint(position: [number, number, number] | null): void;
}

export function setupDebugPanel(enabled: boolean): DebugPanel {
  const panel = document.getElementById("debug-panel") as HTMLElement;
  const statsEl = document.getElementById("debug-stats") as HTMLElement;
  const viewEl = document.getElementById("debug-view") as HTMLTextAreaElement;
  const pointEl = document.getElementById("debug-point") as HTMLTextAreaElement;
  panel.hidden = !enabled;

  // Selecting on focus makes copying work on phones, where the clipboard API
  // is unavailable over plain http.
  for (const el of [viewEl, pointEl]) {
    el.addEventListener("focus", () => el.select());
  }

  return {
    enabled,
    update(s: DebugSnapshot) {
      if (!enabled) {
        return;
      }
      statsEl.textContent = `${s.sceneId} | ${s.fps} fps | ${s.activeSplats.toLocaleString()} splats | pixelRatio ${s.pixelRatio}`;
      const json = JSON.stringify(s.view);
      if (document.activeElement !== viewEl && viewEl.value !== json) {
        viewEl.value = json;
      }
    },
    showPoint(position: [number, number, number] | null) {
      if (!enabled) {
        return;
      }
      pointEl.value = position
        ? JSON.stringify(position)
        : "（スプラットに当たりませんでした）";
    },
  };
}
