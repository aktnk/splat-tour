// Fetches the start of another scene's splat before the visitor goes there,
// so moving to it waits less: when they come near an entrance to it or its
// popup shows. Only the browser's HTTP cache is warmed; Spark then loads the
// same URLs as usual. For a chunked LoD .rad that is the small header file
// and its chunk 0 (the coarse levels, what the scene first shows); for a
// single-file .rad only its header; other formats are not fetched ahead
// (they are one large file). Nothing is fetched with the browser's data
// saver on.

export interface Prefetch {
  /** Starts fetching the beginning of the splat at this URL, once per URL. */
  splat(url: string): void;
}

const RAD_MAGIC = "RAD0";

interface RadChunk {
  filename?: string;
}

/** Reads a .rad's header ("RAD0", JSON length, JSON) and stops there; returns its chunks. */
async function readRadChunks(url: string): Promise<RadChunk[]> {
  const response = await fetch(url);
  if (!response.ok || !response.body) return [];
  const reader = response.body.getReader();
  let bytes = new Uint8Array(0);
  let need = 8;
  try {
    while (bytes.length < need) {
      const { done, value } = await reader.read();
      if (done) break;
      const next = new Uint8Array(bytes.length + value.length);
      next.set(bytes);
      next.set(value, bytes.length);
      bytes = next;
      if (need === 8 && bytes.length >= 8) {
        if (String.fromCharCode(...bytes.subarray(0, 4)) !== RAD_MAGIC) return [];
        need = 8 + new DataView(bytes.buffer).getUint32(4, true);
      }
    }
    if (bytes.length < need) return [];
    const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(8, need))) as { chunks?: RadChunk[] };
    const chunks = Array.isArray(meta.chunks) ? meta.chunks : [];
    // A chunked .rad is only its header, so reading it to the end puts it
    // in the cache; a single-file one goes on with all its splats: stop.
    if (chunks[0]?.filename) {
      while (!(await reader.read()).done);
    }
    return chunks;
  } finally {
    void reader.cancel().catch(() => {});
  }
}

export function setupPrefetch(): Prefetch {
  const started = new Set<string>();
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;

  async function run(url: string): Promise<void> {
    const chunks = await readRadChunks(url);
    const first = chunks[0]?.filename;
    if (!first) return;
    const response = await fetch(new URL(first, new URL(url, window.location.href)).toString());
    if (response.ok) await response.arrayBuffer();
  }

  return {
    splat(url) {
      if (saveData || started.has(url)) return;
      if (!/\.rad$/i.test(new URL(url, window.location.href).pathname)) return;
      started.add(url);
      // Only a head start: a failure here shows up when the scene is loaded.
      run(url).catch(() => started.delete(url));
    },
  };
}
