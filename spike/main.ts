import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { setupScene } from "../src/scene";
import { setupJoystick, setupSparkControls } from "../src/controls";

// Loading spike: loads one converted variant at a time (see
// tools/spike/convert.mjs) and shows load time, transferred bytes, frame rate
// and splat count so they can be compared on real phones.

const BASE_JOYSTICK_SPEED = 2.0;
const FRAME_WINDOW_MS = 5000;
const STATS_POLL_MS = 500;
// Seconds after a load starts at which a snapshot is saved automatically, so
// a run that ends in a browser crash still leaves its earlier numbers behind.
const AUTO_RECORD_SECONDS = [3, 10, 30];

interface Variant {
  scene: string;
  file: string;
  label: string;
  kind: "splat" | "mesh";
  bytes: number;
  paged?: boolean;
}

interface ServerStats {
  bytes: number;
  requests: number;
  rangeRequests: number;
}

interface LoadRun {
  variant: Variant;
  paged: boolean;
  lod: boolean;
  startedAt: number;
  readyMs: number | null;
  firstSplatsMs: number | null;
  error: string | null;
}

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function formatMb(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

function formatSeconds(ms: number | null): string {
  return ms === null ? "-" : `${(ms / 1000).toFixed(2)} s`;
}

function describeGpu(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  return String(
    info
      ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER),
  );
}

function usedHeapMb(): number | null {
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize: number };
  }).memory;
  return memory ? Math.round(memory.usedJSHeapSize / 1e6) : null;
}

async function init(): Promise<void> {
  const canvas = byId<HTMLCanvasElement>("viewer-canvas");
  const panel = byId<HTMLElement>("panel");
  const panelToggleBtn = byId<HTMLButtonElement>("panel-toggle-btn");
  const variantSelect = byId<HTMLSelectElement>("variant-select");
  const pagedCheck = byId<HTMLInputElement>("paged-check");
  const lodCheck = byId<HTMLInputElement>("lod-check");
  const loadBtn = byId<HTMLButtonElement>("load-btn");
  const pixelRatioSelect = byId<HTMLSelectElement>("pixel-ratio-select");
  const lodScaleRange = byId<HTMLInputElement>("lod-scale-range");
  const lodScaleValue = byId<HTMLElement>("lod-scale-value");
  const moveSpeedRange = byId<HTMLInputElement>("move-speed-range");
  const moveSpeedValue = byId<HTMLElement>("move-speed-value");
  const flipBtn = byId<HTMLButtonElement>("flip-btn");
  const centerBtn = byId<HTMLButtonElement>("center-btn");
  const metricsEl = byId<HTMLElement>("metrics");
  const recordBtn = byId<HTMLButtonElement>("record-btn");
  const copyBtn = byId<HTMLButtonElement>("copy-btn");
  const resultsEl = byId<HTMLTextAreaElement>("results");

  const { scene, camera, renderer, sparkRenderer } = setupScene(canvas);
  const controls = setupSparkControls(canvas);
  const joystick = setupJoystick(byId<HTMLElement>("joystick-zone"));
  const baseMoveSpeed = controls.fpsMovement.moveSpeed;

  const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const lights = new THREE.Group();
  lights.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(3, 5, 4);
  lights.add(sun);

  const device = {
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    screen: `${screen.width}x${screen.height}`,
    gpu: describeGpu(renderer),
  };

  let variants: Variant[] = [];
  let current: SplatMesh | THREE.Object3D | null = null;
  let orbit: OrbitControls | null = null;
  let run: LoadRun | null = null;
  let serverStats: ServerStats | null = null;
  // End time and duration of each frame within FRAME_WINDOW_MS. Durations are
  // kept per frame so a single frame longer than the window still counts.
  const frames: { time: number; duration: number }[] = [];
  let lastFrameTime: number | null = null;
  const results: unknown[] = [];
  let autoRecordTimers: ReturnType<typeof setTimeout>[] = [];

  function selectedVariant(): Variant | undefined {
    return variants[Number(variantSelect.value)];
  }

  function applyPixelRatio(): void {
    const value = pixelRatioSelect.value;
    renderer.setPixelRatio(value === "native" ? window.devicePixelRatio : Number(value));
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function setSplatControlsEnabled(enabled: boolean): void {
    controls.fpsMovement.enable = enabled;
    controls.pointerControls.enable = enabled;
  }

  function unloadCurrent(): void {
    if (!current) {
      return;
    }
    scene.remove(current);
    if (current instanceof SplatMesh) {
      current.dispose();
    } else {
      current.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of materials) m.dispose();
        }
      });
    }
    current = null;
    scene.remove(lights);
    orbit?.dispose();
    orbit = null;
    setSplatControlsEnabled(true);
  }

  async function loadSplat(variant: Variant, thisRun: LoadRun): Promise<void> {
    const mesh = new SplatMesh({
      url: variant.file,
      paged: thisRun.paged,
      lod: thisRun.lod || undefined,
    });
    current = mesh;
    scene.add(mesh);
    await mesh.initialized;
  }

  async function loadMesh(variant: Variant): Promise<void> {
    const gltf = await gltfLoader.loadAsync(variant.file);
    const root = gltf.scene;
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    root.position.sub(box.getCenter(new THREE.Vector3()));
    current = root;
    scene.add(root);
    scene.add(lights);

    setSplatControlsEnabled(false);
    camera.position.set(0, 0, size * 1.2);
    camera.quaternion.identity();
    orbit = new OrbitControls(camera, canvas);
    orbit.target.set(0, 0, 0);
    orbit.update();
  }

  async function load(): Promise<void> {
    const variant = selectedVariant();
    if (!variant) {
      return;
    }
    unloadCurrent();
    for (const timer of autoRecordTimers) clearTimeout(timer);
    autoRecordTimers = AUTO_RECORD_SECONDS.map((sec) =>
      setTimeout(() => record(`auto-${sec}s`), sec * 1000),
    );
    await fetch("/__spike/reset", { method: "POST" }).catch(() => undefined);
    frames.length = 0;
    camera.position.set(0, 0, 0);
    camera.quaternion.identity();

    const thisRun: LoadRun = {
      variant,
      paged: variant.kind === "splat" && pagedCheck.checked,
      lod: variant.kind === "splat" && lodCheck.checked,
      startedAt: performance.now(),
      readyMs: null,
      firstSplatsMs: null,
      error: null,
    };
    run = thisRun;
    try {
      if (variant.kind === "splat") {
        await loadSplat(variant, thisRun);
      } else {
        await loadMesh(variant);
      }
      thisRun.readyMs = performance.now() - thisRun.startedAt;
    } catch (err) {
      thisRun.error = err instanceof Error ? err.message : String(err);
      console.error(err);
    }
  }

  function snapshot(): Record<string, unknown> {
    const now = performance.now();
    const recent = frames.filter((f) => now - f.time <= 1000);
    const worst = frames.reduce((max, f) => Math.max(max, f.duration), 0);
    return {
      variant: run?.variant.file ?? null,
      fileMb: run ? Number((run.variant.bytes / 1e6).toFixed(1)) : null,
      paged: run?.paged ?? null,
      lod: run?.lod ?? null,
      elapsedS: run ? Number(((now - run.startedAt) / 1000).toFixed(2)) : null,
      readyS: run?.readyMs != null ? Number((run.readyMs / 1000).toFixed(2)) : null,
      firstSplatsS:
        run?.firstSplatsMs != null ? Number((run.firstSplatsMs / 1000).toFixed(2)) : null,
      transferredMb: serverStats ? Number((serverStats.bytes / 1e6).toFixed(1)) : null,
      requests: serverStats?.requests ?? null,
      rangeRequests: serverStats?.rangeRequests ?? null,
      fps: recent.length,
      worstFrameMs: Math.round(worst),
      activeSplats: sparkRenderer.activeSplats,
      lodSplatScale: sparkRenderer.lodSplatScale,
      canvas: `${renderer.domElement.width}x${renderer.domElement.height}`,
      pixelRatio: renderer.getPixelRatio(),
      heapMb: usedHeapMb(),
      error: run?.error ?? null,
    };
  }

  function renderMetrics(): void {
    const s = snapshot();
    const rows: [string, string][] = [
      ["状態", run ? (run.error ? `エラー: ${run.error}` : run.readyMs === null ? "読み込み中" : "完了") : "-"],
      ["経過", run ? formatSeconds(performance.now() - run.startedAt) : "-"],
      ["準備完了まで", formatSeconds(run?.readyMs ?? null)],
      ["最初の描画まで", formatSeconds(run?.firstSplatsMs ?? null)],
      ["通信量", serverStats ? `${formatMb(serverStats.bytes)}（${serverStats.requests}回, Range ${serverStats.rangeRequests}）` : "-"],
      ["FPS", String(s.fps)],
      ["最悪フレーム(5s)", `${String(s.worstFrameMs)} ms`],
      ["描画スプラット数（視野内）", sparkRenderer.activeSplats.toLocaleString()],
      ["描画解像度", String(s.canvas)],
      ["JSヒープ", s.heapMb === null ? "取得不可" : `${String(s.heapMb)} MB`],
    ];
    metricsEl.replaceChildren(
      ...rows.flatMap(([k, v]) => {
        const dt = document.createElement("dt");
        dt.textContent = k;
        const dd = document.createElement("dd");
        dd.textContent = v;
        return [dt, dd];
      }),
    );
  }

  async function pollServerStats(): Promise<void> {
    try {
      const response = await fetch("/__spike/stats", { cache: "no-store" });
      serverStats = (await response.json()) as ServerStats;
    } catch {
      serverStats = null;
    }
  }

  panelToggleBtn.addEventListener("click", () => {
    const collapsed = panel.classList.toggle("collapsed");
    panelToggleBtn.textContent = collapsed ? "パネルを開く" : "パネルを閉じる";
  });

  variantSelect.addEventListener("change", () => {
    const variant = selectedVariant();
    pagedCheck.checked = variant?.paged ?? false;
    lodCheck.checked = false;
  });

  loadBtn.addEventListener("click", () => {
    void load();
  });

  pixelRatioSelect.addEventListener("change", applyPixelRatio);

  lodScaleRange.addEventListener("input", () => {
    sparkRenderer.lodSplatScale = Number(lodScaleRange.value);
    lodScaleValue.textContent = Number(lodScaleRange.value).toFixed(2);
  });

  moveSpeedRange.addEventListener("input", () => {
    controls.fpsMovement.moveSpeed = baseMoveSpeed * Number(moveSpeedRange.value);
    moveSpeedValue.textContent = Number(moveSpeedRange.value).toFixed(2);
  });

  flipBtn.addEventListener("click", () => {
    if (current instanceof SplatMesh) {
      current.rotation.x = current.rotation.x === 0 ? Math.PI : 0;
    }
  });

  centerBtn.addEventListener("click", () => {
    if (!(current instanceof SplatMesh)) {
      return;
    }
    try {
      const box = current.getBoundingBox(true).applyMatrix4(current.matrixWorld);
      camera.position.copy(box.getCenter(new THREE.Vector3()));
    } catch (err) {
      console.warn("bounding box unavailable", err);
    }
  });

  // Each record is also sent to the dev server, which appends it to
  // spike/results/results.jsonl on the PC, so phones need no copy and paste.
  function record(trigger: string): void {
    const entry = { trigger, device, ...snapshot(), recordedAt: new Date().toISOString() };
    results.push(entry);
    resultsEl.value = JSON.stringify(results, null, 2);
    resultsEl.scrollTop = resultsEl.scrollHeight;
    void fetch("/__spike/results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
      keepalive: true,
    }).catch(() => undefined);
  }

  recordBtn.addEventListener("click", () => record("manual"));

  copyBtn.addEventListener("click", () => {
    // navigator.clipboard only exists in secure contexts; a phone opening the
    // dev server over plain http on the LAN falls back to a manual copy.
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(resultsEl.value).then(() => {
        copyBtn.textContent = "コピーしました";
        setTimeout(() => (copyBtn.textContent = "結果をコピー"), 1500);
      });
    } else {
      resultsEl.focus();
      resultsEl.select();
      copyBtn.textContent = "選択しました。長押しでコピー";
    }
  });

  applyPixelRatio();
  window.addEventListener("resize", applyPixelRatio);

  try {
    const response = await fetch("/variants.json", { cache: "no-store" });
    variants = (await response.json()) as Variant[];
  } catch {
    variants = [];
  }
  variantSelect.replaceChildren(
    ...variants.map((v, i) => {
      const option = document.createElement("option");
      option.value = String(i);
      option.textContent = `${v.scene} / ${v.label} / ${formatMb(v.bytes)}`;
      return option;
    }),
  );
  if (variants.length === 0) {
    const option = document.createElement("option");
    option.textContent = "variants.json がありません（npm run spike:convert を実行）";
    variantSelect.append(option);
    loadBtn.disabled = true;
  } else {
    variantSelect.dispatchEvent(new Event("change"));
  }

  setInterval(() => {
    void pollServerStats();
    renderMetrics();
  }, STATS_POLL_MS);

  function animate(time: number): void {
    if (lastFrameTime !== null) {
      frames.push({ time, duration: time - lastFrameTime });
    }
    lastFrameTime = time;
    while (frames.length > 0 && time - frames[0].time > FRAME_WINDOW_MS) {
      frames.shift();
    }

    if (orbit) {
      orbit.update();
    } else {
      const moveVector = joystick.getMoveVector();
      const speed = BASE_JOYSTICK_SPEED * Number(moveSpeedRange.value);
      controls.fpsMovement.extraMove.set(moveVector.x * speed, 0, -moveVector.y * speed);
      controls.update(camera);
    }
    renderer.render(scene, camera);

    // activeSplats can still count the previous scene right after a switch,
    // so only trust it once the new mesh is initialized.
    if (
      run &&
      run.firstSplatsMs === null &&
      current instanceof SplatMesh &&
      current.isInitialized &&
      sparkRenderer.activeSplats > 0
    ) {
      run.firstSplatsMs = performance.now() - run.startedAt;
    }
  }

  renderer.setAnimationLoop(animate);
}

void init();
