// The tool panel.
//
// Plain DOM on purpose — this is a dozen controls, and a framework would cost
// more to carry than it saves. The panel owns no state of its own: it renders
// what it's told and reports what was clicked, so keyboard shortcuts and the
// panel can never disagree about which tool is active.

import type { BrushSettings, ToolId } from "../sculpt/brush";
import { MAX_RADIUS, MIN_RADIUS } from "../sculpt/brush";

export interface PanelCallbacks {
  onTool(tool: ToolId): void;
  onBrush(settings: BrushSettings): void;
  onUndo(): void;
  onRedo(): void;
  onNew(): void;
  onSave(): void;
  onLoad(file: File): void;
  onGrid(visible: boolean): void;
  onFrame(): void;
}

export interface Panel {
  setTool(tool: ToolId): void;
  setBrush(settings: BrushSettings): void;
  setHistory(canUndo: boolean, canRedo: boolean): void;
  /** Transient message in the corner (saved, loaded, undo empty…). */
  toast(message: string): void;
}

interface ToolSpec {
  readonly id: ToolId;
  readonly label: string;
  readonly key: string;
  readonly hint: string;
}

const TOOLS: readonly ToolSpec[] = [
  { id: "raise", label: "Raise", key: "1", hint: "Push the ground up" },
  { id: "lower", label: "Lower", key: "2", hint: "Dig the ground down" },
  { id: "smooth", label: "Smooth", key: "3", hint: "Soften what's there" },
  { id: "flatten", label: "Flatten", key: "4", hint: "Level to where you clicked" },
];

export function createPanel(
  root: HTMLElement,
  initialTool: ToolId,
  initialBrush: BrushSettings,
  callbacks: PanelCallbacks,
): Panel {
  let brush = initialBrush;

  const panel = el("aside", "panel");
  panel.append(el("h1", "panel-title", "Map Builder"));

  // ── Tools ────────────────────────────────────────────────────────────────
  const toolButtons = new Map<ToolId, HTMLButtonElement>();
  const toolGrid = el("div", "tool-grid");
  for (const tool of TOOLS) {
    const button = document.createElement("button");
    button.className = "tool";
    button.type = "button";
    button.title = tool.hint;
    button.append(el("span", "tool-label", tool.label), el("kbd", "", tool.key));
    button.addEventListener("click", () => callbacks.onTool(tool.id));
    toolGrid.append(button);
    toolButtons.set(tool.id, button);
  }
  panel.append(section("Tool", toolGrid));

  // ── Brush ────────────────────────────────────────────────────────────────
  const size = slider("Size", MIN_RADIUS, MAX_RADIUS, 1, brush.radius, (v) => {
    brush = { ...brush, radius: v };
    callbacks.onBrush(brush);
  });
  const strength = slider("Strength", 1, 100, 1, brush.strength, (v) => {
    brush = { ...brush, strength: v };
    callbacks.onBrush(brush);
  });
  const falloff = slider("Falloff", 0, 100, 1, brush.falloff * 100, (v) => {
    brush = { ...brush, falloff: v / 100 };
    callbacks.onBrush(brush);
  });
  const brushBox = el("div", "stack");
  brushBox.append(size.row, strength.row, falloff.row);
  panel.append(section("Brush", brushBox));

  // ── History ──────────────────────────────────────────────────────────────
  const undo = button("Undo", callbacks.onUndo);
  const redo = button("Redo", callbacks.onRedo);
  panel.append(section("History", row(undo, redo)));

  // ── View ─────────────────────────────────────────────────────────────────
  const gridToggle = document.createElement("label");
  gridToggle.className = "check";
  const gridInput = document.createElement("input");
  gridInput.type = "checkbox";
  gridInput.checked = true;
  gridInput.addEventListener("change", () => callbacks.onGrid(gridInput.checked));
  gridToggle.append(gridInput, document.createTextNode("Grid"));
  const viewBox = el("div", "stack");
  viewBox.append(row(button("Frame all", callbacks.onFrame)), gridToggle);
  panel.append(section("View", viewBox));

  // ── File ─────────────────────────────────────────────────────────────────
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".clay";
  fileInput.style.display = "none";
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) callbacks.onLoad(file);
    // Cleared so picking the same file twice in a row still fires.
    fileInput.value = "";
  });
  const fileBox = el("div", "stack");
  fileBox.append(
    row(button("Save", callbacks.onSave), button("Load", () => fileInput.click())),
    row(button("New", callbacks.onNew)),
    fileInput,
  );
  panel.append(section("File", fileBox));

  panel.append(
    el(
      "p",
      "hints",
      "Left-drag sculpts · Shift inverts · Right-drag orbits · Middle-drag pans · Scroll zooms · [ ] resize · Ctrl+Z undo",
    ),
  );

  const toastEl = el("div", "toast");
  toastEl.style.opacity = "0";

  root.append(panel, toastEl);

  let toastTimer = 0;

  function setTool(tool: ToolId): void {
    for (const [id, btn] of toolButtons) {
      btn.classList.toggle("is-active", id === tool);
    }
  }
  setTool(initialTool);

  return {
    setTool,
    setBrush(next) {
      brush = next;
      size.set(next.radius);
      strength.set(next.strength);
      falloff.set(next.falloff * 100);
    },
    setHistory(canUndo, canRedo) {
      undo.disabled = !canUndo;
      redo.disabled = !canRedo;
    },
    toast(message) {
      toastEl.textContent = message;
      toastEl.style.opacity = "1";
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => {
        toastEl.style.opacity = "0";
      }, 2200);
    },
  };
}

// ── Small DOM helpers ───────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function section(title: string, body: HTMLElement): HTMLElement {
  const wrapper = el("section", "group");
  wrapper.append(el("h2", "group-title", title), body);
  return wrapper;
}

function row(...children: HTMLElement[]): HTMLElement {
  const node = el("div", "row");
  node.append(...children);
  return node;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement("button");
  node.className = "btn";
  node.type = "button";
  node.textContent = label;
  node.addEventListener("click", onClick);
  return node;
}

interface Slider {
  readonly row: HTMLElement;
  set(value: number): void;
}

function slider(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onInput: (value: number) => void,
): Slider {
  const wrapper = el("div", "slider");
  const head = el("div", "slider-head");
  const readout = el("span", "slider-value", String(Math.round(value)));
  head.append(el("span", "slider-label", label), readout);

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener("input", () => {
    const v = Number(input.value);
    readout.textContent = String(Math.round(v));
    onInput(v);
  });

  wrapper.append(head, input);
  return {
    row: wrapper,
    set(next) {
      input.value = String(next);
      readout.textContent = String(Math.round(next));
    },
  };
}
