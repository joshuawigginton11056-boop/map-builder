// The heightfield, made visible.
//
// The geometry is built by hand rather than from PlaneGeometry so that vertex n
// is height n — same index, no translation layer. That is what makes a partial
// update cheap: a brush stroke touches a small rectangle of the grid, and we
// re-upload exactly that band of the vertex buffer instead of all 262,144.

import * as THREE from "three";
import type { GridRect, Heightfield } from "./heightfield";
import { heightAtGrid, worldXOf, worldZOf } from "./heightfield";
import { LAYER_COUNT, type LayerField } from "./layerField";

export interface TerrainMesh {
  readonly object: THREE.Mesh;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.MeshStandardMaterial;
  /** Push a changed rectangle of heights to the GPU. */
  update(dirty: GridRect): void;
  /** Push a changed rectangle of layer weights to the GPU. */
  updatePaint(dirty: GridRect): void;
  /** Push the whole field, shape and surface (after a load, or a New). */
  updateAll(): void;
  setGridVisible(visible: boolean): void;
  dispose(): void;
}

export function createTerrainMesh(hf: Heightfield, layers: LayerField): TerrainMesh {
  const { size } = hf;
  const vertexCount = size * size;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  for (let iz = 0; iz < size; iz++) {
    const z = worldZOf(hf, iz);
    for (let ix = 0; ix < size; ix++) {
      const v = (iz * size + ix) * 3;
      positions[v] = worldXOf(hf, ix);
      positions[v + 1] = hf.heights[iz * size + ix]!;
      positions[v + 2] = z;
      normals[v + 1] = 1;
    }
  }

  // Two triangles per quad. Uint32 because 512² vertices overflows Uint16.
  const quads = (size - 1) * (size - 1);
  const indices = new Uint32Array(quads * 6);
  let o = 0;
  for (let iz = 0; iz < size - 1; iz++) {
    for (let ix = 0; ix < size - 1; ix++) {
      const a = iz * size + ix;
      const b = a + 1;
      const c = a + size;
      const d = c + 1;
      indices[o++] = a;
      indices[o++] = c;
      indices[o++] = b;
      indices[o++] = b;
      indices[o++] = c;
      indices[o++] = d;
    }
  }

  const geometry = new THREE.BufferGeometry();
  const positionAttr = new THREE.BufferAttribute(positions, 3);
  const normalAttr = new THREE.BufferAttribute(normals, 3);
  // The paint field is already laid out four bytes per grid point in the order
  // the shader wants, so the attribute reads it in place — no copy, no second
  // representation to keep in step. `normalized` turns 0–255 into 0–1 on the
  // GPU for free.
  const layerAttr = new THREE.BufferAttribute(layers.weights, LAYER_COUNT, true);
  positionAttr.setUsage(THREE.DynamicDrawUsage);
  normalAttr.setUsage(THREE.DynamicDrawUsage);
  layerAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttr);
  geometry.setAttribute("normal", normalAttr);
  geometry.setAttribute("aLayer", layerAttr);
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), hf.extent);

  const material = createClayMaterial();
  const object = new THREE.Mesh(geometry, material);
  object.name = "terrain";
  // The field is bounded and always on screen; skipping the per-frame frustum
  // test also stops a stale bounding volume from blinking the terrain away
  // mid-stroke.
  object.frustumCulled = false;
  object.receiveShadow = true;
  object.castShadow = false;

  const gridUniform = (material.userData["uniforms"] as ClayUniforms).uGrid;

  function writeRect(rect: GridRect): void {
    // Normals come from the slope between neighbours, so a changed height
    // changes its neighbours' normals too — widen by one before recomputing.
    const nMinX = Math.max(0, rect.minX - 1);
    const nMinZ = Math.max(0, rect.minZ - 1);
    const nMaxX = Math.min(size - 1, rect.maxX + 1);
    const nMaxZ = Math.min(size - 1, rect.maxZ + 1);

    for (let iz = rect.minZ; iz <= rect.maxZ; iz++) {
      for (let ix = rect.minX; ix <= rect.maxX; ix++) {
        positions[(iz * size + ix) * 3 + 1] = hf.heights[iz * size + ix]!;
      }
    }

    // Central differences: the surface normal of a heightfield is
    // (-dh/dx, 1, -dh/dz), normalised. Cheaper and smoother than averaging
    // face normals, and it needs no adjacency bookkeeping.
    const inv = 1 / (2 * hf.spacing);
    for (let iz = nMinZ; iz <= nMaxZ; iz++) {
      for (let ix = nMinX; ix <= nMaxX; ix++) {
        const dhdx = (heightAtGrid(hf, ix + 1, iz) - heightAtGrid(hf, ix - 1, iz)) * inv;
        const dhdz = (heightAtGrid(hf, ix, iz + 1) - heightAtGrid(hf, ix, iz - 1)) * inv;
        const len = Math.hypot(dhdx, 1, dhdz);
        const v = (iz * size + ix) * 3;
        normals[v] = -dhdx / len;
        normals[v + 1] = 1 / len;
        normals[v + 2] = -dhdz / len;
      }
    }

    // Rows are contiguous in the buffer, so one span covering rows
    // nMinZ..nMaxZ uploads the change in a single range.
    const start = nMinZ * size * 3;
    const count = (nMaxZ - nMinZ + 1) * size * 3;
    positionAttr.clearUpdateRanges();
    positionAttr.addUpdateRange(start, count);
    positionAttr.needsUpdate = true;
    normalAttr.clearUpdateRanges();
    normalAttr.addUpdateRange(start, count);
    normalAttr.needsUpdate = true;
  }

  function writePaintRect(rect: GridRect): void {
    // Unlike heights, a painted weight affects nothing but its own vertex, so
    // there is no neighbour ring to widen by. The rows still upload as one
    // contiguous span.
    const start = rect.minZ * size * LAYER_COUNT;
    const count = (rect.maxZ - rect.minZ + 1) * size * LAYER_COUNT;
    layerAttr.clearUpdateRanges();
    layerAttr.addUpdateRange(start, count);
    layerAttr.needsUpdate = true;
  }

  const fullRect: GridRect = { minX: 0, minZ: 0, maxX: size - 1, maxZ: size - 1 };

  return {
    object,
    geometry,
    material,
    update: writeRect,
    updatePaint: writePaintRect,
    updateAll: () => {
      writeRect(fullRect);
      writePaintRect(fullRect);
    },
    setGridVisible: (visible) => {
      gridUniform.value = visible ? 1 : 0;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

interface ClayUniforms {
  readonly uGrid: { value: number };
  readonly uContourSpacing: { value: number };
}

/**
 * Snow that you can actually read the shape of, plus whatever you have painted
 * onto it.
 *
 * A plain white lambert surface is nearly impossible to sculpt against — soft
 * light on white gives you almost no gradient, so a ridge and a bowl look the
 * same. So the material adds three cues on top of the lighting: steep faces
 * darken toward rock, elevation contour lines band the surface every 10 units,
 * and a faint world grid every 64 units gives scale.
 *
 * The slope-driven rock is the *starting point*, not the answer. The four paint
 * weights sum to at most one, and the shortfall is how much of that automatic
 * shading still shows through — so unpainted ground looks exactly as it did
 * before paint existed, and a stroke of any material (Snow included) takes the
 * surface over wherever it lands.
 */
function createClayMaterial(): THREE.MeshStandardMaterial {
  const uniforms: ClayUniforms = {
    uGrid: { value: 1 },
    uContourSpacing: { value: 10 },
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0.0,
  });
  material.userData["uniforms"] = uniforms;

  material.onBeforeCompile = (shader) => {
    shader.uniforms["uGrid"] = uniforms.uGrid;
    shader.uniforms["uContourSpacing"] = uniforms.uContourSpacing;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         attribute vec4 aLayer;
         varying vec3 vClayWorld;
         varying vec3 vClayNormal;
         varying vec4 vClayLayer;`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
         vClayWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
         vClayNormal = normalize(mat3(modelMatrix) * objectNormal);
         vClayLayer = aLayer;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float uGrid;
         uniform float uContourSpacing;
         varying vec3 vClayWorld;
         varying vec3 vClayNormal;
         varying vec4 vClayLayer;

         // The palette. Snow stays believable rather than stylised — the game's
         // art direction wants relief and sparkle in the snow, not painted
         // detail — so it is a near-white with a cold cast, and the character
         // comes from the lighting and the contours instead of from the colour.
         const vec3 CLAY_SNOW   = vec3(0.93, 0.95, 0.98);
         const vec3 CLAY_ROCK   = vec3(0.44, 0.45, 0.50);
         const vec3 CLAY_FOREST = vec3(0.20, 0.26, 0.17);
         const vec3 CLAY_ICE    = vec3(0.55, 0.71, 0.83);

         // One anti-aliased line wherever \`value\` crosses a multiple of
         // \`period\`. Width is derived from the on-screen derivative so the
         // lines stay one pixel thick whether you are up close or far out —
         // without this they alias into moire the moment you zoom out.
         //
         // The \`valid\` term handles the degenerate case that derivative-based
         // line drawing always has: where the value barely changes across a
         // pixel, fwidth collapses toward zero and the "line" widens to cover
         // everything. For elevation contours that is not a corner case — it is
         // every piece of ground you have not sculpted yet, which would render
         // as one solid band, and any brush skirt that lifted the ground a
         // hair off zero would then show up as a hard-edged bright patch.
         // Fading the contour out as the surface flattens removes both.
         float clayLine(float value, float period, float widthPx) {
           float scaled = value / period;
           float d = fwidth(scaled);
           float valid = smoothstep(0.0, 0.0012, d);
           float f = abs(fract(scaled - 0.5) - 0.5) / max(d, 1e-5);
           return (1.0 - smoothstep(0.0, widthPx, f)) * valid;
         }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         {
           // Where nothing has been painted, steep ground reads as exposed rock
           // and flat ground stays snow. The thresholds put anything under ~30°
           // in snow, ~45° half rock and ~60° fully rock — steep enough to be
           // believable, shallow enough that the shading actually tells you
           // where the pitches are.
           float slope = 1.0 - clamp(vClayNormal.y, 0.0, 1.0);
           float rock = smoothstep(0.14, 0.48, slope);
           vec3 autoColor = mix(CLAY_SNOW, CLAY_ROCK, rock);

           // Paint on top. \`painted\` is how much of the surface the four layers
           // have claimed between them; the rest is still the automatic
           // shading above. A weighted sum rather than a chain of mixes, so no
           // layer wins by being drawn last.
           float painted = clamp(dot(vClayLayer, vec4(1.0)), 0.0, 1.0);
           vec3 surface = autoColor * (1.0 - painted)
                        + CLAY_SNOW   * vClayLayer.r
                        + CLAY_ROCK   * vClayLayer.g
                        + CLAY_FOREST * vClayLayer.b
                        + CLAY_ICE    * vClayLayer.a;
           diffuseColor.rgb *= surface;

           // Contour bands: the single biggest readability win on white.
           float contour = clayLine(vClayWorld.y, uContourSpacing, 1.0);
           diffuseColor.rgb *= 1.0 - 0.30 * contour;

           // Faint world grid for scale, fading out with distance so it never
           // turns the horizon into noise.
           if (uGrid > 0.5) {
             float g = max(clayLine(vClayWorld.x, 64.0, 1.0),
                           clayLine(vClayWorld.z, 64.0, 1.0));
             float fade = 1.0 - smoothstep(400.0, 1100.0, length(vClayWorld.xz));
             diffuseColor.rgb = mix(diffuseColor.rgb,
                                    diffuseColor.rgb * vec3(0.72, 0.78, 0.88),
                                    g * fade * 0.8);
           }
         }`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
         // Ice is the one layer that has to differ in more than colour: a blue
         // patch at snow's roughness still reads as snow that happens to be
         // blue. Dropping the roughness gives it a specular highlight, which is
         // what actually says "this is slick".
         roughnessFactor = mix(roughnessFactor, 0.18, vClayLayer.a);`,
      );
  };

  return material;
}
