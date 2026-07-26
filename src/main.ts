// Map Builder — the clay sandbox.
//
// Wires the pieces together: a heightfield, a mesh that shows it, a brush that
// moves it, and a camera you can fly around it. Everything with real logic in
// it lives in its own module; this file is the plumbing.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import "./style.css";
import {
  createHeightfield,
  heightAtWorld,
  raycastHeightfield,
  recomputeCeiling,
  type RayHit,
} from "./terrain/heightfield";
import { createTerrainMesh } from "./terrain/terrainMesh";
import { applyBrush, DEFAULT_BRUSH, MAX_RADIUS, MIN_RADIUS, type BrushSettings, type ToolId } from "./sculpt/brush";
import { createHistory } from "./sculpt/history";
import { createBrushCursor } from "./ui/brushCursor";
import { createPanel } from "./ui/panel";
import { autosave, clearAutosave, downloadProject, loadAutosave, readProjectFile } from "./io/project";

// 512 vertices across 1024 world units — two units per grid square. Toebeans'
// whole run is ~640 units long and ~280 tall, so this is the full mountain plus
// room to spare, at a resolution fine enough that a 4-unit brush still has
// something to bite into.
const GRID_SIZE = 512;
const WORLD_EXTENT = 1024;

// Far enough back that "Frame all" actually frames all of a 1024-unit field,
// and high enough to read relief rather than staring along the ground.
const CAMERA_HOME = new THREE.Vector3(0, 620, 880);

// ── Scene ───────────────────────────────────────────────────────────────────

const app = document.querySelector<HTMLDivElement>("#app")!;
const ui = document.querySelector<HTMLDivElement>("#ui")!;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// The terrain only changes when you sculpt, so there is no reason to re-render
// the shadow map sixty times a second. We flip `needsUpdate` on ourselves.
renderer.shadowMap.autoUpdate = false;
app.insertBefore(renderer.domElement, ui);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141a24);
scene.fog = new THREE.Fog(0x141a24, 1100, 2800);

const camera = new THREE.PerspectiveCamera(52, 1, 0.5, 6000);
camera.position.copy(CAMERA_HOME);

const sun = new THREE.DirectionalLight(0xfff2e0, 2.4);
sun.position.set(-420, 620, 340);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 2200;
sun.shadow.camera.left = -640;
sun.shadow.camera.right = 640;
sun.shadow.camera.top = 640;
sun.shadow.camera.bottom = -640;
// World-unit offsets: at this scale a plain depth bias either leaks acne across
// the flats or detaches shadows from the ridges that cast them.
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 1.4;
scene.add(sun, sun.target);

scene.add(new THREE.HemisphereLight(0xbdd4ff, 0x4a5060, 1.15));

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = false;
controls.minDistance = 8;
controls.maxDistance = 2400;
// Left stays free for the brush — everything else is camera.
controls.mouseButtons = {
  LEFT: null,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: THREE.MOUSE.ROTATE,
};
// Stop just short of the horizon so the camera can't roll under the terrain.
controls.maxPolarAngle = Math.PI * 0.495;

// ── World ───────────────────────────────────────────────────────────────────

const heightfield = createHeightfield(GRID_SIZE, WORLD_EXTENT);
const terrain = createTerrainMesh(heightfield);
terrain.object.castShadow = true;
scene.add(terrain.object);

const history = createHistory(heightfield);
const cursor = createBrushCursor();
scene.add(cursor.object);

// ── Editor state ────────────────────────────────────────────────────────────

let tool: ToolId = "raise";
let brush: BrushSettings = DEFAULT_BRUSH;
let sculpting = false;
let invert = false;
let flattenTarget = 0;
let hit: RayHit | null = null;
let pointerInside = false;

const pointerNdc = new THREE.Vector2();
const raycaster = new THREE.Raycaster();

const panel = createPanel(ui, tool, brush, {
  onTool: setTool,
  onBrush: (next) => {
    brush = next;
  },
  onUndo: doUndo,
  onRedo: doRedo,
  onNew: doNew,
  onSave: () => {
    downloadProject(heightfield, "sculpt.clay");
    panel.toast("Saved sculpt.clay");
  },
  onLoad: doLoad,
  onGrid: (visible) => terrain.setGridVisible(visible),
  onFrame: frameAll,
});

function setTool(next: ToolId): void {
  tool = next;
  panel.setTool(next);
}

function activeTool(): ToolId {
  // Shift flips the digging direction, the way every sculpting tool does.
  // Smooth and Flatten have no opposite, so they ignore it.
  if (!invert) return tool;
  if (tool === "raise") return "lower";
  if (tool === "lower") return "raise";
  return tool;
}

function refreshHistoryButtons(): void {
  panel.setHistory(history.canUndo(), history.canRedo());
}

// ── Pointer ─────────────────────────────────────────────────────────────────

function updatePointer(event: PointerEvent): void {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  pointerInside = true;
}

function castToTerrain(): RayHit | null {
  raycaster.setFromCamera(pointerNdc, camera);
  const { origin, direction } = raycaster.ray;
  return raycastHeightfield(
    heightfield,
    origin.x,
    origin.y,
    origin.z,
    direction.x,
    direction.y,
    direction.z,
  );
}

renderer.domElement.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  updatePointer(event);
  hit = castToTerrain();
  if (!hit) return;
  renderer.domElement.setPointerCapture(event.pointerId);
  invert = event.shiftKey;
  // Flatten levels to wherever you first pressed, so you pick the height by
  // clicking it rather than typing a number.
  flattenTarget = heightAtWorld(heightfield, hit.x, hit.z);
  history.begin();
  sculpting = true;
});

renderer.domElement.addEventListener("pointermove", updatePointer);

renderer.domElement.addEventListener("pointerenter", () => {
  pointerInside = true;
});

renderer.domElement.addEventListener("pointerleave", () => {
  pointerInside = false;
});

function endStroke(event: PointerEvent): void {
  if (!sculpting) return;
  sculpting = false;
  if (renderer.domElement.hasPointerCapture(event.pointerId)) {
    renderer.domElement.releasePointerCapture(event.pointerId);
  }
  if (history.end()) {
    refreshHistoryButtons();
    scheduleAutosave();
  }
}

renderer.domElement.addEventListener("pointerup", endStroke);
renderer.domElement.addEventListener("pointercancel", endStroke);
renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());

// ── Keyboard ────────────────────────────────────────────────────────────────

const TOOL_KEYS: Readonly<Record<string, ToolId>> = {
  "1": "raise",
  "2": "lower",
  "3": "smooth",
  "4": "flatten",
};

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) doRedo();
    else doUndo();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
    event.preventDefault();
    doRedo();
    return;
  }

  const keyed = TOOL_KEYS[event.key];
  if (keyed) {
    setTool(keyed);
    return;
  }

  if (event.key === "[" || event.key === "]") {
    const step = Math.max(2, brush.radius * 0.15);
    const radius = THREE.MathUtils.clamp(
      brush.radius + (event.key === "]" ? step : -step),
      MIN_RADIUS,
      MAX_RADIUS,
    );
    brush = { ...brush, radius };
    panel.setBrush(brush);
    return;
  }

  if (event.key === "f" || event.key === "F") frameAll();
  if (event.key === "Shift") invert = true;
});

window.addEventListener("keyup", (event) => {
  // Only clear while idle: releasing Shift mid-stroke shouldn't flip the brush
  // out from under a drag that started inverted.
  if (event.key === "Shift" && !sculpting) invert = false;
});

// ── Commands ────────────────────────────────────────────────────────────────

function applyHistoryStep(step: "undo" | "redo"): void {
  const rect = step === "undo" ? history.undo() : history.redo();
  if (!rect) {
    panel.toast(step === "undo" ? "Nothing to undo" : "Nothing to redo");
    return;
  }
  terrain.update(rect);
  renderer.shadowMap.needsUpdate = true;
  refreshHistoryButtons();
  scheduleAutosave();
}

function doUndo(): void {
  applyHistoryStep("undo");
}

function doRedo(): void {
  applyHistoryStep("redo");
}

function doNew(): void {
  if (!window.confirm("Start a new sculpt? The current one will be lost unless you saved it.")) {
    return;
  }
  heightfield.heights.fill(0);
  recomputeCeiling(heightfield);
  terrain.updateAll();
  renderer.shadowMap.needsUpdate = true;
  history.clear();
  refreshHistoryButtons();
  clearAutosave();
  panel.toast("New sculpt");
}

function doLoad(file: File): void {
  void readProjectFile(file)
    .then((project) => {
      if (project.size !== GRID_SIZE) {
        throw new Error(
          `That sculpt is ${project.size}×${project.size}; this build works at ${GRID_SIZE}×${GRID_SIZE}.`,
        );
      }
      heightfield.heights.set(project.heights);
      recomputeCeiling(heightfield);
      terrain.updateAll();
      renderer.shadowMap.needsUpdate = true;
      history.clear();
      refreshHistoryButtons();
      scheduleAutosave();
      panel.toast(`Loaded ${file.name}`);
    })
    .catch((error: unknown) => {
      panel.toast(error instanceof Error ? error.message : "Couldn't load that file.");
    });
}

function frameAll(): void {
  controls.target.set(0, 0, 0);
  camera.position.copy(CAMERA_HOME);
  controls.update();
}

// Autosave is debounced rather than immediate: a flurry of short strokes
// shouldn't each pay for a megabyte of base64.
let autosaveTimer = 0;
function scheduleAutosave(): void {
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    if (!autosave(heightfield)) panel.toast("Autosave failed — browser storage is full.");
  }, 1500);
}

// ── Boot ────────────────────────────────────────────────────────────────────

const restored = loadAutosave();
if (restored && restored.size === GRID_SIZE) {
  heightfield.heights.set(restored.heights);
  panel.toast("Restored your last sculpt");
}
recomputeCeiling(heightfield);
terrain.updateAll();
renderer.shadowMap.needsUpdate = true;
refreshHistoryButtons();

function resize(): void {
  const width = app.clientWidth;
  const height = app.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

/**
 * One frame: advance the camera, apply the brush if a stroke is live, redraw.
 *
 * Kept separate from the animation loop and taking `dt` as an argument so a
 * stroke can be replayed at a fixed timestep — the same drag then produces the
 * same mountain regardless of frame rate, which is what makes sculpting
 * reproducible enough to debug.
 */
function step(dt: number): void {
  controls.update();

  if (pointerInside || sculpting) {
    hit = castToTerrain();
  } else {
    hit = null;
  }

  if (sculpting && hit) {
    const rect = applyBrush(
      heightfield,
      history,
      activeTool(),
      hit,
      brush,
      dt,
      flattenTarget,
    );
    if (rect) {
      terrain.update(rect);
      renderer.shadowMap.needsUpdate = true;
    }
  }

  if (hit) {
    cursor.setVisible(true);
    cursor.update(heightfield, hit.x, hit.z, brush.radius, brush.falloff);
  } else {
    cursor.setVisible(false);
  }

  renderer.render(scene, camera);
}

const timer = new THREE.Timer();

renderer.setAnimationLoop(() => {
  timer.update();
  // Clamped so a stall (alt-tab, a slow load) can't land one enormous brush
  // step the instant the tab wakes up.
  step(Math.min(timer.getDelta(), 0.05));
});

// A handle for poking at the editor from the browser console — checking a
// height, stepping a stroke frame by frame, scripting a repro. Dev builds only,
// so nothing leaks into a production bundle.
if (import.meta.env.DEV) {
  Object.assign(window, {
    mapBuilder: { heightfield, terrain, scene, camera, controls, history, renderer, step },
  });
}
