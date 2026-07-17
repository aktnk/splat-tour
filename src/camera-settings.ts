import type * as THREE from "three";
import type { FpsMovement, PointerControls } from "@sparkjsdev/spark";

export interface CameraSettings {
  getSpeedMultiplier(): number;
}

export function setupCameraSettings(
  camera: THREE.PerspectiveCamera,
  fpsMovement: FpsMovement,
  pointerControls: PointerControls,
): CameraSettings {
  const panel = document.getElementById(
    "camera-settings-panel",
  ) as HTMLElement;
  const toggleBtn = document.getElementById(
    "camera-settings-toggle-btn",
  ) as HTMLButtonElement;
  const moveSpeedRange = document.getElementById(
    "move-speed-range",
  ) as HTMLInputElement;
  const mouseSensitivityRange = document.getElementById(
    "mouse-sensitivity-range",
  ) as HTMLInputElement;
  const fovInput = document.getElementById("cam-fov") as HTMLInputElement;

  const baseMoveSpeed = fpsMovement.moveSpeed;
  const baseRotateSpeed = pointerControls.rotateSpeed;
  let speedMultiplier = 1.0;

  fovInput.value = String(camera.fov);

  toggleBtn.addEventListener("click", () => {
    const visible = panel.classList.toggle("hidden");
    toggleBtn.classList.toggle("active", !visible);
  });

  moveSpeedRange.addEventListener("input", () => {
    speedMultiplier = Number(moveSpeedRange.value);
    fpsMovement.moveSpeed = baseMoveSpeed * speedMultiplier;
  });

  mouseSensitivityRange.addEventListener("input", () => {
    pointerControls.rotateSpeed = baseRotateSpeed * Number(mouseSensitivityRange.value);
  });

  fovInput.addEventListener("input", () => {
    const fov = Number(fovInput.value);
    if (fov > 0 && fov < 180) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  });

  return {
    getSpeedMultiplier() {
      return speedMultiplier;
    },
  };
}
