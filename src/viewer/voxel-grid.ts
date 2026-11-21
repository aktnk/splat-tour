// Reads the sparse voxel octree splat-transform writes for collision
// (`.voxel.json` + `.voxel.bin`, e.g. with --collision-mesh) and answers
// whether a point is inside a solid voxel.
//
// Format (splat-transform 3.10, version "1.1"): the .bin holds `nodeCount`
// Uint32 node words, then `leafDataCount` Uint32 leaf words. Node 0 is the
// root, a cube of 2^treeDepth blocks from gridBounds.min; a block is 4x4x4
// voxels. A node word is 0xFF000000 for a solid subtree; otherwise interior
// nodes keep their child octants in the top byte (bit = x | y << 1 | z << 2)
// and the index of their first child in the low 24 bits, children stored in
// octant order. Children of the block level are leaves: solid, or "mixed"
// with the low 24 bits indexing a pair of mask words (bit = x + 4y + 16z;
// the first word holds bits 0-31).
//
// splat-transform works in PlayCanvas' frame, which is the splat file's
// turned 180° about Z: a scene-local point (x, y, z) is (-x, -y, z) there.

const SOLID = 0xff000000;
const FACES = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const SPECK_CACHE_LIMIT = 200_000;
/** Above any voxel index on an axis (the root of a depth-12 tree has 16384 voxels across). */
const KEY_SPAN = 1 << 15;

export interface VoxelGrid {
  /** Voxel edge length in scene-local units. */
  resolution: number;
  /** Size of what the voxels cover (scene-local units, x y z), from the file's sceneBounds (else its grid). */
  extent: [number, number, number];
  /** Whether the scene-local point lies in a solid voxel. */
  isSolid(x: number, y: number, z: number): boolean;
  /**
   * Whether the solid voxel at a scene-local point belongs to a small lump
   * (at most `maxVoxels` connected through faces), e.g. a floater.
   */
  isSpeck(x: number, y: number, z: number, maxVoxels: number): boolean;
  /** Centres of solid voxels within `radius` of a scene-local point, nearest first (at most `limit`). */
  solidVoxelsNear(x: number, y: number, z: number, radius: number, limit: number): [number, number, number][];
  /**
   * Boxes covering the solid voxels within `radius` of a scene-local point,
   * nearest first (at most `limit`), as [x, y, z, edge] (centre and edge,
   * scene-local): single voxels near, and far away the blocks and larger
   * parts of the tree that hold some, once their edge is at most `detail`
   * times their distance (0: single voxels only).
   */
  boxesNear(x: number, y: number, z: number, radius: number, limit: number, detail: number): [number, number, number, number][];
}

interface VoxelMeta {
  version: string;
  gridBounds: { min: number[]; max?: number[] };
  sceneBounds?: { min: number[]; max: number[] };
  voxelResolution: number;
  leafSize: number;
  treeDepth: number;
  nodeCount: number;
  leafDataCount: number;
}

function popcount(n: number): number {
  let count = 0;
  while (n) {
    n &= n - 1;
    count++;
  }
  return count;
}

export function parseVoxelGrid(metaJson: unknown, bin: ArrayBuffer): VoxelGrid {
  const meta = metaJson as VoxelMeta;
  if (!meta || typeof meta.voxelResolution !== "number" || !Array.isArray(meta.gridBounds?.min)) {
    throw new Error(".voxel.json の形式が違います");
  }
  if (meta.leafSize !== 4) {
    throw new Error(`対応していないボクセル形式です（leafSize ${meta.leafSize}）`);
  }
  const words = new Uint32Array(bin, 0, Math.floor(bin.byteLength / 4));
  if (words.length < meta.nodeCount + meta.leafDataCount) {
    throw new Error(".voxel.bin が .voxel.json と合いません（ファイルの組み合わせを確かめてください）");
  }
  const nodes = words.subarray(0, meta.nodeCount);
  const leaves = words.subarray(meta.nodeCount, meta.nodeCount + meta.leafDataCount);
  const res = meta.voxelResolution;
  const [minX, minY, minZ] = meta.gridBounds.min;
  const depth = meta.treeDepth;
  const size = 4 << depth; // voxels per axis covered by the root

  /** Solid test in voxel indices of PlayCanvas' frame. */
  function solidAt(ix: number, iy: number, iz: number): boolean {
    if (ix < 0 || iy < 0 || iz < 0 || ix >= size || iy >= size || iz >= size || nodes.length === 0) {
      return false;
    }
    const bx = ix >> 2;
    const by = iy >> 2;
    const bz = iz >> 2;
    let word = nodes[0];
    for (let level = depth; level > 0; level--) {
      if (word === SOLID) return true;
      const mask = word >>> 24;
      const shift = level - 1;
      const octant = ((bx >> shift) & 1) | (((by >> shift) & 1) << 1) | (((bz >> shift) & 1) << 2);
      if (!(mask & (1 << octant))) return false;
      word = nodes[(word & 0xffffff) + popcount(mask & ((1 << octant) - 1))];
    }
    if (word === SOLID) return true;
    const leaf = (word & 0xffffff) * 2;
    const bit = (ix & 3) + ((iy & 3) << 2) + ((iz & 3) << 4);
    return bit < 32 ? ((leaves[leaf] >>> bit) & 1) === 1 : ((leaves[leaf + 1] >>> (bit - 32)) & 1) === 1;
  }

  // Keyed by voxel index as one number (indices are below KEY_SPAN; outside the grid is never solid).
  const speckCache = new Map<number, boolean>();
  const key = (i: number, j: number, k: number) => i + KEY_SPAN * (j + KEY_SPAN * k);
  // Scene-local to voxel indices in PlayCanvas' frame (180° about Z).
  const ix = (x: number) => Math.floor((-x - minX) / res);
  const iy = (y: number) => Math.floor((-y - minY) / res);
  const iz = (z: number) => Math.floor((z - minZ) / res);

  const covered = meta.sceneBounds ?? (meta.gridBounds.max ? { min: meta.gridBounds.min, max: meta.gridBounds.max } : null);
  const extent: [number, number, number] = covered
    ? [0, 1, 2].map((a) => Math.abs(covered.max[a] - covered.min[a])) as [number, number, number]
    : [size * res, size * res, size * res];

  return {
    resolution: res,
    extent,
    isSolid(x, y, z) {
      return solidAt(ix(x), iy(y), iz(z));
    },
    isSpeck(x, y, z, maxVoxels) {
      const start = key(ix(x), iy(y), iz(z));
      const cached = speckCache.get(start);
      if (cached !== undefined) return cached;
      // Breadth-first over face neighbours until the lump is known to be large.
      const seen = new Set([start]);
      const queue = [start];
      let small = true;
      while (queue.length > 0 && small) {
        const k0 = queue.pop() as number;
        const i = k0 % KEY_SPAN;
        const j = Math.floor(k0 / KEY_SPAN) % KEY_SPAN;
        const k = Math.floor(k0 / (KEY_SPAN * KEY_SPAN));
        for (const [di, dj, dk] of FACES) {
          const n = key(i + di, j + dj, k + dk);
          if (seen.has(n) || !solidAt(i + di, j + dj, k + dk)) continue;
          seen.add(n);
          if (seen.size > maxVoxels) {
            small = false;
            break;
          }
          queue.push(n);
        }
      }
      if (speckCache.size > SPECK_CACHE_LIMIT) speckCache.clear();
      // Every voxel of a small lump is a speck too; of a large one only the start is known.
      for (const n of small ? seen : [start]) speckCache.set(n, small);
      return small;
    },
    solidVoxelsNear(x, y, z, radius, limit) {
      return this.boxesNear(x, y, z, radius, limit, 0).map(([bx, by, bz]) => [bx, by, bz]);
    },
    boxesNear(x, y, z, radius, limit, detail) {
      // Walks the tree, skipping subtrees outside the sphere, so a wide
      // radius costs the boxes found rather than the space around them. A
      // subtree whose edge is at most `detail` times its distance is one box
      // (its blocks, then larger nodes, far away). Past `limit`, the nearest
      // are kept.
      const cx = (-x - minX) / res;
      const cy = (-y - minY) / res;
      const cz = (z - minZ) / res;
      const r = radius / res;
      const r2 = r * r;
      const cap = limit * 4;
      const found: number[] = []; // ix, iy, iz (lowest corner), edge, squared distance (all in voxels)
      const emit = (ix: number, iy: number, iz: number, n: number) => {
        const d = (ix + n / 2 - cx) ** 2 + (iy + n / 2 - cy) ** 2 + (iz + n / 2 - cz) ** 2;
        if (d <= r2) found.push(ix, iy, iz, n, d);
      };
      // Squared distance from the centre to the cube of `n` voxels from (ox, oy, oz).
      const reach = (ox: number, oy: number, oz: number, n: number) => {
        const dx = Math.max(ox - cx, 0, cx - (ox + n));
        const dy = Math.max(oy - cy, 0, cy - (oy + n));
        const dz = Math.max(oz - cz, 0, cz - (oz + n));
        return dx * dx + dy * dy + dz * dz;
      };
      const visit = (word: number, level: number, bx: number, by: number, bz: number) => {
        const n = 4 << level;
        const ox = bx * 4;
        const oy = by * 4;
        const oz = bz * 4;
        if (found.length >= cap * 5) return;
        const near = reach(ox, oy, oz, n);
        if (near > r2) return;
        if (detail > 0 && n * n <= near * detail * detail) {
          emit(ox, oy, oz, n);
          return;
        }
        if (word === SOLID) {
          const x0 = Math.max(ox, Math.floor(cx - r));
          const y0 = Math.max(oy, Math.floor(cy - r));
          const z0 = Math.max(oz, Math.floor(cz - r));
          const x1 = Math.min(ox + n, Math.ceil(cx + r));
          const y1 = Math.min(oy + n, Math.ceil(cy + r));
          const z1 = Math.min(oz + n, Math.ceil(cz + r));
          for (let i = x0; i < x1; i++) for (let j = y0; j < y1; j++) for (let k = z0; k < z1; k++) emit(i, j, k, 1);
          return;
        }
        if (level === 0) {
          const leaf = (word & 0xffffff) * 2;
          for (let bit = 0; bit < 64; bit++) {
            const solid = bit < 32 ? (leaves[leaf] >>> bit) & 1 : (leaves[leaf + 1] >>> (bit - 32)) & 1;
            if (solid) emit(ox + (bit & 3), oy + ((bit >> 2) & 3), oz + ((bit >> 4) & 3), 1);
          }
          return;
        }
        const mask = word >>> 24;
        const first = word & 0xffffff;
        const half = 1 << (level - 1);
        let index = 0;
        for (let octant = 0; octant < 8; octant++) {
          if (!(mask & (1 << octant))) continue;
          visit(
            nodes[first + index++],
            level - 1,
            bx + (octant & 1 ? half : 0),
            by + (octant & 2 ? half : 0),
            bz + (octant & 4 ? half : 0),
          );
        }
      };
      if (nodes.length > 0) visit(nodes[0], depth, 0, 0, 0);
      // Nearest first (an overlay drawn in this order shows only the front layer), at most `limit`.
      const order = Array.from({ length: found.length / 5 }, (_, i) => i)
        .sort((a, b) => found[a * 5 + 4] - found[b * 5 + 4])
        .slice(0, limit);
      // Back to scene-local coordinates (centres; the frame is turned 180° about Z).
      return order.map((i) => {
        const n = found[i * 5 + 3];
        return [
          -(minX + (found[i * 5] + n / 2) * res),
          -(minY + (found[i * 5 + 1] + n / 2) * res),
          minZ + (found[i * 5 + 2] + n / 2) * res,
          n * res,
        ];
      });
    },
  };
}
