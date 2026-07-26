// Saving and loading a sculpt.
//
// A flat binary file, not JSON: 262,144 heights as JSON text is a ~6 MB string
// that takes a visible pause to parse. The same data raw is 1 MB and loads
// instantly.
//
//   magic "CLAY"  4 bytes
//   version       uint32
//   size          uint32   grid vertices per side
//   extent        float32  world units per side
//   heights       float32 × size²
//   weights       uint8   × size² × 4      (version 2 and up)
//
// Version 1 files predate paint and stop after the heights. They still load —
// they simply come in with nothing painted, which is exactly what they were.
//
// Autosave writes the same bytes into localStorage so a refresh (or a crash)
// never costs you the mountain you were halfway through.

import type { Heightfield } from "../terrain/heightfield";
import { LAYER_COUNT, type LayerField } from "../terrain/layerField";

const MAGIC = 0x43_4c_41_59; // "CLAY"
const VERSION = 2;
const HEADER_BYTES = 16;
// The string is a storage slot, not a file version — `decodeProject` reads
// every version we have ever written, so keeping the key stable means an
// autosave made by the previous build survives this one.
const AUTOSAVE_KEY = "map-builder:autosave:v1";
const COMPRESSED_PREFIX = "z1:";

export function encodeProject(hf: Heightfield, layers: LayerField): ArrayBuffer {
  const buffer = new ArrayBuffer(
    HEADER_BYTES + hf.heights.byteLength + layers.weights.byteLength,
  );
  const view = new DataView(buffer);
  view.setUint32(0, MAGIC, false);
  view.setUint32(4, VERSION, true);
  view.setUint32(8, hf.size, true);
  view.setFloat32(12, hf.extent, true);
  new Float32Array(buffer, HEADER_BYTES, hf.heights.length).set(hf.heights);
  new Uint8Array(buffer, HEADER_BYTES + hf.heights.byteLength).set(layers.weights);
  return buffer;
}

export interface DecodedProject {
  readonly size: number;
  readonly extent: number;
  readonly heights: Float32Array;
  readonly weights: Uint8Array;
}

/** Throws with a human-readable message if the bytes aren't a usable sculpt. */
export function decodeProject(buffer: ArrayBuffer): DecodedProject {
  if (buffer.byteLength < HEADER_BYTES) {
    throw new Error("That file is too small to be a sculpt.");
  }
  const view = new DataView(buffer);
  if (view.getUint32(0, false) !== MAGIC) {
    throw new Error("That doesn't look like a .clay file.");
  }
  const version = view.getUint32(4, true);
  if (version > VERSION) {
    throw new Error(`That sculpt was saved by a newer version (v${version}).`);
  }
  const size = view.getUint32(8, true);
  const extent = view.getFloat32(12, true);
  const points = size * size;
  const heightBytes = points * 4;
  const weightBytes = version >= 2 ? points * LAYER_COUNT : 0;
  if (buffer.byteLength !== HEADER_BYTES + heightBytes + weightBytes) {
    throw new Error("That sculpt file is damaged — its size doesn't match its header.");
  }

  const heights = new Float32Array(buffer.slice(HEADER_BYTES, HEADER_BYTES + heightBytes));
  const weights =
    version >= 2
      ? new Uint8Array(buffer.slice(HEADER_BYTES + heightBytes))
      : new Uint8Array(points * LAYER_COUNT);
  return { size, extent, heights, weights };
}

export function downloadProject(
  hf: Heightfield,
  layers: LayerField,
  filename: string,
): void {
  const blob = new Blob([encodeProject(hf, layers)], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".clay") ? filename : `${filename}.clay`;
  a.click();
  URL.revokeObjectURL(url);
}

export function readProjectFile(file: File): Promise<DecodedProject> {
  return file.arrayBuffer().then(decodeProject);
}

// ── Autosave ────────────────────────────────────────────────────────────────
// localStorage only holds strings, so the buffer goes through base64 — and
// browsers count those characters against a quota of a few megabytes. Paint
// doubled the payload to 2 MB, which base64 inflates to 2.8 million characters:
// over the line on Chrome. So the bytes are deflated first. Heightfields
// compress moderately and paint weights compress enormously (most of the field
// is one value), which puts a real sculpt back around a quarter of the budget.

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(text: string): ArrayBuffer {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function deflate(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([buffer]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Response(stream).arrayBuffer();
}

async function inflate(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).arrayBuffer();
}

/** Best-effort — a full quota shouldn't interrupt sculpting. */
export async function autosave(hf: Heightfield, layers: LayerField): Promise<boolean> {
  try {
    const raw = encodeProject(hf, layers);
    let text: string;
    if (typeof CompressionStream === "function") {
      text = COMPRESSED_PREFIX + toBase64(await deflate(raw));
    } else {
      text = toBase64(raw);
    }
    localStorage.setItem(AUTOSAVE_KEY, text);
    return true;
  } catch {
    return false;
  }
}

export async function loadAutosave(): Promise<DecodedProject | null> {
  try {
    const text = localStorage.getItem(AUTOSAVE_KEY);
    if (!text) return null;
    if (!text.startsWith(COMPRESSED_PREFIX)) {
      // An autosave from before compression, or from a browser without it.
      return decodeProject(fromBase64(text));
    }
    const packed = fromBase64(text.slice(COMPRESSED_PREFIX.length));
    return decodeProject(await inflate(packed));
  } catch {
    return null;
  }
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    // Nothing to do — an unwritable store just means no autosave.
  }
}
