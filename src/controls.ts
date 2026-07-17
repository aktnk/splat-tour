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

export function setupJoystick(zone: HTMLElement): Joystick {
  const manager = nipplejs.create({
    zone,
    mode: "static",
    position: { left: "50%", top: "50%" },
    color: "white",
  });

  let moveVector = { x: 0, y: 0 };

  manager.on("move", (_evt, data) => {
    moveVector = { x: data.vector.x, y: data.vector.y };
  });
  manager.on("end", () => {
    moveVector = { x: 0, y: 0 };
  });

  return {
    getMoveVector() {
      return moveVector;
    },
  };
}
