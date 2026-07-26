// Undo/redo, recorded one stroke at a time.
//
// A stroke is "mouse down, drag around, mouse up" — not one frame. That is the
// unit people expect Ctrl+Z to remove, and it is why the brush reports every
// cell it touches here rather than the history snapshotting the field.
//
// Snapshotting the whole 262k-height array per stroke would cost a megabyte a
// go. Instead each cell's pre-stroke value is captured the first time that
// stroke touches it, so an entry costs only what was actually sculpted.

import type { GridRect, Heightfield } from "../terrain/heightfield";

interface Entry {
  readonly indices: Int32Array;
  readonly before: Float32Array;
  readonly after: Float32Array;
  readonly rect: GridRect;
}

export interface History {
  /** Start recording. Any in-progress stroke is discarded. */
  begin(): void;
  /** Capture a cell's pre-stroke height. Safe (and cheap) to call repeatedly. */
  record(index: number): void;
  /** Close the stroke and push it. Returns false if nothing was touched. */
  end(): boolean;
  undo(): GridRect | null;
  redo(): GridRect | null;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Forget everything — for New, and after loading a file. */
  clear(): void;
}

const MAX_ENTRIES = 60;

export function createHistory(hf: Heightfield): History {
  const { size, heights } = hf;

  // Reused across strokes so a stroke costs no allocations in its hot path.
  const touched = new Uint8Array(size * size);
  let touchedList: number[] = [];
  const beforeScratch = new Float32Array(size * size);
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

  function apply(entry: Entry, values: Float32Array): GridRect {
    for (let i = 0; i < entry.indices.length; i++) {
      heights[entry.indices[i]!] = values[i]!;
    }
    return entry.rect;
  }

  return {
    begin(): void {
      resetStroke();
      recording = true;
    },

    record(index: number): void {
      if (!recording || touched[index] === 1) return;
      touched[index] = 1;
      beforeScratch[index] = heights[index]!;
      touchedList.push(index);
    },

    end(): boolean {
      if (!recording) return false;
      recording = false;
      if (touchedList.length === 0) return false;

      const n = touchedList.length;
      const indices = new Int32Array(n);
      const before = new Float32Array(n);
      const after = new Float32Array(n);
      let changed = false;
      for (let i = 0; i < n; i++) {
        const idx = touchedList[i]!;
        indices[i] = idx;
        before[i] = beforeScratch[idx]!;
        after[i] = heights[idx]!;
        if (before[i] !== after[i]) changed = true;
      }
      resetStroke();

      // A click that landed entirely on the flat rim of the falloff moves
      // nothing; don't burn an undo slot on it.
      if (!changed) return false;

      past.push({ indices, before, after, rect: rectOf(indices) });
      if (past.length > MAX_ENTRIES) past.shift();
      future.length = 0;
      return true;
    },

    undo(): GridRect | null {
      const entry = past.pop();
      if (!entry) return null;
      future.push(entry);
      return apply(entry, entry.before);
    },

    redo(): GridRect | null {
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
