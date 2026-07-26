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

### Four paint layers, one byte each, packed into one attribute

Weights are per grid point, four bytes to a point, interleaved in the same order
the shader reads them. That is 1 MB for the whole set; a single layer at full
float precision would have cost the same. It also means the paint field *is* the
GPU attribute — no second copy to keep in step — and a paint stroke re-uploads
only the rows it touched, reusing the machinery heights already had.

The cost is a hard ceiling of four materials. A fifth would be a second packed
attribute, which is additive rather than a redesign, so the ceiling is worth
taking. Quantising to 1/255 is invisible: this is a blend weight, not a colour.

Paint sits at the sculpt grid's resolution, so a painted edge can never be
crisper than 2 world units. For broad zones on a ski mountain — a treeline, a
frozen basin, an exposed face — that is not the limiting factor. A separate,
higher-resolution paint texture would decouple the two, at the cost of a second
coordinate system and its own upload path. Revisit only if a real edge looks
blocky, not on principle.

### The weights sum to *at most* full, and the slack is the automatic shading

The obvious scheme is weights that always sum to one, with unpainted ground
sitting at 100% of a base layer. It has a trap. The material already darkens
steep ground toward rock on its own, and the whole point of a Snow layer is to
say "keep this face white anyway" — but under sum-to-one, unpainted ground is
*already* full snow, so painting snow on a cliff would change nothing at all. A
tool where a stroke visibly does nothing is worse than one without the stroke.

So the four weights sum to at most full and the shortfall is how much automatic
shading still shows. Unpainted ground is four zeroes and looks exactly as it did
before paint existed; any stroke, Snow included, takes the surface over. Erasing
falls out for free — a layer decays toward zero and the total only ever drops,
so nothing needs renormalising and what was underneath comes back.

### Undo is per stroke, and sparse

A stroke — press, drag, release — is the unit people expect Ctrl+Z to remove.
Snapshotting the field per stroke would cost a megabyte each, so each cell's
pre-stroke height is captured the first time that stroke touches it. An entry
costs only what was actually sculpted.

### A flat binary file, not JSON

262,144 heights as JSON text is a ~6 MB string with a visible parse pause. The
same data raw is 1 MB and loads instantly. Autosave puts those same bytes in
browser storage via base64.

Paint doubled the payload to 2 MB, and base64 inflates that to 2.8 million
characters — past what a browser will hold in localStorage, since the quota is
counted in bytes and the string is UTF-16. So the autosave is deflated first.
A fully sculpted and fully painted field lands at about half the budget; a
typical one is a small fraction of it. The `.clay` file stays uncompressed —
it has no quota to respect, and a format you can read with a DataView is worth
more than a smaller one.

The one consequence: reading the autosave is now asynchronous, so it lands a
frame or two after the first render rather than before it. If a stroke somehow
got in first, the restore stands down instead of overwriting it.

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

### 2. How paint layers are stored — **settled 2026-07-26**

Four layers, one byte of weight each, packed into a single per-vertex attribute,
summing to at most full with the automatic slope shading showing through the
slack. The reasoning is above under *Decisions*.

### 3. Fixed field size

The grid and extent are constants. Loading a `.clay` saved at a different
resolution is refused rather than resampled. Fine while there is one map; needs
resampling on load before that stops being true.
