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

## 2. Paint layers

Brush surface materials onto the terrain — snow, rock, grass — blended where
they meet, held as per-vertex layer weights. The slope-based shading already in
the clay material is a preview of this; this makes it something you control.

## 3. Foliage brush

Scatter trees and rocks from Toebeans' existing 24 slope models, with density
and scale jitter, plus an erase brush. Instanced so a forest doesn't cost a
frame.

## 4. Water

Set a level and fill a basin you've dug. The frozen lake stops being a flat
blue patch you place and becomes something you carve.

## 5. Export to Toebeans

The sculpted mountain becomes terrain the game actually loads.

**This is the step with a real open question**, worth settling before it starts:
Toebeans currently derives its ground height from a route-distance curve
(`routeHeightAt`), and the trail's shape from per-segment turn angles. A
sculpted heightfield is a different thing entirely. Either the game learns to
read a heightfield and the trail gets draped onto it, or the export has to
reduce a sculpt back down to those curves. The first is more honest and more
work; the second keeps the game unchanged but throws away most of what you
sculpted. Decide before building.

## Parked ideas

- Import Toebeans' current mountain to sculpt on, rather than always starting flat.
- Load `slope-map.png` as a backdrop image to trace the hand-drawn map against.
- Erosion / noise brushes for natural-looking detail.
- Adjustable field size and resolution.
