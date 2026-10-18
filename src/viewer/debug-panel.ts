// Authoring aid shown with ?debug=1 until the editor can export manifests:
// shows the current view and the scene-local point under a click as JSON
// ready to paste into the manifest, levels a tilted scene from three clicks
// on the floor, saves the current view as an image for an entrance's
// thumbnail, overlays a collision mesh (collision-overlay.ts), and walks on
// voxel data (walk.ts) to try the walking mode on a real scan.

import type { AxisCorrection, CollisionOverlayInfo } from "./collision-overlay";

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
  /** Status line of "歩いてみる" (e.g. the ground under the camera). */
  showWalkInfo(text: string): void;
}

export interface WalkPanelSettings {
  walking: boolean;
  showVoxels: boolean;
  eyeHeight: number;
  radius: number;
  stepHeight: number;
}

export function setupDebugPanel(
  enabled: boolean,
  handlers: {
    onAlignStart(): void;
    onCapture(): void;
    onCollisionFile(file: File): Promise<CollisionOverlayInfo>;
    onCollisionOptions(options: { axis: AxisCorrection; wireframe: boolean; visible: boolean }): void;
    /** The .voxel.json and .voxel.bin picked together; resolves to a summary. */
    onVoxelFiles(json: File, bin: File): Promise<string>;
    onWalkSettings(settings: WalkPanelSettings): void;
  },
): DebugPanel {
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
  (document.getElementById("debug-capture-btn") as HTMLButtonElement).addEventListener("click", () =>
    handlers.onCapture(),
  );

  const collisionFile = document.getElementById("debug-collision-file") as HTMLInputElement;
  const collisionAxis = document.getElementById("debug-collision-axis") as HTMLSelectElement;
  const collisionWire = document.getElementById("debug-collision-wire") as HTMLInputElement;
  const collisionVisible = document.getElementById("debug-collision-visible") as HTMLInputElement;
  const collisionInfo = document.getElementById("debug-collision-info") as HTMLElement;
  const collisionOptions = () =>
    handlers.onCollisionOptions({
      axis: collisionAxis.value as AxisCorrection,
      wireframe: collisionWire.checked,
      visible: collisionVisible.checked,
    });
  for (const el of [collisionAxis, collisionWire, collisionVisible]) {
    el.addEventListener("change", collisionOptions);
  }
  collisionFile.addEventListener("change", async () => {
    const file = collisionFile.files?.[0];
    if (!file) return;
    collisionInfo.textContent = "読み込み中…";
    try {
      const info = await handlers.onCollisionFile(file);
      collisionOptions();
      const size = info.size.map((n) => n.toFixed(2)).join(" × ");
      collisionInfo.textContent = `${info.triangles.toLocaleString()} 三角形 | ${(info.bytes / 1e6).toFixed(1)} MB | 大きさ ${size}`;
    } catch (err) {
      collisionInfo.textContent = `読み込めませんでした: ${err instanceof Error ? err.message : String(err)}`;
    }
    // The same file can be chosen again after it was rewritten.
    collisionFile.value = "";
  });

  const walkFiles = document.getElementById("debug-walk-files") as HTMLInputElement;
  const walkOn = document.getElementById("debug-walk-on") as HTMLInputElement;
  const walkVoxels = document.getElementById("debug-walk-voxels") as HTMLInputElement;
  const walkEye = document.getElementById("debug-walk-eye") as HTMLInputElement;
  const walkRadius = document.getElementById("debug-walk-radius") as HTMLInputElement;
  const walkStep = document.getElementById("debug-walk-step") as HTMLInputElement;
  const walkInfo = document.getElementById("debug-walk-info") as HTMLElement;
  const number = (el: HTMLInputElement, fallback: number) => {
    const value = Number.parseFloat(el.value);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  const walkSettings = () =>
    handlers.onWalkSettings({
      walking: walkOn.checked,
      showVoxels: walkVoxels.checked,
      eyeHeight: number(walkEye, 1.6),
      radius: number(walkRadius, 0.25),
      stepHeight: number(walkStep, 0.35),
    });
  for (const el of [walkOn, walkVoxels, walkEye, walkRadius, walkStep]) {
    el.addEventListener("change", walkSettings);
  }
  walkFiles.addEventListener("change", async () => {
    const files = Array.from(walkFiles.files ?? []);
    const json = files.find((f) => f.name.endsWith(".voxel.json"));
    const bin = files.find((f) => f.name.endsWith(".voxel.bin"));
    walkFiles.value = "";
    if (!json || !bin) {
      walkInfo.textContent = ".voxel.json と .voxel.bin を一緒に選んでください（Ctrl を押しながら）";
      return;
    }
    walkInfo.textContent = "読み込み中…";
    try {
      walkInfo.textContent = await handlers.onVoxelFiles(json, bin);
      walkSettings();
    } catch (err) {
      walkInfo.textContent = `読み込めませんでした: ${err instanceof Error ? err.message : String(err)}`;
    }
  });

  return {
    enabled,
    showWalkInfo(text: string) {
      walkInfo.textContent = text;
    },
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
