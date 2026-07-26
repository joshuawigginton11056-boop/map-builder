// The clay itself: a square grid of heights, and the math to read it.
//
// Everything downstream — the mesh, the brush, the cursor ring, save/load —
// talks to the world through this one array. Keeping it a plain Float32Array
// (rather than, say, asking Three.js for vertex positions) means the sculpting
// math never has to know a renderer exists, and a stroke is just numbers.
//
// Layout: `heights[iz * size + ix]`, with the field centred on the world origin.
// Grid column `ix` sits at world x = -extent/2 + ix * spacing, and row `iz` at
// world z = -extent/2 + iz * spacing. The terrain mesh is built with the exact
// same indexing so vertex n and height n are the same point — no lookup table.

export interface Heightfield {
  /** Vertices per side (so `size - 1` quads per side). */
  readonly size: number;
  /** World units per side. */
  readonly extent: number;
  /** World units between neighbouring grid points. */
  readonly spacing: number;
  /** `size * size` heights in world units, row-major by z. */
  readonly heights: Float32Array;
  /**
   * An upper bound on every height in the field — used only to skip the empty
   * sky when raycasting. Deliberately allowed to drift *high*: it grows when
   * you raise ground and never shrinks when you lower it, so an over-estimate
   * costs a handful of extra ray steps and nothing else. The alternative — an
   * exact max — means scanning a quarter-million heights on every mouse move.
   * `recomputeCeiling` tightens it after a load.
   */
  ceiling: number;
}

/** A rectangle of grid cells, inclusive on both ends. Used to tell the mesh
 * which slice of itself a stroke dirtied, so we never re-upload 262k vertices
 * to the GPU because the brush touched forty of them. */
export interface GridRect {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

export function createHeightfield(size: number, extent: number): Heightfield {
  return {
    size,
    extent,
    spacing: extent / (size - 1),
    heights: new Float32Array(size * size),
    ceiling: 0,
  };
}

/** World x of grid column `ix`. */
export function worldXOf(hf: Heightfield, ix: number): number {
  return -hf.extent / 2 + ix * hf.spacing;
}

/** World z of grid row `iz`. */
export function worldZOf(hf: Heightfield, iz: number): number {
  return -hf.extent / 2 + iz * hf.spacing;
}

/** Fractional grid coordinates for a world position (may fall outside 0..size-1). */
export function gridXOf(hf: Heightfield, x: number): number {
  return (x + hf.extent / 2) / hf.spacing;
}

export function gridZOf(hf: Heightfield, z: number): number {
  return (z + hf.extent / 2) / hf.spacing;
}

function clampIndex(v: number, size: number): number {
  return v < 0 ? 0 : v > size - 1 ? size - 1 : v;
}

/** Height at an exact grid point, clamped at the edges. */
export function heightAtGrid(hf: Heightfield, ix: number, iz: number): number {
  const cx = clampIndex(ix, hf.size);
  const cz = clampIndex(iz, hf.size);
  return hf.heights[cz * hf.size + cx]!;
}

/**
 * Height at an arbitrary world position, bilinearly interpolated. Outside the
 * field it clamps to the edge, which is what you want for a ray that leaves the
 * terrain sideways: it keeps marching against a sane surface instead of falling
 * through a hole.
 */
export function heightAtWorld(hf: Heightfield, x: number, z: number): number {
  const gx = gridXOf(hf, x);
  const gz = gridZOf(hf, z);
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const tx = gx - ix;
  const tz = gz - iz;

  const h00 = heightAtGrid(hf, ix, iz);
  const h10 = heightAtGrid(hf, ix + 1, iz);
  const h01 = heightAtGrid(hf, ix, iz + 1);
  const h11 = heightAtGrid(hf, ix + 1, iz + 1);

  const a = h00 + (h10 - h00) * tx;
  const b = h01 + (h11 - h01) * tx;
  return a + (b - a) * tz;
}

/** Scan the whole field and tighten `ceiling` to the true maximum. Cheap enough
 * once, after a load or a New — not something to do per frame. */
export function recomputeCeiling(hf: Heightfield): void {
  let max = 0;
  for (let i = 0; i < hf.heights.length; i++) {
    const h = hf.heights[i]!;
    if (h > max) max = h;
  }
  hf.ceiling = max;
}

export interface RayHit {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Where a ray meets the terrain, or null if it misses.
 *
 * Deliberately NOT Three.js's mesh raycaster: that walks half a million
 * triangles and it runs on every single mouse move. Marching the heightfield
 * analytically is a few hundred cheap samples, and it stays exact no matter how
 * dense the grid gets.
 *
 * The march looks for the point where the ray crosses from above the surface to
 * below it, then bisects to pin it down. A ray that starts *below* the surface
 * (camera buried inside a mountain you just raised) is treated as an immediate
 * hit at its origin, so the brush never goes dead.
 */
export function raycastHeightfield(
  hf: Heightfield,
  originX: number,
  originY: number,
  originZ: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  maxDistance = 20000,
): RayHit | null {
  const sample = (t: number): number =>
    originY + dirY * t - heightAtWorld(hf, originX + dirX * t, originZ + dirZ * t);

  if (sample(0) <= 0) {
    return { x: originX, y: originY, z: originZ };
  }

  // Skip the empty sky above the terrain in one jump rather than stepping
  // through it: on a 1024-unit field viewed from a distance that is most of the
  // ray, and every sample of it is guaranteed to miss.
  let t = 0;
  if (dirY < 0 && originY > hf.ceiling) {
    const toCeiling = (hf.ceiling - originY) / dirY;
    if (toCeiling > maxDistance) return null;
    if (toCeiling > 0) t = toCeiling;
  }

  // Half a cell per step: fine enough that the ray cannot tunnel through a
  // ridge, coarse enough to stay cheap.
  const step = Math.max(hf.spacing * 0.5, 0.05);
  let prevT = t;
  if (sample(t) <= 0) return hitAt(originX, originY, originZ, dirX, dirY, dirZ, t);

  for (t += step; t <= maxDistance; t += step) {
    if (sample(t) <= 0) {
      // Bracketed. Bisect for a stable, sub-cell-accurate crossing.
      let lo = prevT;
      let hi = t;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (sample(mid) > 0) lo = mid;
        else hi = mid;
      }
      return hitAt(originX, originY, originZ, dirX, dirY, dirZ, (lo + hi) / 2);
    }
    prevT = t;
  }

  return null;
}

function hitAt(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  t: number,
): RayHit {
  return { x: ox + dx * t, y: oy + dy * t, z: oz + dz * t };
}
