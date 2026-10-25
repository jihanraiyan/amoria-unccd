// Amoria's art direction: a warm, sun-baked semi-arid valley. Sage and olive greens, straw,
// ochre and terracotta soils, dusty plaster villages, teal water. Colors are authored as sRGB
// hex and converted once to linear RGB (three.js working space) for vertex/instance colors.
import { Color } from 'three'
import { LAND_COVERS, type Season } from '../../simulation/types'
import type { WeatherKind } from './frame'

export type RGB = [number, number, number]

export function linear(hex: string | number): RGB {
  const c = new Color(hex)
  return [c.r, c.g, c.b]
}

export const mix = (a: RGB, b: RGB, t: number): RGB => {
  const k = t < 0 ? 0 : t > 1 ? 1 : t
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}

export const scaleRGB = (a: RGB, s: number): RGB => [a[0] * s, a[1] * s, a[2] * s]

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0)
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

/** Ground colors per land cover: lush (wet, healthy) and parched (dry/stressed) variants. */
export const GROUND_HEX: Record<(typeof LAND_COVERS)[number], { lush: string; parched: string }> = {
  forest: { lush: '#56703a', parched: '#76733f' },
  grassland: { lush: '#9aae5c', parched: '#cdb46c' },
  cropland: { lush: '#86744a', parched: '#a5835a' },
  agroforestry: { lush: '#7f8a4c', parched: '#a08f5c' },
  urban: { lush: '#bfae92', parched: '#c9b494' },
  wetland: { lush: '#63804f', parched: '#8a8a5c' },
  water: { lush: '#6c6a52', parched: '#7d7558' },
  bare: { lush: '#bf8c5a', parched: '#c99560' },
}

export const PALETTE = {
  eroded: linear('#b5683c'),
  gully: linear('#8f4a2c'),
  rock: linear('#9c8d7a'),
  silt: linear('#cdb68c'),
  highland: linear('#8d9a7c'),
  skirtTop: linear('#8a6a4a'),
  skirtBottom: linear('#4f3a2a'),
  roadSurface: linear('#a39582'),
  roadEdge: linear('#7d6f5e'),
  terraceRidge: linear('#7b5a3a'),
  irrigation: linear('#5f9fa8'),
  bark: linear('#6b4a32'),
  barkDark: linear('#4f3726'),
  stumpInner: linear('#d9b98a'),
  stone: linear('#a3998a'),
  wall: linear('#efe2c8'),
  wallShade: linear('#d8c6a4'),
  window: linear('#4a4038'),
  door: linear('#6e4a30'),
  reed: linear('#8f9a4e'),
  reedDry: linear('#b8a35e'),
  lily: linear('#5b8a46'),
  embankment: linear('#8c7354'),
  concrete: linear('#c9c2b4'),
  tank: linear('#d9d4c8'),
  pipe: linear('#5f7f8a'),
  marketWood: linear('#8a5f3a'),
} as const

/**
 * State tints for the "Colorblind-friendly colors" setting. The default world drifts from green
 * toward ochre, terracotta and gully red, which red-green colorblind players see as one muddy
 * olive. Here damage moves along a light/dark and yellow/blue axis instead: degraded soil and
 * drought turn pale straw (lighter), erosion and gullies turn dark slate blue (darker), so the
 * difference survives without red-green vision.
 */
export const COLORBLIND_TINTS = {
  eroded: linear('#e6d59c'),
  gully: linear('#334064'),
  rock: linear('#cfcbc4'),
  parched: linear('#efe2a8'),
  foliageStressed: linear('#e0cf7a'),
  foliageDead: linear('#5d6178'),
  cropStressed: linear('#e3d28a'),
  cropFailed: linear('#59607a'),
} as const

/** Foliage tints (instance colors) for tree species and plants. */
export const FOLIAGE = {
  conifer: linear('#46703e'),
  broadleaf: linear('#6f9440'),
  oak: linear('#5d8236'),
  poplar: linear('#8ea24a'),
  fruit: linear('#7fa244'),
  shrub: linear('#80963f'),
  stressed: linear('#a99a4c'),
  dead: linear('#8b6a40'),
} as const

export const ROOF_HEX = ['#b4553a', '#c46a42', '#9c4a36', '#7a6a62', '#b97a4a', '#a8583e']
export const ROOFS: RGB[] = ROOF_HEX.map(linear)
export const AWNING_HEX = ['#d9563a', '#e8b33a', '#3f8fa0', '#c4643c', '#f0d9a0']
export const AWNINGS: RGB[] = AWNING_HEX.map(linear)

const GROUND: { lush: RGB; parched: RGB }[] = LAND_COVERS.map((c) => ({
  lush: linear(GROUND_HEX[c].lush),
  parched: linear(GROUND_HEX[c].parched),
}))

const VEGETATED = new Set([0, 1, 2, 3, 5]) // forest, grassland, cropland, agroforestry, wetland

/** How dry the season looks overall (0 = lush wet season, 1 = parched). */
export function seasonDryness(season: Season, weather: WeatherKind): number {
  let d = season === 'dry' ? 0.45 : 0.05
  if (weather === 'drought') d += 0.45
  else if (weather === 'heavy-rain') d -= 0.1
  else if (weather === 'favorable') d -= 0.05
  return clamp01(d)
}

export interface SurfaceInputs {
  cover: number
  soilHealth: number
  vegetation: number
  /** 0..1 water factor, or null if not simulated yet. */
  waterFactor: number | null
  /** Erosion normalised to 0..1 against the display reference. */
  erosionNorm: number
  slope: number
  /** 0..1 relative elevation within the map. */
  elevationNorm: number
  dryness: number
  isRoad: boolean
  /** Colorblind-friendly state tints (see COLORBLIND_TINTS). */
  colorblind?: boolean
}

/**
 * Ground color of one cell. Pure display mapping: degraded soil (low soilHealth) drifts toward
 * ochre and terracotta, high erosion toward gully red, water stress and dry seasons toward straw,
 * steep slopes toward exposed rock.
 */
export function surfaceColor(p: SurfaceInputs): RGB {
  const g = GROUND[p.cover] ?? GROUND[7]
  const vegetated = VEGETATED.has(p.cover)
  const stress = p.waterFactor === null ? 0 : 1 - clamp01(p.waterFactor)
  let parched = vegetated ? clamp01(p.dryness * 0.85 + stress * 0.55) : clamp01(p.dryness * 0.4)
  if (vegetated) parched = clamp01(parched + (1 - clamp01(p.vegetation)) * 0.25)
  const cb = p.colorblind === true
  let c = mix(g.lush, g.parched, parched)
  // dryness reads as lightness, not only as a hue shift toward straw
  if (cb && vegetated) c = mix(c, COLORBLIND_TINTS.parched, parched * 0.35)
  if (p.cover !== 6 && p.cover !== 4) {
    const degradation = smoothstep(0.78, 0.2, p.soilHealth)
    c = mix(c, cb ? COLORBLIND_TINTS.eroded : PALETTE.eroded, degradation * 0.75)
    c = mix(c, cb ? COLORBLIND_TINTS.gully : PALETTE.gully, smoothstep(0.35, 1, p.erosionNorm) * (cb ? 0.6 : 0.45))
    c = mix(c, cb ? COLORBLIND_TINTS.rock : PALETTE.rock, smoothstep(0.3, 0.75, p.slope) * (cb ? 0.55 : 0.45))
    c = mix(c, PALETTE.highland, smoothstep(0.6, 1, p.elevationNorm) * 0.25 * (vegetated ? 1 : 0.4))
  }
  if (p.isRoad) c = mix(c, PALETTE.roadEdge, 0.35)
  return c
}
