// Public entry points for projects that build on the viewer (e.g. an editor
// that previews tours with the same code). Import the manifest types and
// validation from "splat-tour/manifest".
//
// startTour() expects the DOM of viewer/index.html (elements looked up by id;
// import "splat-tour/viewer.html?raw" and "splat-tour/viewer.css" to reuse it);
// the setupX parts can be composed without it.

export { startTour, type TourOptions } from "./tour";
export { setupScene, type SceneContext } from "./scene";
export { setupJoystick, setupSparkControls, type AppControls, type Joystick } from "./controls";
export { defaultFrameLoopOptions, setupFrameLoop, type FrameLoop, type FrameLoopOptions } from "./frame-loop";
export { setupSplatView, type SplatView } from "./splat-view";
export { setupEntranceMarkers, type EntranceMarkers } from "./entrance-markers";
export { setupMeshScreen, type MeshScreen } from "./mesh-screen";
export { assertAssetAvailable } from "./asset-check";
export { levelingRotation } from "./floor-align";
