import type { SparkRenderer } from "@sparkjsdev/spark";
import type { SplatLoader } from "./splat-loader";

export interface RenderSettings {
  applyToCurrentMesh(): void;
}

export function setupRenderSettings(
  sparkRenderer: SparkRenderer,
  splatLoader: SplatLoader,
): RenderSettings {
  const panel = document.getElementById(
    "render-settings-panel",
  ) as HTMLElement;
  const toggleBtn = document.getElementById(
    "render-settings-toggle-btn",
  ) as HTMLButtonElement;
  const exposureRange = document.getElementById(
    "exposure-range",
  ) as HTMLInputElement;
  const focalDistanceRange = document.getElementById(
    "focal-distance-range",
  ) as HTMLInputElement;

  let exposure = Number(exposureRange.value);

  function applyToCurrentMesh(): void {
    splatLoader.currentMesh?.recolor.setScalar(exposure);
  }

  toggleBtn.addEventListener("click", () => {
    const visible = panel.classList.toggle("hidden");
    toggleBtn.classList.toggle("active", !visible);
  });

  exposureRange.addEventListener("input", () => {
    exposure = Number(exposureRange.value);
    applyToCurrentMesh();
  });

  focalDistanceRange.addEventListener("input", () => {
    sparkRenderer.focalAdjustment = Number(focalDistanceRange.value);
  });

  return { applyToCurrentMesh };
}
