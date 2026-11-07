import * as THREE from "three";
import { FpsMovement, PointerControls, SparkControls } from "@sparkjsdev/spark";

export interface AppControls {
  sparkControls: SparkControls;
  fpsMovement: FpsMovement;
  pointerControls: PointerControls;
  update(camera: THREE.Camera): boolean;
}

export function setupSparkControls(canvas: HTMLCanvasElement): AppControls {
  const sparkControls = new SparkControls({ canvas });
  return {
    sparkControls,
    fpsMovement: sparkControls.fpsMovement,
    pointerControls: sparkControls.pointerControls,
    update(camera: THREE.Camera): boolean {
      return sparkControls.update(camera);
    },
  };
}

export interface Joystick {
  /** Tilt of the stick, -1..1 on each axis (y up). */
  getMoveVector(): { x: number; y: number };
}

/** Knob travel as a share of the zone's half width. */
const STICK_REACH = 0.42;

// A touch joystick in `zone`: a ring and a knob that follows the finger that
// pressed the zone, and only that finger (pointer capture), so two sticks
// work side by side. Lifting the finger, the browser cancelling the touch
// (a system gesture, a notification), losing the capture or the page
// losing focus all let the stick go: it must never stay tilted.
export function setupJoystick(zone: HTMLElement): Joystick {
  const base = document.createElement("div");
  base.className = "stick-base";
  const knob = document.createElement("div");
  knob.className = "stick-knob";
  base.append(knob);
  zone.append(base);
  zone.style.touchAction = "none";

  let vector = { x: 0, y: 0 };
  let pointerId: number | null = null;

  function release(): void {
    if (pointerId !== null && zone.hasPointerCapture?.(pointerId)) zone.releasePointerCapture(pointerId);
    pointerId = null;
    vector = { x: 0, y: 0 };
    knob.style.transform = "";
    base.classList.remove("active");
  }

  function follow(event: PointerEvent): void {
    // Measured on each move, so a rotation or resize needs nothing.
    const rect = zone.getBoundingClientRect();
    const reach = (rect.width / 2) * STICK_REACH * 2;
    let dx = event.clientX - (rect.left + rect.width / 2);
    let dy = event.clientY - (rect.top + rect.height / 2);
    const length = Math.hypot(dx, dy);
    if (length > reach) {
      dx *= reach / length;
      dy *= reach / length;
    }
    vector = { x: dx / reach, y: -dy / reach };
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  zone.addEventListener("pointerdown", (event) => {
    if (pointerId !== null) return;
    event.preventDefault();
    pointerId = event.pointerId;
    zone.setPointerCapture(event.pointerId);
    base.classList.add("active");
    follow(event);
  });
  zone.addEventListener("pointermove", (event) => {
    if (event.pointerId === pointerId) follow(event);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
    zone.addEventListener(type, (event) => {
      if (event.pointerId === pointerId) release();
    });
  }
  window.addEventListener("blur", release);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) release();
  });

  return {
    getMoveVector() {
      return vector;
    },
  };
}
