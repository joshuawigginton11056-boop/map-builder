# Ideas

Parked, not promised. New ideas land here instead of in code — if a tangent
comes up mid-session, write it down and carry on.

Ordered roughly by how much they'd improve the tool per hour spent. Nothing here
is scheduled; the schedule is [ROADMAP.md](ROADMAP.md).

## Likely worth doing soon

- **Height readout under the cursor.** A live "y = 143" near the brush ring.
  Cheap, and it's the difference between sculpting by eye and sculpting to a
  spec — you can't hit "the summit should be 280 units up" without it.
- **Ramp / incline tool.** Drag from A to B and get a constant-grade slope
  between them. This is the one tool that maps directly onto what a ski run
  actually needs, and it's what `GRADE_PROFILE` was clumsily trying to express.
- **Top-down orthographic view.** A key that snaps the camera to straight down,
  so the sculpt can be compared against `slope-map.png` directly.
- **Trace a backdrop image.** Load Josh's hand-drawn map under the terrain as a
  ground-plane image to sculpt against. Pairs with the above.
- **Noise / erosion brush.** Sine-octave roughness and a simple hydraulic pass.
  Smooth makes things *too* clean, and hand-sculpted terrain reads artificial
  without some grit.
- **WASD fly camera while right-dragging.** Unreal-style navigation. Orbiting
  around a fixed target gets awkward once the map is big.

## Maybe

- **Import Toebeans' current mountain** to sculpt on, rather than always
  starting flat.
- **Adjustable field size and resolution**, with resampling on load so old
  `.clay` files survive a resolution change instead of being refused.
- **Stamps.** Save a sculpted shape and stamp it elsewhere — a reusable peak, a
  standard bowl.
- **Mirror / symmetry** across an axis while sculpting.
- **Camera bookmarks.** Number keys to jump to saved viewpoints for comparing
  before/after from a fixed angle.
- **Separate hardness from falloff.** Currently one slider does both the flat
  core and the rim curve.
- **Undo memory cap.** History is capped at 60 strokes by count, not by bytes. A
  long session of maximum-radius strokes could hold a lot of memory. Not
  observed as a problem yet.
- **Sun angle control.** Relief reads very differently under a different light
  direction; a slider would help judge shapes that hide in the current lighting.

## Probably not, but recorded

- **Multiple maps / project management.** One map at a time is fine so far.
- **Undo of camera moves.** Almost never what people want.
- **Live link to a running Toebeans dev server** so sculpting updates the game
  in real time. Fun, and a large amount of plumbing for something the export
  step mostly covers.

## Rejected, with reasons

- **Making this a general 3D editor** (placing meshes, gizmos, object
  hierarchies). Out of scope by construction — see [DESIGN.md](DESIGN.md). The
  world is a heightfield; things that can't be expressed as one belong in the
  game, not here.
- **Sculpting caves, tunnels and overhangs.** Same reason. The cave in the
  Toebeans map is placed geometry, not terrain.
