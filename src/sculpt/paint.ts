// The paint brush: what puts material on the clay.
//
// Same shape as the sculpt brush — same radius, same falloff curve, applied per
// frame rather than per mouse event — so a paint stroke feels like a sculpt
// stroke. Only what it writes differs.

import type { GridRect, Heightfield } from "../terrain/heightfield";
import { gridXOf, gridZOf, worldXOf, worldZOf } from "../terrain/heightfield";
import { LAYER_COUNT, type LayerField } from "../terrain/layerField";
import type { BrushSettings } from "./brush";
import { brushWeight } from "./brush";
import type { History } from "./history";

/**
 * Apply one frame of painting centred on a world position.
 *
 * `erase` reverses it: the chosen layer decays toward zero, revealing whatever
 * is under it — other layers first, then the automatic slope shading.
 *
 * Returns the rectangle of grid cells it changed, or null if the brush fell
 * entirely outside the field.
 */
export function applyPaint(
  hf: Heightfield,
  layers: LayerField,
  history: History,
  layer: number,
  hit: { readonly x: number; readonly z: number },
  settings: BrushSettings,
  dt: number,
  erase: boolean,
): GridRect | null {
  const { size, spacing } = hf;
  const { weights } = layers;
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
  // Paint wants to arrive faster than clay moves — you are choosing a material,
  // not easing a shape into place. Clamped at 1 so a long frame reaches the
  // target without overshooting past it.
  const rate = (strength / 50) * 4 * dt;

  for (let iz = minZ; iz <= maxZ; iz++) {
    const dz = worldZOf(hf, iz) - hit.z;
    for (let ix = minX; ix <= maxX; ix++) {
      const dx = worldXOf(hf, ix) - hit.x;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r2) continue;
      const w = brushWeight(Math.sqrt(d2), radius, falloff);
      if (w <= 0) continue;

      const k = Math.min(1, rate * w);
      const base = (iz * size + ix) * LAYER_COUNT;
      const current = weights[base + layer]!;

      if (erase) {
        // Decay toward zero. Nothing else has to move: the total only ever
        // falls, so the "at most 255" invariant holds for free.
        const next = Math.round(current * (1 - k));
        if (next === current) continue;
        history.record(iz * size + ix);
        weights[base + layer] = next;
        continue;
      }

      const next = Math.round(current + (255 - current) * k);
      if (next === current) continue;

      // Everything else keeps its share of what's left. Only when the total
      // would pass 255 do the other layers give ground, and then in proportion
      // to how much of the surface they held — so painting rock into a forest
      // edge thins the forest rather than punching a hole in it.
      let others = 0;
      for (let c = 0; c < LAYER_COUNT; c++) {
        if (c !== layer) others += weights[base + c]!;
      }

      history.record(iz * size + ix);
      weights[base + layer] = next;

      const excess = next + others - 255;
      if (excess <= 0 || others <= 0) continue;

      const keep = (others - excess) / others;
      let total = next;
      let biggest = layer;
      let biggestValue = next;
      for (let c = 0; c < LAYER_COUNT; c++) {
        if (c === layer) continue;
        const scaled = Math.round(weights[base + c]! * keep);
        weights[base + c] = scaled;
        total += scaled;
        if (scaled > biggestValue) {
          biggestValue = scaled;
          biggest = c;
        }
      }
      // Rounding four values independently can land a point or two either side
      // of the budget. Push the difference into whichever layer is dominant
      // here, where 1/255 of a colour is invisible, rather than letting the
      // total drift over 255 and bleach the surface.
      if (total > 255) weights[base + biggest] = biggestValue - (total - 255);
    }
  }

  return { minX, minZ, maxX, maxZ };
}
