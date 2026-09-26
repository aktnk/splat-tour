// Authoring aid shown with ?debug=1 until the editor can export manifests:
// shows the current view and the scene-local point under a click as JSON
// ready to paste into the manifest, and levels a tilted scene from three
// clicks on the floor.

export interface DebugSnapshot {
  sceneId: string;
  view: unknown;
  fps: number;
  activeSplats: number;
  pixelRatio: number;
  sleeping: boolean;
}

export interface DebugPanel {
  enabled: boolean;
  update(snapshot: DebugSnapshot): void;
  showPoint(position: [number, number, number] | null): void;
  /** Progress of the floor alignment (points clicked so far). */
  showAlignProgress(count: number): void;
  showAlignResult(transformJson: string | null): void;
}

export function setupDebugPanel(enabled: boolean, handlers: { onAlignStart(): void }): DebugPanel {
  const panel = document.getElementById("debug-panel") as HTMLElement;
  const statsEl = document.getElementById("debug-stats") as HTMLElement;
  const viewEl = document.getElementById("debug-view") as HTMLTextAreaElement;
  const pointEl = document.getElementById("debug-point") as HTMLTextAreaElement;
  const alignBtn = document.getElementById("debug-align-btn") as HTMLButtonElement;
  const alignStatusEl = document.getElementById("debug-align-status") as HTMLElement;
  const transformEl = document.getElementById("debug-transform") as HTMLTextAreaElement;
  panel.hidden = !enabled;

  // Selecting on focus makes copying work on phones, where the clipboard API
  // is unavailable over plain http.
  for (const el of [viewEl, pointEl, transformEl]) {
    el.addEventListener("focus", () => el.select());
  }
  alignBtn.addEventListener("click", () => handlers.onAlignStart());

  return {
    enabled,
    update(s: DebugSnapshot) {
      if (!enabled) {
        return;
      }
      const state = s.sleeping ? "待機中（描画停止）" : `${s.fps} fps`;
      statsEl.textContent = `${s.sceneId} | ${state} | ${s.activeSplats.toLocaleString()} splats | pixelRatio ${s.pixelRatio}`;
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
    showAlignProgress(count: number) {
      alignStatusEl.textContent = `床をクリックしてください（${count} / 3）`;
    },
    showAlignResult(transformJson: string | null) {
      if (transformJson === null) {
        alignStatusEl.textContent = "3点が一直線に近いため計算できません。離れた3点でやり直してください";
        return;
      }
      alignStatusEl.textContent = "水平にしました。下の transform を manifest に貼ってください";
      transformEl.value = transformJson;
      transformEl.hidden = false;
    },
  };
}
