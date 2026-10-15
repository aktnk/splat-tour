// Captures what the canvas shows as a small image, e.g. the arrival view of
// an entrance for its hover popup (`preview` in the manifest). The WebGL
// canvas keeps no drawing buffer between frames, so `draw` renders a frame
// and the image is copied in the same task, before the browser clears it.

export const PREVIEW_WIDTH = 480;
export const PREVIEW_HEIGHT = 270;

/**
 * Renders with `draw`, then returns the frame cropped to the centre at the
 * output's aspect ratio and scaled to width x height. WebP where the browser
 * can encode it (not Safari), PNG otherwise; check the blob's type.
 */
export function captureFrame(
  canvas: HTMLCanvasElement,
  draw: () => void,
  width = PREVIEW_WIDTH,
  height = PREVIEW_HEIGHT,
): Promise<Blob> {
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d") as CanvasRenderingContext2D;
  const scale = Math.min(canvas.width / width, canvas.height / height);
  const sw = width * scale;
  const sh = height * scale;
  draw();
  ctx.drawImage(canvas, (canvas.width - sw) / 2, (canvas.height - sh) / 2, sw, sh, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("画像を作れませんでした"))), "image/webp", 0.82);
  });
}

/** File extension for a blob made by captureFrame. */
export function captureExtension(blob: Blob): string {
  return blob.type === "image/webp" ? "webp" : "png";
}
