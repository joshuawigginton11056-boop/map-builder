// The brush: what actually moves the clay.
//
// Applied once per frame while the mouse is held, not once per mouse-move
// event. That matters for feel — event-driven sculpting piles up strength where
// you move slowly and skips where you move fast, so the same drag gives a
// different mountain depending on your mouse. Rate × frame time is steady.

import type { GridRect, Heightfield } from "../terrain/heightfield";
import { gridXOf, gridZOf, heightAtGrid, worldXOf, worldZOf } from "../terrain/heightfield";
import type { History } from "./history";

/** The tools that move the clay. Paint is a tool too, but it writes elsewhere. */
export type SculptToolId = "raise" | "lower" | "smooth" | "flatten";

export type ToolId = SculptToolId | "paint";

export interface BrushSettings {
  /** Brush radius in world units. */
  readonly radius: number;
  /** 0–100. Height gain per second for raise/lower; approach rate otherwise. */
  readonly strength: number;
  /** 0–1. Fraction of the radius that is soft rim. 0 = hard edge, 1 = all rim. */
  readonly falloff: number;
}

export const DEFAULT_BRUSH: BrushSettings = {
  radius: 60,
  strength: 50,
  falloff: 0.6,
};

export const MIN_RADIUS = 4;
export const MAX_RADIUS = 320;

/**
 * Brush weight at distance `d` from the centre.
 *
 * The inner disc is at full strength and only the rim falls away, which is how
 * Unreal's landscape falloff behaves and why its brushes feel like a tool
 * rather than a blur. A pure bell curve (weight peaking at a single point)
 * makes it very hard to build a flat-topped plateau.
 */
export function brushWeight(d: number, radius: number, falloff: number): number {
  if (d >= radius) return 0;
  const inner = radius * (1 - falloff);
  if (d <= inner) return 1;
  const rim = radius - inner;
  if (rim <= 0) return 1;
  const t = (d - inner) / rim;
  // Smootherstep, inverted: flat at both ends, so strokes blend into each other
  // without leaving a visible seam ring.
  return 1 - t * t * t * (t * (t * 6 - 15) + 10);
}

/** Scratch for smooth's read-before-write pass; grown on demand, never shrunk. */
let scratch = new Float32Array(0);

export interface BrushHit {
  readonly x: number;
  readonly z: number;
}

/**
 * Apply one frame of brushing centred on a world position.
 *
 * Returns the rectangle of grid cells it changed, or null if the brush fell
 * entirely outside the field. Every cell it writes is reported to `history`
 * first, so the stroke can be undone.
 */
export function applyBrush(
  hf: Heightfield,
  history: History,
  tool: SculptToolId,
  hit: BrushHit,
  settings: BrushSettings,
  dt: number,
  flattenTarget: number,
): GridRect | null {
  const { size, spacing, heights } = hf;
  const { radius, strength, falloff } = settings;

  const cells = radius / spacing;
  const gx = gridXOf(hf, hit.x);
  const gz = gridZOf(hf, hit.z);

  const minX = Math.max(0, Math.floor(gx - cells));
  const maxX = Math.min(size - 1, Math.ceil(gx + cells));
  const minZ = Math.max(0, Math.floor(gz - cells));
  const maxZ = Math.min(size - 1, Math.ceil(gz + cells));
  if (minX > maxX || minZ > maxZ) return null;

  const r2 = radius * radius;

  if (tool === "raise" || tool === "lower") {
    const delta = strength * 0.8 * dt * (tool === "lower" ? -1 : 1);
    // Raising is the only operation that can push ground above the field's
    // known ceiling (smooth averages, flatten targets an existing height), so
    // it is the only one that has to maintain it.
    let peak = hf.ceiling;
    for (let iz = minZ; iz <= maxZ; iz++) {
      const dz = worldZOf(hf, iz) - hit.z;
      for (let ix = minX; ix <= maxX; ix++) {
        const dx = worldXOf(hf, ix) - hit.x;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r2) continue;
        const w = brushWeight(Math.sqrt(d2), radius, falloff);
        if (w <= 0) continue;
        const i = iz * size + ix;
        history.record(i);
        const next = heights[i]! + delta * w;
        heights[i] = next;
        if (next > peak) peak = next;
      }
    }
    hf.ceiling = peak;
    return { minX, minZ, maxX, maxZ };
  }

  // Both remaining tools pull each height toward some target. Clamped at 1 so a
  // long frame can reach the target but never overshoot past it into a wobble.
  const rate = (strength / 50) * 3 * dt;

  if (tool === "flatten") {
    for (let iz = minZ; iz <= maxZ; iz++) {
      const dz = worldZOf(hf, iz) - hit.z;
      for (let ix = minX; ix <= maxX; ix++) {
        const dx = worldXOf(hf, ix) - hit.x;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r2) continue;
        const w = brushWeight(Math.sqrt(d2), radius, falloff);
        if (w <= 0) continue;
        const k = Math.min(1, rate * w);
        const i = iz * size + ix;
        history.record(i);
        heights[i] = heights[i]! + (flattenTarget - heights[i]!) * k;
      }
    }
    return { minX, minZ, maxX, maxZ };
  }

  // Smooth has to read the neighbourhood as it was at the start of this frame.
  // Writing in place would feed each already-smoothed cell into its neighbour's
  // average and smear the result in whatever direction the loop happens to run.
  const w = maxX - minX + 1;
  const h = maxZ - minZ + 1;
  if (scratch.length < w * h) scratch = new Float32Array(w * h);

  for (let iz = minZ; iz <= maxZ; iz++) {
    const dz = worldZOf(hf, iz) - hit.z;
    for (let ix = minX; ix <= maxX; ix++) {
      const dx = worldXOf(hf, ix) - hit.x;
      const d2 = dx * dx + dz * dz;
      const local = (iz - minZ) * w + (ix - minX);
      const current = heights[iz * size + ix]!;
      if (d2 >= r2) {
        scratch[local] = current;
        continue;
      }
      const weight = brushWeight(Math.sqrt(d2), radius, falloff);
      if (weight <= 0) {
        scratch[local] = current;
        continue;
      }
      // 3×3 box average. Nearly every cell of a stroke is in the interior, so
      // it gets a straight-line read; only the field's outer ring pays for
      // clamped lookups. At the maximum brush size this is the difference
      // between a smooth stroke and a stuttering one — it runs ~100,000 times
      // per frame.
      let sum: number;
      if (ix >= 1 && iz >= 1 && ix < size - 1 && iz < size - 1) {
        const mid = iz * size + ix;
        const up = mid - size;
        const down = mid + size;
        sum =
          heights[up - 1]! + heights[up]! + heights[up + 1]! +
          heights[mid - 1]! + heights[mid]! + heights[mid + 1]! +
          heights[down - 1]! + heights[down]! + heights[down + 1]!;
      } else {
        sum = 0;
        for (let oz = -1; oz <= 1; oz++) {
          for (let ox = -1; ox <= 1; ox++) {
            sum += heightAtGrid(hf, ix + ox, iz + oz);
          }
        }
      }
      const avg = sum / 9;
      const k = Math.min(1, rate * weight);
      scratch[local] = current + (avg - current) * k;
    }
  }

  for (let iz = minZ; iz <= maxZ; iz++) {
    for (let ix = minX; ix <= maxX; ix++) {
      const i = iz * size + ix;
      const next = scratch[(iz - minZ) * w + (ix - minX)]!;
      if (next === heights[i]!) continue;
      history.record(i);
      heights[i] = next;
    }
  }

  return { minX, minZ, maxX, maxZ };
}
