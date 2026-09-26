import type * as THREE from "three";
import { isMobile } from "@sparkjsdev/spark";

// Render loop that keeps phones cool: frames are capped at maxFps, and nothing
// is drawn once the view has been still for settleMs (Spark still needs a few
// frames after the last change to finish sorting and refining the LoD).

export interface FrameLoopOptions {
  maxFps: number;
  maxPixelRatio: number;
  settleMs: number;
}

export function defaultFrameLoopOptions(): FrameLoopOptions {
  return isMobile()
    ? { maxFps: 30, maxPixelRatio: 1.5, settleMs: 1000 }
    : { maxFps: 60, maxPixelRatio: 2, settleMs: 1000 };
}

export interface FrameLoop {
  /** Keeps rendering for another settleMs, e.g. after a UI change. */
  invalidate(): void;
  /** Frames rendered in the last second (0 while idle). */
  getFps(): number;
}

export function setupFrameLoop(
  renderer: THREE.WebGLRenderer,
  options: FrameLoopOptions,
  /** Advances input and state; returns true when something visible changed. */
  tick: () => boolean,
  render: () => void,
): FrameLoop {
  const minFrameMs = 1000 / options.maxFps;
  let lastTickTime = -Infinity;
  let renderUntil = 0;
  const renderTimes: number[] = [];

  function applyPixelRatio(): void {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, options.maxPixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function invalidate(): void {
    renderUntil = Math.max(renderUntil, performance.now() + options.settleMs);
  }

  // A small tolerance keeps a 60Hz display from dropping to 20fps at a 30fps cap.
  renderer.setAnimationLoop((time: number) => {
    if (time - lastTickTime < minFrameMs - 2) {
      return;
    }
    lastTickTime = time;
    if (tick()) {
      invalidate();
    }
    if (time <= renderUntil) {
      render();
      renderTimes.push(time);
    }
    while (renderTimes.length > 0 && time - renderTimes[0] > 1000) {
      renderTimes.shift();
    }
  });

  applyPixelRatio();
  window.addEventListener("resize", () => {
    applyPixelRatio();
    invalidate();
  });
  invalidate();

  return {
    invalidate,
    getFps() {
      return renderTimes.length;
    },
  };
}
