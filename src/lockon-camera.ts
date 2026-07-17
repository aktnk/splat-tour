import * as THREE from "three";
import type { AppControls } from "./controls";

const LOCKON_TARGET = new THREE.Vector3(0, 0, 0);
const SPEED_FACTOR = 1.0;
const MIN_SPEED = 0.05;
const MAX_SPEED = 3.0;
const MIN_DISTANCE = 0.3;
const TOGGLE_KEYS = new Set([" ", "l", "f"]);

export interface LockOnCamera {
  isActive(): boolean;
  getSpeedScale(): number;
  update(camera: THREE.Camera): void;
  deactivate(): void;
}

function isFormElement(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function setupLockOnCamera(controls: AppControls): LockOnCamera {
  let active = false;
  let speedScale = 1.0;

  function activate(): void {
    active = true;
    controls.pointerControls.enable = false;
  }

  function deactivate(): void {
    active = false;
    controls.pointerControls.enable = true;
  }

  document.addEventListener("keydown", (event) => {
    if (isFormElement(event.target)) {
      return;
    }
    if (!TOGGLE_KEYS.has(event.key.toLowerCase())) {
      return;
    }
    event.preventDefault();
    if (active) {
      deactivate();
    } else {
      activate();
    }
  });

  return {
    isActive() {
      return active;
    },
    getSpeedScale() {
      return speedScale;
    },
    update(camera: THREE.Camera): void {
      if (!active) {
        return;
      }
      const direction = camera.position.clone().sub(LOCKON_TARGET);
      const distance = direction.length();

      speedScale = THREE.MathUtils.clamp(
        distance * SPEED_FACTOR,
        MIN_SPEED,
        MAX_SPEED,
      );

      if (distance < MIN_DISTANCE && distance > 0) {
        camera.position.copy(
          LOCKON_TARGET.clone().add(
            direction.normalize().multiplyScalar(MIN_DISTANCE),
          ),
        );
      }

      camera.lookAt(LOCKON_TARGET);
    },
    deactivate,
  };
}
