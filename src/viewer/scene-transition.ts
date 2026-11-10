// Moving to another scene: instead of a black screen while the next splat
// starts streaming, the last frame of the scene being left stays on screen
// (copied to a 2D canvas over the WebGL one) and fades out once the next
// scene draws its first, coarse level of detail, which then sharpens as its
// chunks arrive.

export interface SceneTransition {
  /** Freezes what `draw` renders (the scene being left) on screen. */
  hold(draw: () => void): void;
  /** Fades the frozen frame out (no-op if none is shown). */
  reveal(): void;
}

const FADE_MS = 600;

export function setupSceneTransition(source: HTMLCanvasElement): SceneTransition {
  // In viewer/index.html; made here for pages built from an older copy of it.
  let overlay = document.getElementById("scene-transition") as HTMLCanvasElement | null;
  if (!overlay) {
    overlay = document.createElement("canvas");
    overlay.id = "scene-transition";
    overlay.hidden = true;
    source.after(overlay);
  }
  const ctx = overlay.getContext("2d") as CanvasRenderingContext2D;
  let hideTimer = 0;
  let shown = false;

  return {
    hold(draw) {
      window.clearTimeout(hideTimer);
      overlay.width = source.width;
      overlay.height = source.height;
      // The WebGL canvas keeps no drawing buffer: render and copy in the same task.
      draw();
      ctx.drawImage(source, 0, 0);
      overlay.classList.remove("fading");
      overlay.hidden = false;
      shown = true;
    },
    reveal() {
      if (!shown) return;
      shown = false;
      overlay.classList.add("fading");
      hideTimer = window.setTimeout(() => {
        overlay.hidden = true;
        overlay.classList.remove("fading");
      }, FADE_MS);
    },
  };
}
