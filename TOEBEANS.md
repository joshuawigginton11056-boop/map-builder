# Toebeans integration

Context for anyone working in this repo who needs to know about the game this
tool feeds. Nothing here is required for sessions 1–4 (clay, paint, foliage,
water) — it matters for **session 5, the export**, and for keeping asset and
scale choices compatible in the meantime.

> **Verify before relying on this.** Toebeans moves fast across several parallel
> worktrees. Everything below was read from the repo on **2026-07-26** and is a
> snapshot, not a live contract. Check the files named here before planning
> against them.

## Where it is

- Main checkout: `C:\Users\joshu\Toebeans` (stays on `master`, merge-target only)
- Repo: <https://github.com/joshuawigginton11056-boop/toebeans> (public)
- Parallel worktrees exist for lobby / slope-mechanics / slope-visuals /
  multiplayer / mountain-graphics / forest-graphics. **Read the repo's
  `PARALLEL.md` before touching code in any of them** — it defines file
  ownership and the merge protocol.
- Key docs there: `CLAUDE.md`, `DESIGN.md`, `ROADMAP.md`, `IDEAS.md`, and
  `SLOPE_BRANCHINGv3.md` (which wins over DESIGN.md for anything map-related).
- `slope-map.png` in the repo root is Josh's hand-drawn top-down map — the
  thing this whole tool exists to help realise.

## How the map is defined today

Three separate things, none of which is a terrain field.

### 1. The route graph — `shared/src/route.ts`

Pure data. Segments keyed by id:

```ts
interface Segment {
  id: string; length: number; next: string | null;
  chasms: readonly Chasm[]; checkpoints: readonly number[];
  trigger?: SegmentTrigger;
}
```

`length` is arc length in sim units. `TOTAL_ROUTE_LENGTH` is 640. The designed
map forks four ways (forest / lake / second mountain / cliff), but the currently
*played* path is a single non-branching list, `SINGLE_TRAIL`:
`summit → forest-road → lake → yeti → cave → cliff`. The fork graph is parked
but still tested.

### 2. Elevation — also `route.ts`

A `GRADE_PROFILE` of `[routeDistance, grade]` control points, linearly
interpolated and integrated into a height table. `routeHeightAt(d)` gives the
world Y at a route distance; `routeGradeAt(d)` gives local steepness, which the
sim reads to drive speed (steeper = faster).

**This is one of the two things that made the map unbuildable by description.**
Elevation is a curve along the run, keyed to distance — not a shape. Its
comments record three consecutive "the forest feels slow" → nudge-a-number
rounds that never landed.

### 3. The trail's shape — `client/src/slopePath.ts`

`SEGMENT_SHAPES` gives each segment a `turn` in **radians** (total heading
change across it) plus an entry origin and heading. These integrate into a
centreline; `segmentCenterline(id, s)` and `segmentToWorld(...)` map a
(segment, distance, lateral) triple to a world position.

**This is the other one.** "The trail should hook left around the lake" has to
become `turn: -0.24`, which nobody can picture.

## What the player actually skis on

`addBranchTerrain()` in `client/src/skiRender.ts` builds **one seamless corridor
ribbon swept along the trail** — not a terrain field:

- a flat playable **lane** at `|lateral| ≤ 12`, which is exactly the sim's ground
- **flanks** rising to snowbanks out to `±46`, height ~12 at the edge, with a few
  octaves of sine relief faded to zero at the lane edge
- sampled every 5 units along the trail, plus a 180-unit flat runout past the end
- on tight turns the inner flank columns are pinched to stop the section folding
  through itself

**This is the crux of the export problem.** The game's world is a ribbon about 92
units wide following a line. A sculpted heightfield is 1024 × 1024 units of open
terrain. They are not the same kind of object, and no export can pretend
otherwise — hence the three options in [DESIGN.md](DESIGN.md#open-questions).

### The grade seam (known, parked)

There are **two ground surfaces** at different heights on the branching map:

- the **graded corridor** above, which descends for real from summit (y ≈ 280)
  to the flag (y ≈ 0) — this is what you visibly ride
- a **dressed flat snowfield** at **y = 0** that only tracks the skier's `z` and
  ignores `y`, so it sits far below the run everywhere except the low runout

Consequence for anything placed on the slope: put it on the graded ground via
`segmentCenterline(...).y` + `segmentToWorld(...)`, **not** at y = 0. The decor
tree scatter does this via `trailGroundHeightAtZ(z)`.

If the export ever replaces the ground with a sculpted heightfield, this seam is
one of the things it would fix.

## Assets available

`Toebeans/assets/slope/` — 16 CC0 Quaternius models, palette-recoloured, served
at `/slope/<name>.glb`:

```
Bush_Snow_1–2   Rock_Snow_1–7   StylizedPine_1–5   TreeStump_Snow   WoodLog_Snow
```

These are the natural candidates for the **foliage brush** (session 3). Every
asset used needs a row in `assets/CREDITS.md` — carry that convention here.

**Gotcha:** the converted slope GLBs have **no UVs** (the OBJ→GLB tool dropped
them), so image texturing them needs either a re-export with UVs or a triplanar
shader.

## Art direction, as it stands

- Target mood is Omno — palette-family colours, stylised.
- The old "no textures" rule is **dead** as of 2026-07-22: surfaces get both
  stylised painted texture and procedural detail.
- Painted detail on **trees** was approved. Painted **snow** was rejected — Josh
  wants "realism snow": sparkle and relief within the two snow hexes' family.

For the **paint layer** work (session 2), that's the relevant steer: snow should
read as believable, not hand-painted.

## Scale compatibility

This tool's field is 1024 × 1024 units with 2 units per grid square, chosen so a
Toebeans run (~640 long, ~280 of drop) fits with room around it. **Keep these
units identical to the game's** — a scale conversion at the export boundary is
exactly the kind of invisible fudge factor this tool exists to avoid.
