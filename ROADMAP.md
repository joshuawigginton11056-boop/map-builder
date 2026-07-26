# Roadmap

The order matters. Sculpting had to feel right before anything got layered on
top of it, and the same logic applies down the list — each step is only worth
building once the one before it is something you actually want to use.

## 1. Clay — ✅ landed 2026-07-26

A flat field you push around with a brush.

- Raise, Lower, Smooth, Flatten, with size / strength / falloff.
- Brush ring draped over the terrain so you can see what a stroke will hit.
- Orbit / pan / zoom camera, "Frame all".
- Undo and redo, one stroke at a time.
- Save and load `.clay` files, plus autosave so a refresh costs nothing.
- Terrain readability: elevation contours, slope-based rock shading, world grid.

**Verified:** raise / lower / smooth / flatten all move ground as intended;
Shift inverts; undo returns the field to bit-exact flat and redo restores it;
save → autosave → reload round-trips the heightfield bit-exactly.

**Performance:** a stroke frame costs ~0.9 ms at the default brush size. The
worst case is Smooth at maximum radius (320 units, a third of the map) at
~13.7 ms — roughly 73 fps. Shadow re-rendering during a stroke costs nothing
measurable; the cost is all CPU in the brush loop.

**Known limits, not yet worth fixing:**
- The grid resolution is fixed at 512 × 512. Loading a `.clay` saved at a
  different resolution is refused rather than resampled.
- No brush for noise/erosion, no stamping, no symmetry.

## 2. Paint layers — ✅ landed 2026-07-26

Brush surface materials onto the terrain, blended where they meet.

- Paint as a fifth tool, with four materials: Snow, Rock, Forest floor, Ice.
- Shift erases, revealing whatever is under the stroke rather than wiping to
  bare ground.
- Ice is slick as well as blue — it takes a specular highlight the other
  materials don't.
- Paint strokes undo and redo one at a time, interleaved with sculpt strokes.
- Saved, loaded and autosaved alongside the shape.

The automatic slope-driven rock stays as the starting point and paint takes over
where you put it — including painting Snow back onto a face too steep to have
stayed white on its own.

**Verified:** all four materials paint and blend; overlapping strokes never push
a point past full coverage (checked across ~9,000 painted cells after five
overlapping strokes); erase reveals the layer underneath; a paint stroke undoes
without disturbing the shape and a sculpt stroke undoes without disturbing the
paint; a `.clay` file and the autosave both round-trip heights and weights
bit-exactly; a version-1 `.clay` from before paint still opens, unpainted.

**Performance:** a paint frame costs 0.04 ms at the default brush size. The
worst case — maximum radius over ground that is already painted, so the other
layers have to give way — is 1.74 ms, against Smooth's 13.7 ms. Pushing the
changed rows to the GPU and redrawing costs 0.79 ms. Painting leaves the shadow
map alone, since the shape hasn't moved.

**Known limits, not yet worth fixing:**
- Four materials is the ceiling for this storage shape. A fifth means a second
  packed attribute, not a redesign.
- Paint sits at the sculpt grid's resolution — 2 world units — so a paint edge
  can't be crisper than the terrain is detailed.
- No way to paint by rule (everything above 200 units, everything steeper than
  40°), only by hand.

## 3. Foliage brush

Scatter trees and rocks from Toebeans' existing 24 slope models, with density
and scale jitter, plus an erase brush. Instanced so a forest doesn't cost a
frame.

## 4. Water

Set a level and fill a basin you've dug. The frozen lake stops being a flat
blue patch you place and becomes something you carve.

## 5. Export to Toebeans

The sculpted mountain becomes terrain the game actually loads.

**Blocked on a director's call, not on code.** Toebeans' ground is a corridor
ribbon swept along the trail, not a terrain field — so there is no direct
handoff, and the three ways out have very different costs. The options are laid
out in [DESIGN.md](DESIGN.md#open-questions); the specifics of what the game
does today are in [TOEBEANS.md](TOEBEANS.md). **Settle this before the session
starts, not during it.**

---

Parked ideas live in [IDEAS.md](IDEAS.md).
