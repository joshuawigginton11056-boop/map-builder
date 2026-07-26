# Map Builder

A terrain sculpting tool. The owner is **non-technical** — explain things in
plain language and describe work in terms of what he'll see on screen, not
files or types.

## Why this exists

Toebeans' map lives as hand-tuned numbers in two files: segment lengths and
turn angles in radians, and an elevation profile as a list of control points.
There is no way to look at a mountain and change it — you change a number and
ski for three minutes to find out what happened. Twelve-plus hours went into
describing a map in words and getting something else back.

This tool replaces that loop with a brush. **Anything built here should stay
aimed at that**: the point is direct manipulation with instant feedback, not
a general-purpose 3D editor.

## The documents

Read in this order when picking up work:

| File | What it's for |
|---|---|
| [ROADMAP.md](ROADMAP.md) | What's done, what's next. **Start here.** |
| [DESIGN.md](DESIGN.md) | Why the tool is shaped this way, and the open questions. Read before changing anything that looks arbitrary. |
| [IDEAS.md](IDEAS.md) | Parking lot. New ideas go here, not into code. |
| [TOEBEANS.md](TOEBEANS.md) | Context on the game this feeds. Only needed for the export work — and for keeping scale and assets compatible before then. |
| [README.md](README.md) | How to run it and what the controls are. |

## Working agreements

- **One feature per session.** The roadmap in [ROADMAP.md](ROADMAP.md) is
  ordered; take the next item, not two.
- **Plan before code.** State the plan, wait for approval, then run.
- **For creative or design decisions, don't choose** — offer 2–4 options with
  tradeoffs. For purely technical ones, just choose.
- **Update ROADMAP.md at the end of every session.**
- **Feel beats features.** If a brush doesn't feel good, fixing that comes
  before adding another tool.

## Stack

TypeScript (`strict`, plus `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`), Three.js `^0.185.1`, Vite. Matched to Toebeans
deliberately so assets and exported terrain stay compatible.

- `npm run dev` — dev server on port 5400
- `npm run check` — typecheck; run before considering anything done

## Structure

```
src/
  terrain/heightfield.ts   The clay: a Float32Array of heights + the math to
                           read it (bilinear sampling, ray marching).
                           Knows nothing about rendering.
  terrain/terrainMesh.ts   The mesh that shows it, plus the clay material
                           (contours, slope shading, grid).
  sculpt/brush.ts          What moves the clay. Pure-ish: takes a heightfield
                           and a hit point, returns the rectangle it changed.
  sculpt/history.ts        Undo/redo, one stroke at a time.
  ui/panel.ts              The tool panel. Plain DOM, owns no state.
  ui/brushCursor.ts        The ring under the mouse, draped over the terrain.
  io/project.ts            .clay file format + browser autosave.
  main.ts                  Wiring only.
```

## Things worth knowing before changing this

- **The heightfield is the single source of truth.** The mesh mirrors it. Never
  read terrain shape back out of Three.js geometry — go to the heightfield.
- **Vertex `n` is height `n`.** The mesh is built by hand rather than from
  `PlaneGeometry` specifically so a brush stroke can re-upload just the rows it
  touched instead of all 262,144 vertices.
- **Raycasting marches the heightfield, not the mesh.** Three.js's mesh
  raycaster would walk half a million triangles on every mouse move.
- **The brush applies per frame, not per mouse event.** Event-driven sculpting
  piles up strength where the mouse moves slowly. `step(dt)` in `main.ts` takes
  its timestep as an argument so a stroke can be replayed deterministically.
- **`heightfield.ceiling` is a deliberate over-estimate.** It grows when you
  raise ground and never shrinks. It only bounds the raycast, and keeping it
  exact would mean scanning the whole field every frame.
- **Derivative-based shader lines need a flatness guard.** `fwidth` collapses
  to zero on flat ground, which makes a "line" cover everything. See
  `clayLine` — this caused a visible bug once already.

## Verifying changes

Screenshots through the in-app browser pane time out in this environment. Use
the connected Chrome browser pointed at `http://localhost:5400` instead.

Chrome throttles `requestAnimationFrame` to zero in a background tab, so
synthetic sculpt strokes will silently do nothing. Drive `window.mapBuilder.step(1/60)`
directly instead — the dev-only handle on `window` exists for exactly this, and
gives reproducible results regardless of how the tab is scheduled.
