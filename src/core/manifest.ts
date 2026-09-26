// Tour manifest: the published description of a tour (scenes, entrances and
// their targets). The web viewer reads it with fetch; the editor will export it.
// Plain data and validation only: no DOM, Three.js or Tauri here.
//
// Coordinates: positions (entrance, view) are in the scene's local frame, i.e.
// before the scene transform (flips, scale) is applied, so they stay valid when
// the transform is corrected. The transform rotates by `rotation` (degrees,
// XYZ Euler) with 180 added on each flipped axis. yaw/pitch are in degrees in the world frame
// (yaw 0 looks along -Z, positive yaw turns left; positive pitch looks up).

export const MANIFEST_VERSION = 1;

export type Vec3 = [number, number, number];

export interface View {
  position: Vec3;
  yaw: number;
  pitch: number;
}

export interface SplatAsset {
  /** Path relative to assetBaseUrl (or an absolute URL). */
  url: string;
  /** Stream a .rad file with HTTP Range requests. */
  paged: boolean;
}

export interface SceneTransform {
  /** Rotation in degrees (XYZ Euler), e.g. to level a tilted capture. */
  rotation: Vec3;
  flipX: boolean;
  flipY: boolean;
  flipZ: boolean;
  scale: number;
}

export interface RenderSettings {
  exposure: number;
  focalAdjustment: number;
}

export interface CameraSettings {
  moveSpeed: number;
  fov: number;
}

export type EntranceTarget =
  | { type: "scene"; sceneId: string; arrival: View }
  | { type: "mesh"; url: string }
  | { type: "url"; url: string };

export interface Entrance {
  id: string;
  position: Vec3;
  /** "exit" only changes the icon; behaviour follows the target. */
  kind: "entrance" | "exit";
  title: string;
  description: string;
  /** Optional image shown on hover, relative to assetBaseUrl. */
  image?: string;
  target: EntranceTarget;
}

export interface Scene {
  id: string;
  title: string;
  splat: SplatAsset;
  transform: SceneTransform;
  render: RenderSettings;
  camera: CameraSettings;
  initialView: View;
  entrances: Entrance[];
}

export interface Manifest {
  version: number;
  title: string;
  /** Base for asset paths; relative values resolve against the manifest URL. */
  assetBaseUrl: string;
  startSceneId: string;
  scenes: Scene[];
}

export class ManifestError extends Error {}

type Json = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new ManifestError(`manifest ${path}: ${message}`);
}

function obj(value: unknown, path: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "オブジェクトである必要があります");
  }
  return value as Json;
}

function str(value: unknown, path: string): string {
  if (typeof value !== "string" || value === "") {
    fail(path, "空でない文字列である必要があります");
  }
  return value;
}

function optStr(value: unknown, path: string, fallback: string): string {
  return value === undefined ? fallback : typeof value === "string" ? value : fail(path, "文字列である必要があります");
}

function num(value: unknown, path: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "数値である必要があります");
  }
  return value;
}

function bool(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    fail(path, "true / false である必要があります");
  }
  return value;
}

function vec3(value: unknown, path: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) {
    fail(path, "[x, y, z] の配列である必要があります");
  }
  return [num(value[0], `${path}[0]`), num(value[1], `${path}[1]`), num(value[2], `${path}[2]`)];
}

function view(value: unknown, path: string): View {
  const v = obj(value, path);
  return {
    position: vec3(v.position, `${path}.position`),
    yaw: num(v.yaw, `${path}.yaw`, 0),
    pitch: num(v.pitch, `${path}.pitch`, 0),
  };
}

function target(value: unknown, path: string): EntranceTarget {
  const t = obj(value, path);
  switch (t.type) {
    case "scene":
      return {
        type: "scene",
        sceneId: str(t.sceneId, `${path}.sceneId`),
        arrival: view(t.arrival, `${path}.arrival`),
      };
    case "mesh":
      return { type: "mesh", url: str(t.url, `${path}.url`) };
    case "url":
      return { type: "url", url: str(t.url, `${path}.url`) };
    default:
      return fail(`${path}.type`, `"scene" / "mesh" / "url" のいずれかである必要があります`);
  }
}

function entrance(value: unknown, path: string): Entrance {
  const e = obj(value, path);
  const kind = e.kind ?? "entrance";
  if (kind !== "entrance" && kind !== "exit") {
    fail(`${path}.kind`, `"entrance" / "exit" のいずれかである必要があります`);
  }
  return {
    id: str(e.id, `${path}.id`),
    position: vec3(e.position, `${path}.position`),
    kind,
    title: str(e.title, `${path}.title`),
    description: optStr(e.description, `${path}.description`, ""),
    image: e.image === undefined ? undefined : str(e.image, `${path}.image`),
    target: target(e.target, `${path}.target`),
  };
}

function scene(value: unknown, path: string): Scene {
  const s = obj(value, path);
  const splat = obj(s.splat, `${path}.splat`);
  const transform = s.transform === undefined ? {} : obj(s.transform, `${path}.transform`);
  const render = s.render === undefined ? {} : obj(s.render, `${path}.render`);
  const camera = s.camera === undefined ? {} : obj(s.camera, `${path}.camera`);
  const entrances = s.entrances ?? [];
  if (!Array.isArray(entrances)) {
    fail(`${path}.entrances`, "配列である必要があります");
  }
  const splatUrl = str(splat.url, `${path}.splat.url`);
  return {
    id: str(s.id, `${path}.id`),
    title: str(s.title, `${path}.title`),
    splat: {
      url: splatUrl,
      paged: bool(splat.paged, `${path}.splat.paged`, splatUrl.toLowerCase().endsWith(".rad")),
    },
    transform: {
      rotation: transform.rotation === undefined ? [0, 0, 0] : vec3(transform.rotation, `${path}.transform.rotation`),
      flipX: bool(transform.flipX, `${path}.transform.flipX`, false),
      flipY: bool(transform.flipY, `${path}.transform.flipY`, false),
      flipZ: bool(transform.flipZ, `${path}.transform.flipZ`, false),
      scale: num(transform.scale, `${path}.transform.scale`, 1),
    },
    render: {
      exposure: num(render.exposure, `${path}.render.exposure`, 1),
      focalAdjustment: num(render.focalAdjustment, `${path}.render.focalAdjustment`, 1),
    },
    camera: {
      moveSpeed: num(camera.moveSpeed, `${path}.camera.moveSpeed`, 1),
      fov: num(camera.fov, `${path}.camera.fov`, 60),
    },
    initialView:
      s.initialView === undefined
        ? { position: [0, 0, 0], yaw: 0, pitch: 0 }
        : view(s.initialView, `${path}.initialView`),
    entrances: entrances.map((e, i) => entrance(e, `${path}.entrances[${i}]`)),
  };
}

/** Validates raw JSON and fills defaults. Throws ManifestError with the offending path. */
export function parseManifest(value: unknown): Manifest {
  const m = obj(value, "(root)");
  const version = num(m.version, "version");
  if (version !== MANIFEST_VERSION) {
    fail("version", `${MANIFEST_VERSION} のみ対応しています（${version}）`);
  }
  if (!Array.isArray(m.scenes) || m.scenes.length === 0) {
    fail("scenes", "1つ以上のシーンが必要です");
  }
  const scenes = m.scenes.map((s, i) => scene(s, `scenes[${i}]`));
  const manifest: Manifest = {
    version,
    title: str(m.title, "title"),
    assetBaseUrl: optStr(m.assetBaseUrl, "assetBaseUrl", "./"),
    startSceneId: str(m.startSceneId, "startSceneId"),
    scenes,
  };

  const ids = new Set<string>();
  for (const s of scenes) {
    if (ids.has(s.id)) fail("scenes", `シーン id "${s.id}" が重複しています`);
    ids.add(s.id);
  }
  if (!ids.has(manifest.startSceneId)) {
    fail("startSceneId", `シーン "${manifest.startSceneId}" がありません`);
  }
  for (const s of scenes) {
    const entranceIds = new Set<string>();
    for (const e of s.entrances) {
      if (entranceIds.has(e.id)) fail(`scenes(${s.id}).entrances`, `入口 id "${e.id}" が重複しています`);
      entranceIds.add(e.id);
      if (e.target.type === "scene" && !ids.has(e.target.sceneId)) {
        fail(`scenes(${s.id}).entrances(${e.id}).target.sceneId`, `シーン "${e.target.sceneId}" がありません`);
      }
    }
  }
  return manifest;
}

export function findScene(manifest: Manifest, id: string): Scene {
  const found = manifest.scenes.find((s) => s.id === id);
  if (!found) {
    throw new ManifestError(`シーン "${id}" がありません`);
  }
  return found;
}

/**
 * Resolves an asset path: absolute URLs pass through, others resolve against
 * assetBaseUrl, which itself resolves against the (absolute) manifest URL.
 */
export function resolveAssetUrl(manifest: Manifest, manifestUrl: string, path: string): string {
  const base = new URL(manifest.assetBaseUrl, manifestUrl);
  if (!base.pathname.endsWith("/")) {
    base.pathname += "/";
  }
  return new URL(path, base).href;
}
