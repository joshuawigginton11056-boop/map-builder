// The ring under the mouse.
//
// Drawn as a loop of segments draped over the terrain — sampling the actual
// height at each point — rather than a flat disc. On a slope a flat disc lies
// half-buried and tells you nothing; a draped ring shows you exactly the ground
// the stroke is about to move.
//
// Two rings: the outer one is the brush radius, the inner one is where the
// falloff starts. Everything between them is the soft rim.

import * as THREE from "three";
import type { Heightfield } from "../terrain/heightfield";
import { heightAtWorld } from "../terrain/heightfield";

const SEGMENTS = 96;

export interface BrushCursor {
  readonly object: THREE.Object3D;
  update(hf: Heightfield, x: number, z: number, radius: number, falloff: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

export function createBrushCursor(): BrushCursor {
  const outer = makeRing(0xff9c3f, 1);
  const inner = makeRing(0xff9c3f, 0.35);
  const object = new THREE.Group();
  object.name = "brushCursor";
  object.add(outer.line, inner.line);
  object.renderOrder = 10;

  return {
    object,
    update(hf, x, z, radius, falloff) {
      // Lift the ring off the surface enough that it never z-fights, scaled to
      // the brush so a huge brush on a steep face still reads.
      const lift = Math.max(0.4, radius * 0.02);
      writeRing(outer, hf, x, z, radius, lift);
      writeRing(inner, hf, x, z, Math.max(0.001, radius * (1 - falloff)), lift);
      inner.line.visible = falloff > 0.02;
    },
    setVisible(visible) {
      object.visible = visible;
    },
    dispose() {
      outer.dispose();
      inner.dispose();
    },
  };
}

interface Ring {
  readonly line: THREE.LineLoop;
  readonly positions: Float32Array;
  readonly attribute: THREE.BufferAttribute;
  dispose(): void;
}

function makeRing(color: number, opacity: number): Ring {
  const positions = new Float32Array(SEGMENTS * 3);
  const attribute = new THREE.BufferAttribute(positions, 3);
  attribute.setUsage(THREE.DynamicDrawUsage);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", attribute);
  // The ring moves with the mouse, so a fixed bounding sphere large enough to
  // never be wrong beats recomputing one every frame.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Number.MAX_VALUE);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthTest: true,
  });
  const line = new THREE.LineLoop(geometry, material);
  line.frustumCulled = false;
  return {
    line,
    positions,
    attribute,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

function writeRing(
  ring: Ring,
  hf: Heightfield,
  cx: number,
  cz: number,
  radius: number,
  lift: number,
): void {
  const { positions } = ring;
  for (let i = 0; i < SEGMENTS; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2;
    const x = cx + Math.cos(a) * radius;
    const z = cz + Math.sin(a) * radius;
    positions[i * 3] = x;
    positions[i * 3 + 1] = heightAtWorld(hf, x, z) + lift;
    positions[i * 3 + 2] = z;
  }
  ring.attribute.needsUpdate = true;
}
