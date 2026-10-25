// Materials for instanced props. A standard PBR material with vertex colors, patched so the
// per-instance color only applies where aTint = 1 (foliage, roofs, awnings), plus an optional
// wind sway for vegetation. Each view gets its own small set (createPropMaterials) because the
// overlay ghosting below is per view; three shares the compiled programs through the cache key.
//
// Overlay ghosting: while an overlay is shown, props would hide much of the colors and cue
// patterns on the ground under them (trees cover about half of a forest cell from the default
// view). uOverlayMix (0..1, eased with the terrain overlay fade) shrinks every prop toward its
// base and fades its color toward a pale neutral, so the map reads like the legend while a low
// footprint of trees, houses and roads stays for orientation.
import { DoubleSide, MeshStandardMaterial, type IUniform } from 'three'

/** Global animation uniforms shared by all patched materials. */
export const sharedUniforms: { uTime: IUniform<number>; uWind: IUniform<number> } = {
  uTime: { value: 0 },
  uWind: { value: 1 },
}

/**
 * How far each material family shrinks and fades at full overlay. Height is the share of the
 * prop's height kept, width the share of its footprint width kept (local x and z), ghost the
 * share of its color replaced by the neutral ghost color.
 */
export const OVERLAY_GHOST = {
  vegetation: { height: 0.18, width: 0.55, ghost: 0.75 },
  solid: { height: 0.3, width: 0.9, ghost: 0.65 },
  ground: { height: 0.5, width: 0.6, ghost: 0.7 },
  // roads are flat ribbons that hide little and give orientation, so they only fade
  road: { height: 1, width: 1, ghost: 0.45 },
} as const
export type PropFamily = keyof typeof OVERLAY_GHOST

/** Pale warm grey the ghosted props fade to (linear RGB). */
const GHOST_COLOR = 'vec3( 0.62, 0.6, 0.56 )'

/** Prop scale at a given overlay mix (the same formula the vertex shader applies). */
export function ghostScale(family: PropFamily, mix: number): { height: number; width: number } {
  const g = OVERLAY_GHOST[family]
  const m = Math.min(1, Math.max(0, mix))
  return { height: 1 + (g.height - 1) * m, width: 1 + (g.width - 1) * m }
}

const TINT_VERTEX = /* glsl */ `
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR )
	vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR
	vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, aTint );
#endif
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR )
	vColor.rgb = mix( vColor.rgb, ${GHOST_COLOR}, uOverlayMix * uGhostColor );
#endif
`

const WIND = /* glsl */ `
#ifdef USE_INSTANCING
  {
    vec3 ip = vec3( instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2] );
    float h = max( 0.0, transformed.y );
    float ph = uTime * 1.7 + ip.x * 0.71 + ip.z * 0.93;
    float gust = 0.6 + 0.4 * sin( uTime * 0.37 + ip.x * 0.05 );
    float k = uWind * aTint * h * h * 0.05 * gust;
    transformed.x += sin( ph ) * k;
    transformed.z += cos( ph * 0.83 ) * k * 0.7;
  }
#endif`

// local space: y is up from the prop's base, so scaling y keeps it standing on the ground
const GHOST_SHAPE = /* glsl */ `
  transformed.y *= mix( 1.0, uGhostHeight, uOverlayMix );
  transformed.xz *= mix( 1.0, uGhostWidth, uOverlayMix );`

export interface PropMaterials {
  vegetation: MeshStandardMaterial
  solid: MeshStandardMaterial
  ground: MeshStandardMaterial
  road: MeshStandardMaterial
  /** 0..1 overlay presence for this view; the caller eases it. */
  overlayMix: IUniform<number>
  dispose(): void
}

function patch(mat: MeshStandardMaterial, family: PropFamily, overlayMix: IUniform<number>, wind: boolean): MeshStandardMaterial {
  const g = OVERLAY_GHOST[family]
  const own = { uGhostHeight: { value: g.height }, uGhostWidth: { value: g.width }, uGhostColor: { value: g.ghost } }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime
    shader.uniforms.uWind = sharedUniforms.uWind
    shader.uniforms.uOverlayMix = overlayMix
    Object.assign(shader.uniforms, own)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTint;\nuniform float uTime;\nuniform float uWind;\nuniform float uOverlayMix;\nuniform float uGhostHeight;\nuniform float uGhostWidth;\nuniform float uGhostColor;')
      .replace('#include <color_vertex>', TINT_VERTEX)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${GHOST_SHAPE}${wind ? WIND : ''}`)
  }
  mat.customProgramCacheKey = () => `amoria-${family}`
  mat.userData.amoriaUniforms = { uOverlayMix: overlayMix, ...own }
  return mat
}

/** A fresh set of prop materials for one view. Dispose it when the view unmounts. */
export function createPropMaterials(): PropMaterials {
  const overlayMix: IUniform<number> = { value: 0 }
  const vegetation = patch(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0 }), 'vegetation', overlayMix, true)
  const solid = patch(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0 }), 'solid', overlayMix, false)
  // ground-hugging marks (crop rows, terraces) and roads: offset to avoid z-fighting with terrain
  const flat = () => new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: DoubleSide })
  const ground = patch(flat(), 'ground', overlayMix, false)
  const road = patch(flat(), 'road', overlayMix, false)
  return {
    vegetation,
    solid,
    ground,
    road,
    overlayMix,
    dispose() {
      vegetation.dispose()
      solid.dispose()
      ground.dispose()
      road.dispose()
    },
  }
}
