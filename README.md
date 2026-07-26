# Map Builder

A clay sandbox for building game maps. You sculpt terrain with brushes — raise
mountains, dig lakes, smooth ridges, flatten shelves — instead of writing
numbers into a table and hoping.

Built to feed [Toebeans](https://github.com/joshuawigginton11056-boop/toebeans),
so it shares that project's stack (TypeScript, Three.js, Vite) and world scale.

## Running it

```bash
npm install
```

```bash
npm run dev
```

Then open <http://localhost:5400>.

## Controls

| Input | Does |
|---|---|
| **Left-drag** | Sculpt with the current tool |
| **Shift + left-drag** | Invert it (Raise becomes Lower) |
| **Right-drag** | Orbit the camera |
| **Middle-drag** | Pan |
| **Scroll** | Zoom |
| **1 2 3 4** | Raise · Lower · Smooth · Flatten |
| **[** and **]** | Shrink / grow the brush |
| **F** | Frame the whole map |
| **Ctrl+Z / Ctrl+Shift+Z** | Undo / redo |

The brush applies continuously while held, so *hold and drag* rather than
clicking — a click barely moves anything, by design.

### The tools

- **Raise / Lower** — push ground up or dig it down at a steady rate.
- **Smooth** — average out whatever is under the brush. Use it to turn a lumpy
  raise into a believable hillside.
- **Flatten** — level everything under the brush toward the height you first
  clicked. Pick the height by clicking it; there's no number to type.

**Size** is the brush radius in world units. **Strength** is how fast it works.
**Falloff** is how much of the brush is soft rim — at 0 the brush has a hard
edge and stamps a cylinder, at 100 it's soft all the way to the middle. Around
60 is a good default for terrain.

## Reading the terrain

Plain white snow under soft light is almost impossible to sculpt against, so the
surface adds three cues:

- **Contour lines** every 10 units of elevation.
- **Steep faces darken toward rock** — under ~30° stays snow, ~60° reads as
  bare rock. It's a preview of the slope-based blending the paint pass will do
  for real.
- **A world grid** every 64 units, for scale. Toggle it off in the panel.

## Saving

**Save** downloads a `.clay` file — a flat binary of the heightfield. **Load**
reads one back. The sculpt also **autosaves to the browser** a moment after
every stroke, so a refresh or a crash doesn't cost you the map.

## Scale

The field is **1024 × 1024 world units** on a **512 × 512** grid, so two units
per grid square. For reference, a full Toebeans ski run is about 640 units long
and drops about 280 units — the whole mountain fits with room around it.

## Where this is going

Sculpting is step one. See [ROADMAP.md](ROADMAP.md).
