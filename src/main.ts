import * as THREE from "three";
import { setupScene } from "./scene";
import { setupSplatLoader } from "./splat-loader";
import { setupSparkControls, setupJoystick } from "./controls";
import { setupLockOnCamera } from "./lockon-camera";
import { setupHud } from "./hud";
import { setupCameraSettings } from "./camera-settings";
import { setupRenderSettings } from "./render-settings";
import { setupAnnotationStore } from "./annotation-store";
import { setupAnnotationMode } from "./annotation-mode";
import { setupAnnotationMarkers } from "./annotation-markers";

const BASE_JOYSTICK_SPEED = 2.0;
const CLICK_DRAG_THRESHOLD_PX = 6;
const FALLBACK_PLACEMENT_DISTANCE = 3;
const NUDGE_STEP = 0.02;
const NUDGE_KEYS: Record<string, THREE.Vector3> = {
  w: new THREE.Vector3(0, 0, -1),
  s: new THREE.Vector3(0, 0, 1),
  a: new THREE.Vector3(-1, 0, 0),
  d: new THREE.Vector3(1, 0, 0),
  e: new THREE.Vector3(0, 1, 0),
  q: new THREE.Vector3(0, -1, 0),
};

function isFormElement(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

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
  const annotationStore = setupAnnotationStore();
  const annotationMarkers = setupAnnotationMarkers(scene, annotationStore);

  const SELECTED_COLOR = new THREE.Color("#ffd23c");
  const DEFAULT_COLOR = new THREE.Color("#ffffff");
  let selectedAnnotationId: string | null = null;

  function setSelectedAnnotation(id: string | null): void {
    if (selectedAnnotationId) {
      const prev = annotationMarkers.getSprite(selectedAnnotationId);
      (prev?.material as THREE.SpriteMaterial | undefined)?.color.copy(
        DEFAULT_COLOR,
      );
    }
    selectedAnnotationId = id;
    if (id) {
      const next = annotationMarkers.getSprite(id);
      (next?.material as THREE.SpriteMaterial | undefined)?.color.copy(
        SELECTED_COLOR,
      );
    }
    controls.fpsMovement.enable = id === null;
  }

  const annotationMode = setupAnnotationMode(() => {
    setSelectedAnnotation(null);
  });

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

  const raycaster = new THREE.Raycaster();

  function computeNdc(event: PointerEvent): THREE.Vector2 {
    const rect = canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  function computeWorldPoint(ndc: THREE.Vector2): THREE.Vector3 {
    raycaster.setFromCamera(ndc, camera);
    const hit = splatLoader.currentMesh
      ? raycaster.intersectObject(splatLoader.currentMesh, false)
      : [];
    if (hit.length > 0) {
      return hit[0].point;
    }
    return camera.position
      .clone()
      .add(
        raycaster.ray.direction
          .clone()
          .multiplyScalar(FALLBACK_PLACEMENT_DISTANCE),
      );
  }

  function raycastAnnotationId(ndc: THREE.Vector2): string | undefined {
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(
      annotationMarkers.group.children,
      false,
    );
    return hit.length > 0
      ? annotationMarkers.getAnnotationId(hit[0].object)
      : undefined;
  }

  function placeAnnotationAt(ndc: THREE.Vector2): void {
    const point = computeWorldPoint(ndc);
    const count = annotationStore.getAll().length;
    annotationStore.add({
      position: { x: point.x, y: point.y, z: point.z },
      title: `Annotation ${count + 1}`,
      description: "",
    });
  }

  function pickAnnotationAt(ndc: THREE.Vector2): void {
    const id = raycastAnnotationId(ndc);
    const annotation = id ? annotationStore.get(id) : undefined;
    if (annotation) {
      console.log("[annotation]", annotation.title, annotation.description);
    }
  }

  function handleEditModeClick(ndc: THREE.Vector2): void {
    const hitId = raycastAnnotationId(ndc);
    if (hitId) {
      setSelectedAnnotation(hitId === selectedAnnotationId ? null : hitId);
      return;
    }
    if (selectedAnnotationId) {
      const point = computeWorldPoint(ndc);
      annotationStore.update(selectedAnnotationId, {
        position: { x: point.x, y: point.y, z: point.z },
      });
      setSelectedAnnotation(null);
      return;
    }
    placeAnnotationAt(ndc);
  }

  let pointerDownPos: { x: number; y: number } | null = null;

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button === 0) {
      pointerDownPos = { x: event.clientX, y: event.clientY };
    }
  });

  canvas.addEventListener("pointerup", (event) => {
    if (event.button !== 0 || !pointerDownPos) {
      return;
    }
    const dx = event.clientX - pointerDownPos.x;
    const dy = event.clientY - pointerDownPos.y;
    pointerDownPos = null;
    if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD_PX) {
      return;
    }

    const ndc = computeNdc(event);
    if (annotationMode.isEditMode()) {
      handleEditModeClick(ndc);
    } else {
      pickAnnotationAt(ndc);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (isFormElement(event.target)) {
      return;
    }
    if (event.key === "Escape" && selectedAnnotationId) {
      setSelectedAnnotation(null);
      return;
    }
    if (!selectedAnnotationId) {
      return;
    }
    const nudgeDir = NUDGE_KEYS[event.key.toLowerCase()];
    if (!nudgeDir) {
      return;
    }
    event.preventDefault();
    const annotation = annotationStore.get(selectedAnnotationId);
    if (!annotation) {
      return;
    }
    const offset = nudgeDir
      .clone()
      .applyQuaternion(camera.quaternion)
      .multiplyScalar(NUDGE_STEP);
    annotationStore.update(selectedAnnotationId, {
      position: {
        x: annotation.position.x + offset.x,
        y: annotation.position.y + offset.y,
        z: annotation.position.z + offset.z,
      },
    });
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
    setSelectedAnnotation(null);
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
