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

export interface VoxelGrid {
  /** Voxel edge length in scene-local units. */
  resolution: number;
  /** Whether the scene-local point lies in a solid voxel. */
  isSolid(x: number, y: number, z: number): boolean;
  /** Centres of solid voxels within `radius` of a scene-local point (at most `limit`). */
  solidVoxelsNear(x: number, y: number, z: number, radius: number, limit: number): [number, number, number][];
}

interface VoxelMeta {
  version: string;
  gridBounds: { min: number[] };
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

  return {
    resolution: res,
    isSolid(x, y, z) {
      // Scene-local to PlayCanvas' frame: 180° about Z.
      return solidAt(Math.floor((-x - minX) / res), Math.floor((-y - minY) / res), Math.floor((z - minZ) / res));
    },
    solidVoxelsNear(x, y, z, radius, limit) {
      const found: [number, number, number][] = [];
      const cx = (-x - minX) / res;
      const cy = (-y - minY) / res;
      const cz = (z - minZ) / res;
      const r = radius / res;
      for (let ix = Math.floor(cx - r); ix <= cx + r; ix++) {
        for (let iy = Math.floor(cy - r); iy <= cy + r; iy++) {
          for (let iz = Math.floor(cz - r); iz <= cz + r; iz++) {
            if ((ix + 0.5 - cx) ** 2 + (iy + 0.5 - cy) ** 2 + (iz + 0.5 - cz) ** 2 > r * r) continue;
            if (!solidAt(ix, iy, iz)) continue;
            // Back to scene-local coordinates.
            found.push([-(minX + (ix + 0.5) * res), -(minY + (iy + 0.5) * res), minZ + (iz + 0.5) * res]);
            if (found.length >= limit) return found;
          }
        }
      }
      return found;
    },
  };
}
