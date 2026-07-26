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
//
// Autosave writes the same bytes into localStorage so a refresh (or a crash)
// never costs you the mountain you were halfway through.

import type { Heightfield } from "../terrain/heightfield";

const MAGIC = 0x43_4c_41_59; // "CLAY"
const VERSION = 1;
const HEADER_BYTES = 16;
const AUTOSAVE_KEY = "map-builder:autosave:v1";

export function encodeProject(hf: Heightfield): ArrayBuffer {
  const buffer = new ArrayBuffer(HEADER_BYTES + hf.heights.byteLength);
  const view = new DataView(buffer);
  view.setUint32(0, MAGIC, false);
  view.setUint32(4, VERSION, true);
  view.setUint32(8, hf.size, true);
  view.setFloat32(12, hf.extent, true);
  new Float32Array(buffer, HEADER_BYTES).set(hf.heights);
  return buffer;
}

export interface DecodedProject {
  readonly size: number;
  readonly extent: number;
  readonly heights: Float32Array;
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
  if (version !== VERSION) {
    throw new Error(`That sculpt was saved by a newer version (v${version}).`);
  }
  const size = view.getUint32(8, true);
  const extent = view.getFloat32(12, true);
  const expected = HEADER_BYTES + size * size * 4;
  if (buffer.byteLength !== expected) {
    throw new Error("That sculpt file is damaged — its size doesn't match its header.");
  }
  return { size, extent, heights: new Float32Array(buffer.slice(HEADER_BYTES)) };
}

export function downloadProject(hf: Heightfield, filename: string): void {
  const blob = new Blob([encodeProject(hf)], { type: "application/octet-stream" });
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
// localStorage only holds strings, so the buffer goes through base64. Chunked
// because String.fromCharCode.apply on a 1 MB array blows the argument limit.

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

/** Best-effort — a full quota shouldn't interrupt sculpting. */
export function autosave(hf: Heightfield): boolean {
  try {
    localStorage.setItem(AUTOSAVE_KEY, toBase64(encodeProject(hf)));
    return true;
  } catch {
    return false;
  }
}

export function loadAutosave(): DecodedProject | null {
  try {
    const text = localStorage.getItem(AUTOSAVE_KEY);
    if (!text) return null;
    return decodeProject(fromBase64(text));
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
