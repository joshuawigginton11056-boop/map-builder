// Surface materials, painted per grid point.
//
// Four layers, one byte of weight each, interleaved so that grid point n owns
// bytes 4n..4n+3 — the same "vertex n is height n" indexing the heightfield
// uses, which is what lets a paint stroke re-upload only the rows it touched.
// Four bytes per point is 1 MB for the whole set; one full-precision layer
// would have cost that much on its own.
//
// The weights sum to *at most* 255, not exactly 255, and that slack is
// load-bearing. Whatever is left over is the automatic slope shading — snow
// that darkens toward rock as the ground steepens. So unpainted ground is all
// four weights at zero and looks exactly as it did before paint existed, and
// painting Snow onto a cliff genuinely clears the auto-rock rather than being
// a no-op against a channel that was already full.

export const LAYER_COUNT = 4;

export interface LayerSpec {
  readonly id: LayerId;
  readonly label: string;
  /** Swatch colour for the panel — matches what the shader draws. */
  readonly swatch: string;
  readonly hint: string;
}

export type LayerId = "snow" | "rock" | "forest" | "ice";

/** Order is the byte order in `weights`, and the shader's channel order. */
export const LAYERS: readonly LayerSpec[] = [
  { id: "snow", label: "Snow", swatch: "#eef2f8", hint: "Snow that stays snow however steep it gets" },
  { id: "rock", label: "Rock", swatch: "#71737d", hint: "Bare rock" },
  { id: "forest", label: "Forest floor", swatch: "#44523a", hint: "Wooded ground — where trees will go" },
  { id: "ice", label: "Ice", swatch: "#9cc4dd", hint: "Slick blue ice, for the lake and the hard pitches" },
];

export interface LayerField {
  /** Vertices per side. Always matches the heightfield's. */
  readonly size: number;
  /** `size * size * LAYER_COUNT` weights, 0–255, row-major by z. */
  readonly weights: Uint8Array;
}

export function createLayerField(size: number): LayerField {
  return { size, weights: new Uint8Array(size * size * LAYER_COUNT) };
}

/** Index of the first weight byte for grid point `(ix, iz)`. */
export function layerOffset(size: number, ix: number, iz: number): number {
  return (iz * size + ix) * LAYER_COUNT;
}

export function layerIndexOf(id: LayerId): number {
  const index = LAYERS.findIndex((layer) => layer.id === id);
  return index < 0 ? 0 : index;
}
