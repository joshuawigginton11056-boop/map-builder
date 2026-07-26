// Undo/redo, recorded one stroke at a time.
//
// A stroke is "mouse down, drag around, mouse up" — not one frame. That is the
// unit people expect Ctrl+Z to remove, and it is why the brushes report every
// cell they touch here rather than the history snapshotting the field.
//
// Snapshotting the whole field per stroke would cost a megabyte a go. Instead
// each cell's pre-stroke value is captured the first time that stroke touches
// it, so an entry costs only what was actually sculpted or painted.
//
// A stroke changes the shape or the surface, never both, so an entry knows
// which of the two it has to put back.

import type { GridRect, Heightfield } from "../terrain/heightfield";
import { LAYER_COUNT, type LayerField } from "../terrain/layerField";

export type StrokeTarget = "height" | "paint";

/** What an undo or redo put back, so the mesh knows which buffers to re-upload. */
export interface HistoryChange {
  readonly rect: GridRect;
  readonly target: StrokeTarget;
}

interface Entry {
  readonly target: StrokeTarget;
  readonly indices: Int32Array;
  /** One value per index for height strokes, `LAYER_COUNT` per index for paint. */
  readonly before: Float32Array | Uint8Array;
  readonly after: Float32Array | Uint8Array;
  readonly rect: GridRect;
}

export interface History {
  /** Start recording a stroke against one field. Any in-progress stroke is discarded. */
  begin(target: StrokeTarget): void;
  /** Capture a grid point's pre-stroke value. Safe (and cheap) to call repeatedly. */
  record(index: number): void;
  /** Close the stroke and push it. Returns false if nothing actually changed. */
  end(): boolean;
  undo(): HistoryChange | null;
  redo(): HistoryChange | null;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Forget everything — for New, and after loading a file. */
  clear(): void;
}

const MAX_ENTRIES = 60;

export function createHistory(hf: Heightfield, layers: LayerField): History {
  const { size, heights } = hf;
  const { weights } = layers;

  // Reused across strokes so a stroke costs no allocations in its hot path.
  const touched = new Uint8Array(size * size);
  let touchedList: number[] = [];
  const heightScratch = new Float32Array(size * size);
  const paintScratch = new Uint8Array(size * size * LAYER_COUNT);
  let target: StrokeTarget = "height";
  let recording = false;

  const past: Entry[] = [];
  const future: Entry[] = [];

  function resetStroke(): void {
    for (let i = 0; i < touchedList.length; i++) touched[touchedList[i]!] = 0;
    touchedList = [];
  }

  function rectOf(indices: Int32Array): GridRect {
    let minX = size;
    let minZ = size;
    let maxX = 0;
    let maxZ = 0;
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i]!;
      const ix = idx % size;
      const iz = (idx - ix) / size;
      if (ix < minX) minX = ix;
      if (ix > maxX) maxX = ix;
      if (iz < minZ) minZ = iz;
      if (iz > maxZ) maxZ = iz;
    }
    return { minX, minZ, maxX, maxZ };
  }

  function apply(entry: Entry, values: Float32Array | Uint8Array): HistoryChange {
    if (entry.target === "height") {
      for (let i = 0; i < entry.indices.length; i++) {
        heights[entry.indices[i]!] = values[i]!;
      }
    } else {
      for (let i = 0; i < entry.indices.length; i++) {
        const dst = entry.indices[i]! * LAYER_COUNT;
        const src = i * LAYER_COUNT;
        for (let c = 0; c < LAYER_COUNT; c++) weights[dst + c] = values[src + c]!;
      }
    }
    return { rect: entry.rect, target: entry.target };
  }

  return {
    begin(next: StrokeTarget): void {
      resetStroke();
      target = next;
      recording = true;
    },

    record(index: number): void {
      if (!recording || touched[index] === 1) return;
      touched[index] = 1;
      if (target === "height") {
        heightScratch[index] = heights[index]!;
      } else {
        const at = index * LAYER_COUNT;
        for (let c = 0; c < LAYER_COUNT; c++) paintScratch[at + c] = weights[at + c]!;
      }
      touchedList.push(index);
    },

    end(): boolean {
      if (!recording) return false;
      recording = false;
      if (touchedList.length === 0) return false;

      const n = touchedList.length;
      const indices = new Int32Array(n);
      const stride = target === "height" ? 1 : LAYER_COUNT;
      const before =
        target === "height" ? new Float32Array(n) : new Uint8Array(n * LAYER_COUNT);
      const after =
        target === "height" ? new Float32Array(n) : new Uint8Array(n * LAYER_COUNT);
      const source: Float32Array | Uint8Array =
        target === "height" ? heights : weights;
      const scratch: Float32Array | Uint8Array =
        target === "height" ? heightScratch : paintScratch;

      let changed = false;
      for (let i = 0; i < n; i++) {
        const idx = touchedList[i]!;
        indices[i] = idx;
        for (let c = 0; c < stride; c++) {
          const from = scratch[idx * stride + c]!;
          const to = source[idx * stride + c]!;
          before[i * stride + c] = from;
          after[i * stride + c] = to;
          if (from !== to) changed = true;
        }
      }
      resetStroke();

      // A click that landed entirely on the flat rim of the falloff changes
      // nothing; don't burn an undo slot on it.
      if (!changed) return false;

      past.push({ target, indices, before, after, rect: rectOf(indices) });
      if (past.length > MAX_ENTRIES) past.shift();
      future.length = 0;
      return true;
    },

    undo(): HistoryChange | null {
      const entry = past.pop();
      if (!entry) return null;
      future.push(entry);
      return apply(entry, entry.before);
    },

    redo(): HistoryChange | null {
      const entry = future.pop();
      if (!entry) return null;
      past.push(entry);
      return apply(entry, entry.after);
    },

    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,

    clear(): void {
      resetStroke();
      recording = false;
      past.length = 0;
      future.length = 0;
    },
  };
}
