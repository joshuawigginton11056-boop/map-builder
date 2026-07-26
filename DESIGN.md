# Design

Why this tool is shaped the way it is. Read this before changing something that
looks arbitrary — most of the odd-looking choices are load-bearing, and a few
were paid for with a bug.

## What this is

A **clay sandbox**. You sculpt a landscape with brushes and see the result
immediately.

## What this is not

- **Not a route editor.** It does not know about trails, forks, checkpoints or
  timing. Those live in the game.
- **Not a general 3D editor.** No meshes, no objects, no gizmos. The world is a
  heightfield, and things that can't be expressed as one (caves, overhangs,
  tunnels) are out of scope by construction.
- **Not a renderer.** It shows terrain clearly enough to sculpt against. Making
  it look like the finished game is the game's job.

## The problem it exists to solve

Toebeans' map is hand-tuned numbers in two files — per-segment turn angles in
radians, and elevation as a list of `[distance, steepness]` control points.
There is no way to look at the mountain and change it. You change a number and
ski for three minutes to see what happened.

Twelve-plus hours went into describing a map in words and getting something else
back. The failure wasn't in the descriptions; it was that nobody could see the
thing being described until long after it was built.

**So the measure of every feature here is: does it shorten the loop between
"I want that" and "I can see whether I got it".** A feature that adds capability
but lengthens that loop is a bad trade.

## Principles

1. **Feel beats features.** A brush that fights you poisons everything built on
   top of it. Fix feel first.
2. **Direct manipulation.** If a value can be set by clicking the thing, it
   should be — Flatten takes its target height from where you clicked rather
   than from a number field, for exactly this reason.
3. **No surprises on reload.** Autosave after every stroke. Losing work to a
   refresh would make the tool something you're wary of.
4. **The heightfield is the truth.** Everything else — the mesh, the cursor, the
   file — mirrors it. Never read terrain shape back out of Three.js geometry.

## Decisions, and why

### A heightfield, not a sculptable mesh

A grid of heights can't do caves or overhangs. It buys, in exchange: trivially
cheap editing, an obvious file format, guaranteed non-self-intersecting ground,
and terrain that any game can sample with a single function. For a ski mountain
that trade is overwhelmingly correct. If overhangs are ever wanted, they should
be separate placed geometry, not a change to this model.

### 512 × 512 grid over 1024 world units

Two world units per grid square. Toebeans' whole run is ~640 units long and
drops ~280, so the mountain fits with room around it.

The tradeoff is real: the finest detail expressible is ~2 units, so the smallest
brush (4 units) spans about two cells. Going to 1024² would quadruple both
memory and the cost of a stroke at large radii, for detail that a ski slope
almost certainly doesn't need. Revisit only if sculpting actually feels
resolution-limited — not on principle.

### The brush applies per frame, not per mouse event

Event-driven sculpting piles up strength wherever the mouse moved slowly and
skips where it moved fast, so the same gesture gives a different mountain
depending on the mouse and the frame rate. Rate × frame time is steady.

The visible consequence, which is intended: **a click barely does anything.**
You hold and drag.

`step(dt)` in `main.ts` takes its timestep as an argument rather than reading a
clock, so a stroke can be replayed identically. That's what makes sculpting
behaviour reproducible enough to debug.

### The falloff curve has a flat core

Full strength across an inner disc, with only the rim falling away — the same
shape Unreal's landscape brushes use. A pure bell curve (peaking at a single
point) makes flat-topped plateaus and even ridges very hard to build, because
the centre always outruns the edges.

The rim uses smootherstep, flat at both ends, so overlapping strokes blend
without leaving a visible seam ring.

### Picking marches the heightfield instead of raycasting the mesh

Three.js's mesh raycaster would walk half a million triangles, on every mouse
move. Marching the height function analytically is a few hundred cheap samples
and stays exact as the grid grows.

`heightfield.ceiling` bounds that march. It is a deliberate **over**-estimate: it
grows when you raise ground and never shrinks when you lower it. Keeping it
exact would mean scanning a quarter-million heights every frame, and being too
high only costs a few extra ray steps.

### The surface shows contours, slope shading and a grid

White snow under soft light gives almost no gradient — a ridge and a bowl look
identical, and you cannot sculpt what you cannot see. So the material adds
elevation contour lines every 10 units, darkens steep faces toward rock, and
draws a world grid every 64 units for scale.

The slope shading doubles as a preview of what real paint layers will do.

**One trap, already paid for:** derivative-based line drawing (`fwidth`)
collapses to zero on a surface that is flat in screen space, which makes the
"line" widen to cover everything. Unsculpted ground is exactly that case, so the
whole flat field rendered as one dark band — and anywhere a brush skirt had
lifted the ground a hair off zero showed as a hard-edged bright arc that looked
like terrain that wasn't there. Any new derivative-based effect needs the same
flatness guard `clayLine` has.

### Undo is per stroke, and sparse

A stroke — press, drag, release — is the unit people expect Ctrl+Z to remove.
Snapshotting the field per stroke would cost a megabyte each, so each cell's
pre-stroke height is captured the first time that stroke touches it. An entry
costs only what was actually sculpted.

### A flat binary file, not JSON

262,144 heights as JSON text is a ~6 MB string with a visible parse pause. The
same data raw is 1 MB and loads instantly. Autosave puts those same bytes in
browser storage via base64.

### Plain DOM for the UI

A dozen controls. A framework would cost more to carry than it saves. The panel
owns no state — it renders what it's told — so the keyboard shortcuts and the
panel can never disagree about which tool is active.

## Open questions

### 1. How a sculpt becomes Toebeans terrain — **the big one**

Unresolved, and worth settling before session 5 rather than during it. See
[TOEBEANS.md](TOEBEANS.md) for the specifics of what the game does today; the
short version is that the game's ground is a **corridor ribbon swept along the
trail**, not a terrain field, so there is no direct handoff. Three routes, none
free:

- **Game learns to read a heightfield.** Most honest, keeps everything you
  sculpt. Largest change on the Toebeans side, and it touches the sim.
- **Export reduces the sculpt to the curves Toebeans already uses.** No game
  change, but throws away everything except elevation along the trail — which is
  most of the point of sculpting.
- **Sculpt only the surroundings; the corridor stays generated.** A middle path:
  the trail stays exactly as it is and the sculpt provides the world around it.
  Smallest change, but the trail's own shape stays uneditable — and the trail's
  shape was part of the original complaint.

This is a director's call, not a technical one.

### 2. How paint layers are stored

Per-vertex weights per layer is simple and blends well, but costs one float per
layer per vertex (1 MB per layer at this grid size) and caps how many layers are
practical. Alternatives — a hard index plus blend, or a packed weight texture —
trade flexibility for size. Decide when session 2 starts, not before.

### 3. Fixed field size

The grid and extent are constants. Loading a `.clay` saved at a different
resolution is refused rather than resampled. Fine while there is one map; needs
resampling on load before that stops being true.
