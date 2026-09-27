import * as THREE from "three";
import { FpsMovement, PointerControls, SparkControls } from "@sparkjsdev/spark";
import nipplejs from "nipplejs";

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
  getMoveVector(): { x: number; y: number };
}

// nipplejs measures the zone's screen position when it is created, so after
// a rotation or resize the stick's centre would stay where it used to be and
// every touch would read as "down" (backwards). Rebuild it on those events.
export function setupJoystick(zone: HTMLElement): Joystick {
  let moveVector = { x: 0, y: 0 };
  let manager: ReturnType<typeof nipplejs.create> | null = null;

  function create(): void {
    manager?.destroy();
    moveVector = { x: 0, y: 0 };
    manager = nipplejs.create({
      zone,
      mode: "static",
      position: { left: "50%", top: "50%" },
      color: "white",
    });
    manager.on("move", (_evt, data) => {
      moveVector = { x: data.vector.x, y: data.vector.y };
    });
    manager.on("end", () => {
      moveVector = { x: 0, y: 0 };
    });
  }

  let pending = 0;
  function recreateSoon(): void {
    // Wait for the layout to settle after the rotation.
    window.clearTimeout(pending);
    pending = window.setTimeout(create, 200);
  }

  create();
  window.addEventListener("resize", recreateSoon);
  window.addEventListener("orientationchange", recreateSoon);

  return {
    getMoveVector() {
      return moveVector;
    },
  };
}
