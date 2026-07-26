// The heightfield, made visible.
//
// The geometry is built by hand rather than from PlaneGeometry so that vertex n
// is height n — same index, no translation layer. That is what makes a partial
// update cheap: a brush stroke touches a small rectangle of the grid, and we
// re-upload exactly that band of the vertex buffer instead of all 262,144.

import * as THREE from "three";
import type { GridRect, Heightfield } from "./heightfield";
import { heightAtGrid, worldXOf, worldZOf } from "./heightfield";

export interface TerrainMesh {
  readonly object: THREE.Mesh;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.MeshStandardMaterial;
  /** Push a changed rectangle of heights to the GPU. */
  update(dirty: GridRect): void;
  /** Push the whole field (after a load, or a New). */
  updateAll(): void;
  setGridVisible(visible: boolean): void;
  dispose(): void;
}

export function createTerrainMesh(hf: Heightfield): TerrainMesh {
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
  positionAttr.setUsage(THREE.DynamicDrawUsage);
  normalAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttr);
  geometry.setAttribute("normal", normalAttr);
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

  const fullRect: GridRect = { minX: 0, minZ: 0, maxX: size - 1, maxZ: size - 1 };

  return {
    object,
    geometry,
    material,
    update: writeRect,
    updateAll: () => writeRect(fullRect),
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
 * Snow that you can actually read the shape of.
 *
 * A plain white lambert surface is nearly impossible to sculpt against — soft
 * light on white gives you almost no gradient, so a ridge and a bowl look the
 * same. So the material adds three cues on top of the lighting: steep faces
 * darken toward rock, elevation contour lines band the surface every 10 units,
 * and a faint world grid every 64 units gives scale. It doubles as a preview of
 * the slope-based blending the paint-layer pass will do for real.
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
         varying vec3 vClayWorld;
         varying vec3 vClayNormal;`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
         vClayWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
         vClayNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float uGrid;
         uniform float uContourSpacing;
         varying vec3 vClayWorld;
         varying vec3 vClayNormal;

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
           // Steep ground reads as exposed rock; flat ground stays snow. The
           // thresholds put anything under ~30° in snow, ~45° half rock and
           // ~60° fully rock — steep enough to be believable, shallow enough
           // that the shading actually tells you where the pitches are.
           float slope = 1.0 - clamp(vClayNormal.y, 0.0, 1.0);
           float rock = smoothstep(0.14, 0.48, slope);
           vec3 snowColor = vec3(0.93, 0.95, 0.98);
           vec3 rockColor = vec3(0.44, 0.45, 0.50);
           diffuseColor.rgb *= mix(snowColor, rockColor, rock);

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
      );
  };

  return material;
}
