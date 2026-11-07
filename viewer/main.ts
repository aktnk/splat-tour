import { startTour } from "../src/viewer/tour";

// Web viewer entry. The tour is read from ./manifest.json next to the page
// unless ?manifest=<url> is given; ?debug=1 shows the authoring panel,
// ?scene=<id> opens another scene first (to look up its coordinates) and
// ?icon=<style> picks the look of the entrance icons (being compared).

const params = new URLSearchParams(window.location.search);

void startTour({
  canvas: document.getElementById("viewer-canvas") as HTMLCanvasElement,
  manifestUrl: params.get("manifest") ?? "./manifest.json",
  debug: params.get("debug") === "1",
  startSceneId: params.get("scene") ?? undefined,
  iconStyle: params.get("icon") ?? undefined,
});
