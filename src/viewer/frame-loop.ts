import type * as THREE from "three";
import { isMobile } from "@sparkjsdev/spark";

// Render loop that keeps phones cool. Frames are capped at maxFps. Once the
// view has been still for settleMs (Spark needs a few frames after the last
// change to finish sorting and refining the LoD), nothing is drawn and the
// animation loop itself is stopped until the next input or invalidate().
// Input events keep the loop ticking (without drawing) for settleMs, so a key
// press or drag gets the chance to move the camera.

export interface FrameLoopOptions {
  maxFps: number;
  maxPixelRatio: number;
  settleMs: number;
}

export function defaultFrameLoopOptions(): FrameLoopOptions {
  return isMobile()
    ? { maxFps: 30, maxPixelRatio: 1.5, settleMs: 1500 }
    : { maxFps: 60, maxPixelRatio: 2, settleMs: 1500 };
}

export interface FrameLoop {
  /** Keeps rendering for another settleMs, e.g. after a UI change. */
  invalidate(): void;
  /** Frames rendered in the last second (0 while idle). */
  getFps(): number;
  isSleeping(): boolean;
}

// Anything that can start camera movement wakes the loop.
const WAKE_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "touchmove"];

export interface FrameLoopCallbacks {
  /** Advances input and state; returns true when something visible changed. */
  tick(): boolean;
  render(): void;
  onSleep?(): void;
  /** Before the first tick after sleeping, e.g. to reset time deltas. */
  onWake?(): void;
}

export function setupFrameLoop(
  renderer: THREE.WebGLRenderer,
  options: FrameLoopOptions,
  { tick, render, onSleep, onWake }: FrameLoopCallbacks,
): FrameLoop {
  const minFrameMs = 1000 / options.maxFps;
  let lastTickTime = -Infinity;
  // Rendering continues until renderUntil; ticking (input polling without
  // drawing) until awakeUntil, so an input event can start camera movement.
  let renderUntil = 0;
  let awakeUntil = 0;
  let sleeping = true;
  const renderTimes: number[] = [];

  function applyPixelRatio(): void {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, options.maxPixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // Scheduled with requestAnimationFrame directly rather than
  // renderer.setAnimationLoop, whose rAF chain keeps running (empty) when the
  // loop is cleared from inside its own callback.
  function frame(time: number): void {
    // A small tolerance keeps a 60Hz display from dropping to 20fps at a 30fps cap.
    if (time - lastTickTime < minFrameMs - 2) {
      requestAnimationFrame(frame);
      return;
    }
    lastTickTime = time;
    if (tick()) {
      renderUntil = Math.max(renderUntil, time + options.settleMs);
    }
    while (renderTimes.length > 0 && time - renderTimes[0] > 1000) {
      renderTimes.shift();
    }
    if (time <= renderUntil) {
      render();
      renderTimes.push(time);
    }
    if (time <= renderUntil || time <= awakeUntil) {
      requestAnimationFrame(frame);
      return;
    }
    sleeping = true;
    renderTimes.length = 0;
    onSleep?.();
  }

  function wake(): void {
    awakeUntil = Math.max(awakeUntil, performance.now() + options.settleMs);
    if (sleeping) {
      sleeping = false;
      onWake?.();
      requestAnimationFrame(frame);
    }
  }

  function invalidate(): void {
    renderUntil = Math.max(renderUntil, performance.now() + options.settleMs);
    wake();
  }

  applyPixelRatio();
  window.addEventListener("resize", () => {
    applyPixelRatio();
    invalidate();
  });
  for (const type of WAKE_EVENTS) {
    document.addEventListener(type, wake, { passive: true, capture: true });
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) invalidate();
  });
  invalidate();

  return {
    invalidate,
    getFps() {
      return renderTimes.length;
    },
    isSleeping() {
      return sleeping;
    },
  };
}
