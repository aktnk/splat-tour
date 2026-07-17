import { setupScene } from "./scene";
import { setupSplatLoader } from "./splat-loader";
import { setupSparkControls, setupJoystick } from "./controls";
import { setupLockOnCamera } from "./lockon-camera";
import { setupHud } from "./hud";
import { setupCameraSettings } from "./camera-settings";
import { setupRenderSettings } from "./render-settings";

const BASE_JOYSTICK_SPEED = 2.0;

function init(): void {
  const canvas = document.getElementById(
    "viewer-canvas",
  ) as HTMLCanvasElement;
  const joystickZone = document.getElementById(
    "joystick-zone",
  ) as HTMLElement;
  const openFileBtn = document.getElementById(
    "open-file-btn",
  ) as HTMLButtonElement;
  const resetViewBtn = document.getElementById(
    "reset-view-btn",
  ) as HTMLButtonElement;
  const flipControls = document.getElementById(
    "flip-controls",
  ) as HTMLElement;

  const { scene, camera, renderer, sparkRenderer } = setupScene(canvas);
  const splatLoader = setupSplatLoader(scene);
  const controls = setupSparkControls(canvas);
  const joystick = setupJoystick(joystickZone);
  const lockOnCamera = setupLockOnCamera(controls);
  setupHud();
  setupCameraSettings(camera, controls.fpsMovement, controls.pointerControls);
  const renderSettings = setupRenderSettings(sparkRenderer, splatLoader);

  const initialPosition = camera.position.clone();
  const initialQuaternion = camera.quaternion.clone();

  function resetFlipControls(): void {
    flipControls
      .querySelectorAll<HTMLButtonElement>("button[data-axis]")
      .forEach((btn) => {
        btn.classList.remove("active");
      });
  }

  openFileBtn.addEventListener("click", () => {
    void splatLoader.openFileDialog().then(() => {
      renderSettings.applyToCurrentMesh();
      resetFlipControls();
    });
  });

  flipControls.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-axis]",
    );
    if (!button) {
      return;
    }
    const axis = button.dataset.axis as "x" | "y" | "z";
    splatLoader.flipModel(axis);
    button.classList.toggle("active");
  });

  resetViewBtn.addEventListener("click", () => {
    camera.position.copy(initialPosition);
    camera.quaternion.copy(initialQuaternion);
    controls.fpsMovement.keydown = {};
    controls.fpsMovement.extraMove.set(0, 0, 0);
    lockOnCamera.deactivate();
    if (splatLoader.currentMesh) {
      splatLoader.currentMesh.rotation.set(0, 0, 0);
    }
    resetFlipControls();
  });

  function animate(): void {
    requestAnimationFrame(animate);

    const moveVector = joystick.getMoveVector();
    const joystickSpeed =
      BASE_JOYSTICK_SPEED *
      (lockOnCamera.isActive() ? lockOnCamera.getSpeedScale() : 1);
    controls.fpsMovement.extraMove.set(
      moveVector.x * joystickSpeed,
      0,
      -moveVector.y * joystickSpeed,
    );

    controls.update(camera);
    lockOnCamera.update(camera);

    renderer.render(scene, camera);
  }

  animate();
}

init();
