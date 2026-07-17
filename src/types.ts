export interface CameraSettingsState {
  speedMultiplier: number;
  mouseSensitivity: number;
}

export interface RenderSettingsState {
  exposure: number;
  focalDistanceScale: number;
}

export interface AnnotationPosition {
  x: number;
  y: number;
  z: number;
}

export interface Annotation {
  id: string;
  position: AnnotationPosition;
  title: string;
  description: string;
  imagePath?: string;
}
