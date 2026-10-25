// Overlay definitions and value -> color mapping. Every overlay recolors the terrain with a
// colorblind-safe ramp AND draws a color-independent cue (hatching, dots, contour lines,
// category patterns or flow arrows), so the map still reads in grayscale.
// Values come straight from simulation state, or from the simulation's own derived indicators
// (src/simulation/derived/overlays.ts) for sensitivity, erosion risk and urban development.
// The renderer never combines environmental attributes itself.
import type { OverlayId } from '../../state/store'
import { environmentalSensitivity, erosionSusceptibility, urbanIntensity } from '../../simulation/derived/overlays'
import { coverCode, structureCode, type SimulationState } from '../../simulation/types'
import type { WorldFrame } from './frame'

/** Every overlay the world can draw is the store's OverlayId (re-exported for the game module). */
export type { OverlayId }

export type OverlayValueKind = 'none' | 'categorical' | 'continuous'
export type OverlaySource = 'none' | 'terrain' | 'state' | 'model-output' | 'derived-indicator'
export type RampId = 'viridis' | 'cividis' | 'inferno' | 'blues' | 'okabe-ito'
export type CuePattern = 'none' | 'hatch' | 'dots' | 'contours' | 'waves' | 'categories' | 'crosshatch' | 'lines' | 'grid'

export interface OverlayLegendStop {
  /** Position along the ramp, 0..1 (categorical: the category code). */
  t: number
  /** CSS color (sRGB hex). */
  color: string
  label: string
  /** Pattern drawn on the map for this stop (categorical overlays). */
  pattern?: string
}

export type OverlayDomainSpec =
  | { kind: 'none' }
  | { kind: 'fixed'; min: number; max: number }
  | { kind: 'range' }
  | { kind: 'adaptive'; floor: number }

export interface OverlayDef {
  id: OverlayId
  label: string
  description: string
  /** Unit of the underlying value ('' for categories). */
  unit: string
  valueKind: OverlayValueKind
  source: OverlaySource
  ramp: RampId
  domain: OverlayDomainSpec
  higherIs: 'better' | 'worse' | 'neutral'
  cue: { pattern: CuePattern; description: string; /** cue strength grows with value or with 1-value */ follows: 'value' | 'inverse' }
  /** Static legend with qualitative labels. Use resolveLegend() for numeric labels. */
  legend: OverlayLegendStop[]
  /** Label shown for cells that have no value (e.g. non-farmland on the productivity map). */
  noDataLabel?: string
}

export const RAMPS: Record<RampId, string[]> = {
  viridis: ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
  cividis: ['#00224e', '#123570', '#3b496c', '#575d6d', '#707173', '#8a8779', '#a69d75', '#c4b56c', '#e4cf5b', '#fee838'],
  // inferno without its near-black start so low values stay readable on terrain
  inferno: ['#320a5e', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fb9b06', '#f7d13d', '#fcffa4'],
  blues: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#08519c', '#08306b'],
  // Okabe-Ito categorical palette (colorblind safe), ordered to LAND_COVERS
  'okabe-ito': ['#009E73', '#F0E442', '#E69F00', '#56B4E9', '#5a5a5a', '#CC79A7', '#0072B2', '#D55E00'],
}

const COVER_LABELS = ['Forest', 'Grassland', 'Cropland', 'Agroforestry', 'Built-up', 'Wetland', 'Water', 'Bare soil']
const COVER_PATTERNS = ['dots', 'plain', 'rows', 'rows and dots', 'grid', 'waves', 'plain', 'cross-hatch']

const stops = (ramp: RampId, labels: string[]): OverlayLegendStop[] =>
  labels.map((label, k) => {
    const t = labels.length === 1 ? 0 : k / (labels.length - 1)
    return { t, color: rampHex(ramp, t), label }
  })

function hexToRgb01(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

const rampCache = new Map<RampId, [number, number, number][]>()
function rampRgb(ramp: RampId): [number, number, number][] {
  let r = rampCache.get(ramp)
  if (!r) {
    r = RAMPS[ramp].map(hexToRgb01)
    rampCache.set(ramp, r)
  }
  return r
}

/** sRGB color (0..1 channels) at position t along a sequential ramp. */
export function rampColor(ramp: RampId, t: number): [number, number, number] {
  const c = rampRgb(ramp)
  const k = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0
  const f = k * (c.length - 1)
  const i = Math.min(c.length - 2, Math.floor(f))
  const u = f - i
  const a = c[i]
  const b = c[i + 1]
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
}

export function rampHex(ramp: RampId, t: number): string {
  const [r, g, b] = rampColor(ramp, t)
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

export const OVERLAYS: Record<OverlayId, OverlayDef> = {
  none: {
    id: 'none',
    label: 'No overlay',
    description: 'The landscape as it looks.',
    unit: '',
    valueKind: 'none',
    source: 'none',
    ramp: 'viridis',
    domain: { kind: 'none' },
    higherIs: 'neutral',
    cue: { pattern: 'none', description: '', follows: 'value' },
    legend: [],
  },
  landcover: {
    id: 'landcover',
    label: 'Land cover',
    description: 'What covers each parcel right now. Changes when you build, farm, clear or restore.',
    unit: '',
    valueKind: 'categorical',
    source: 'state',
    ramp: 'okabe-ito',
    domain: { kind: 'none' },
    higherIs: 'neutral',
    cue: { pattern: 'categories', description: 'Each cover type also has its own pattern: dots for forest, rows for cropland, a grid for built-up land, waves for wetland, cross-hatching for bare soil.', follows: 'value' },
    legend: COVER_LABELS.map((label, k) => ({ t: k, color: RAMPS['okabe-ito'][k], label, pattern: COVER_PATTERNS[k] })),
  },
  elevation: {
    id: 'elevation',
    label: 'Elevation',
    description: 'Height above sea level. Water drains from high ground toward the valley floor and the outlet.',
    unit: 'm',
    valueKind: 'continuous',
    source: 'terrain',
    ramp: 'cividis',
    domain: { kind: 'range' },
    higherIs: 'neutral',
    cue: { pattern: 'contours', description: 'Contour lines join points of equal height. Lines packed close together mean steep ground.', follows: 'value' },
    legend: stops('cividis', ['Low', 'Mid', 'High']),
  },
  slope: {
    id: 'slope',
    label: 'Slope',
    description: 'How steep each parcel is (rise over run, in percent). Steep bare ground erodes faster in heavy rain.',
    unit: '%',
    valueKind: 'continuous',
    source: 'terrain',
    ramp: 'inferno',
    domain: { kind: 'fixed', min: 0, max: 60 },
    higherIs: 'worse',
    cue: { pattern: 'hatch', description: 'Thicker diagonal hatching means steeper ground.', follows: 'value' },
    legend: stops('inferno', ['Flat', 'Moderate', 'Steep']),
  },
  runoff: {
    id: 'runoff',
    label: 'Runoff and flow',
    description: 'Rain that ran off each parcel last season instead of soaking in (the colors and the wavy lines). Arrows show where that water goes: they follow the downhill flow paths, and bigger arrows carry more water gathered from upslope.',
    unit: 'mm',
    valueKind: 'continuous',
    source: 'model-output',
    ramp: 'blues',
    domain: { kind: 'adaptive', floor: 20 },
    higherIs: 'worse',
    cue: { pattern: 'waves', description: 'Bolder wavy lines mean more rain ran off the parcel, the same measure as the colors. Separately, arrows point downhill along the drainage network, and larger, brighter arrows carry more water from upslope.', follows: 'value' },
    legend: stops('blues', ['Little runoff', 'Some', 'Heavy runoff']),
    noDataLabel: 'Advance time to simulate runoff',
  },
  soil: {
    id: 'soil',
    label: 'Soil condition',
    description: 'An illustrative 0 to 1 soil condition index from the simulation. It falls with erosion and intensive farming and recovers slowly under cover and good practice. Not a lab measurement.',
    unit: 'index',
    valueKind: 'continuous',
    source: 'model-output',
    ramp: 'viridis',
    domain: { kind: 'fixed', min: 0, max: 1 },
    higherIs: 'better',
    cue: { pattern: 'dots', description: 'Bigger dots mean poorer soil.', follows: 'inverse' },
    legend: stops('viridis', ['Degraded', 'Fair', 'Healthy']),
  },
  erosion: {
    id: 'erosion',
    label: 'Erosion pressure',
    description: 'Modeled erosion pressure last season, a RUSLE-inspired index in game tonnes per hectare: rain intensity, slope length and steepness, soil and cover combined. Use it to compare places and strategies, not as measured soil loss.',
    unit: 'game t/ha',
    valueKind: 'continuous',
    source: 'model-output',
    ramp: 'inferno',
    domain: { kind: 'adaptive', floor: 10 },
    higherIs: 'worse',
    cue: { pattern: 'crosshatch', description: 'Denser cross-hatching means more erosion pressure.', follows: 'value' },
    legend: stops('inferno', ['Low', 'Moderate', 'High']),
    noDataLabel: 'Advance time to simulate erosion',
  },
  productivity: {
    id: 'productivity',
    label: 'Farm productivity',
    description: 'Crop harvest per parcel last season (game-scaled tonnes). It depends on soil condition, water, how intensively you farm and the weather.',
    unit: 'game t',
    valueKind: 'continuous',
    source: 'model-output',
    ramp: 'viridis',
    domain: { kind: 'adaptive', floor: 0.1 },
    higherIs: 'better',
    cue: { pattern: 'lines', description: 'More, thicker crop-row lines mean a bigger harvest. Parcels without farms stay plain.', follows: 'value' },
    legend: stops('viridis', ['Poor harvest', 'Average', 'Strong harvest']),
    noDataLabel: 'Not farmland, or no harvest yet',
  },
  moisture: {
    id: 'moisture',
    label: 'Soil moisture',
    description: 'Water held in the soil for plants and crops, in millimetres. It fills in wet seasons and drains in dry ones and droughts.',
    unit: 'mm',
    valueKind: 'continuous',
    source: 'model-output',
    ramp: 'blues',
    domain: { kind: 'adaptive', floor: 50 },
    higherIs: 'better',
    cue: { pattern: 'dots', description: 'Bigger dots mean drier soil.', follows: 'inverse' },
    legend: stops('blues', ['Dry', 'Moist', 'Wet']),
  },
  sensitivity: {
    id: 'sensitivity',
    label: 'Environmental sensitivity',
    description:
      'How much harm disturbing a parcel would do, from the simulation. Each parcel takes the highest of four scores: how fast its soil would wash away if it were bare, how easily the river floods it, whether it sits on a stream bank, and whether it is wetland. A guide to where care matters most, not a measurement.',
    unit: 'index',
    valueKind: 'continuous',
    source: 'derived-indicator',
    ramp: 'inferno',
    domain: { kind: 'fixed', min: 0, max: 1 },
    higherIs: 'worse',
    cue: { pattern: 'hatch', description: 'Thicker hatching means more sensitive land.', follows: 'value' },
    legend: stops('inferno', ['Robust', 'Moderate', 'Sensitive']),
    noDataLabel: 'River, lake or reservoir',
  },
  susceptibility: {
    id: 'susceptibility',
    label: 'Erosion risk',
    description:
      'How much soil each parcel would lose in a normal wet season with its current cover, soil and farming practice, in game tonnes per hectare. Unlike erosion pressure it ignores this season\'s weather, so it shows what your land use does on its own. Use it to compare places, not as measured soil loss.',
    unit: 'game t/ha',
    valueKind: 'continuous',
    source: 'derived-indicator',
    ramp: 'inferno',
    domain: { kind: 'adaptive', floor: 10 },
    higherIs: 'worse',
    cue: { pattern: 'crosshatch', description: 'Denser cross-hatching means a higher erosion risk.', follows: 'value' },
    legend: stops('inferno', ['Low', 'Moderate', 'High']),
    noDataLabel: 'River, lake or reservoir',
  },
  urban: {
    id: 'urban',
    label: 'Urban development',
    description: 'How built up each parcel is, from the simulation: roads, homes by density level, and service buildings such as markets and waterworks. Undeveloped land stays plain.',
    unit: 'index',
    valueKind: 'continuous',
    source: 'derived-indicator',
    ramp: 'cividis',
    domain: { kind: 'fixed', min: 0, max: 1 },
    higherIs: 'neutral',
    cue: { pattern: 'grid', description: 'A street grid whose lines get bolder as development gets denser.', follows: 'value' },
    legend: stops('cividis', ['Road', 'Homes', 'Dense or services']),
    noDataLabel: 'Not developed',
  },
}

export const OVERLAY_IDS = Object.keys(OVERLAYS) as OverlayId[]

/** Shader pattern codes (must match terrainMaterial.ts). */
export const CUE_CODE: Record<CuePattern, number> = {
  none: 0,
  hatch: 1,
  dots: 2,
  contours: 3,
  categories: 4,
  crosshatch: 5,
  lines: 6,
  grid: 7,
  waves: 8,
}

const WATER_COVER = coverCode('water')
const RESERVOIR = structureCode('reservoir')

/** The simulation's derived indicators read only terrain, layers and fields. */
const asSimState = (frame: WorldFrame) => ({ terrain: frame.terrain, layers: frame.layers, fields: frame.fields }) as unknown as SimulationState

/** Copy a derived indicator, with water cells (where the simulation leaves 0) as no-data. */
function derived(frame: WorldFrame, values: Float32Array, out: Float32Array, zeroIsNoData = false): Float32Array {
  const { terrain, layers } = frame
  for (let i = 0; i < out.length; i++) {
    const water = terrain.channel[i] === 1 || layers.cover[i] === WATER_COVER || layers.structure[i] === RESERVOIR
    out[i] = water || (zeroIsNoData && values[i] <= 0) ? NaN : values[i]
  }
  return out
}

/** Raw overlay values per cell; NaN marks "no value" (drawn without overlay color). */
export function overlayValues(id: OverlayId, frame: WorldFrame): Float32Array {
  const n = frame.terrain.width * frame.terrain.height
  const out = new Float32Array(n)
  const { layers, fields, terrain } = frame
  const nanAll = () => out.fill(NaN)
  switch (id) {
    case 'none':
      return nanAll()
    case 'landcover':
      for (let i = 0; i < n; i++) out[i] = layers.cover[i]
      return out
    case 'elevation':
      out.set(terrain.elevationM)
      return out
    case 'slope':
      for (let i = 0; i < n; i++) out[i] = terrain.slope[i] * 100
      return out
    case 'runoff':
      if (!frame.fieldsReady) return nanAll()
      out.set(fields.runoffMm)
      return out
    case 'soil':
      out.set(layers.soilHealth)
      return out
    case 'erosion':
      if (!frame.fieldsReady) return nanAll()
      out.set(fields.erosion)
      for (let i = 0; i < n; i++) if (terrain.channel[i]) out[i] = NaN
      return out
    case 'productivity': {
      const crop = coverCode('cropland')
      const agro = coverCode('agroforestry')
      for (let i = 0; i < n; i++) {
        const c = layers.cover[i]
        out[i] = frame.fieldsReady && (c === crop || c === agro) ? fields.yieldT[i] : NaN
      }
      return out
    }
    case 'moisture':
      out.set(layers.soilMoistureMm)
      for (let i = 0; i < n; i++) if (terrain.channel[i]) out[i] = NaN
      return out
    case 'sensitivity':
      return derived(frame, environmentalSensitivity(asSimState(frame)), out)
    case 'susceptibility':
      return derived(frame, erosionSusceptibility(asSimState(frame)), out)
    case 'urban': {
      const u = urbanIntensity(asSimState(frame))
      for (let i = 0; i < n; i++) out[i] = u[i] > 0 ? u[i] : NaN
      return out
    }
  }
}

/** Value at quantile q (0..1) of the finite entries. */
export function quantile(values: ArrayLike<number>, q: number): number {
  const finite: number[] = []
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) finite.push(values[i])
  if (!finite.length) return NaN
  finite.sort((a, b) => a - b)
  const k = Math.min(finite.length - 1, Math.max(0, Math.round(q * (finite.length - 1))))
  return finite[k]
}

/**
 * Numeric domain [min, max] for an overlay. Pass several value arrays (e.g. both sides of a
 * comparison) to get one shared scale. Adaptive overlays scale to the 98th percentile but never
 * below their floor, so a calm map does not exaggerate tiny differences.
 */
export function overlayDomain(id: OverlayId, ...valueSets: ArrayLike<number>[]): [number, number] {
  const def = OVERLAYS[id]
  const spec = def.domain
  if (spec.kind === 'fixed') return [spec.min, spec.max]
  if (spec.kind === 'none') return def.valueKind === 'categorical' ? [0, RAMPS[def.ramp].length - 1] : [0, 1]
  let lo = Infinity
  let hi = -Infinity
  if (spec.kind === 'range') {
    for (const vs of valueSets) for (let i = 0; i < vs.length; i++) {
      const v = vs[i]
      if (!Number.isFinite(v)) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    if (!Number.isFinite(lo)) return [0, 1]
    return hi - lo < 1e-6 ? [lo, lo + 1] : [lo, hi]
  }
  for (const vs of valueSets) {
    const q = quantile(vs, 0.98)
    if (Number.isFinite(q)) hi = Math.max(hi, q)
  }
  return [0, Math.max(spec.floor, Number.isFinite(hi) ? hi : 0)]
}

/** Position 0..1 of a value within a domain, or NaN for no-data. */
export function normalize(value: number, domain: [number, number]): number {
  if (!Number.isFinite(value)) return NaN
  const span = domain[1] - domain[0]
  if (span <= 0) return 0
  return Math.min(1, Math.max(0, (value - domain[0]) / span))
}

/** sRGB color for one overlay value, or null for no-data. */
export function overlayColor(id: OverlayId, value: number, domain: [number, number]): [number, number, number] | null {
  const def = OVERLAYS[id]
  if (def.valueKind === 'none' || !Number.isFinite(value)) return null
  if (def.valueKind === 'categorical') {
    const hex = RAMPS[def.ramp][Math.round(value)]
    return hex ? hexToRgb01(hex) : null
  }
  return rampColor(def.ramp, normalize(value, domain))
}

/** 0..1 strength of the color-independent cue for a value (0 = no pattern). */
export function cueLevel(id: OverlayId, value: number, domain: [number, number]): number {
  const def = OVERLAYS[id]
  if (!Number.isFinite(value) || def.valueKind !== 'continuous') return 0
  const t = normalize(value, domain)
  return def.cue.follows === 'inverse' ? 1 - t : t
}

const fmt = (v: number, unit: string) => {
  const abs = Math.abs(v)
  const s = abs >= 100 ? v.toFixed(0) : abs >= 10 ? v.toFixed(1).replace(/\.0$/, '') : v.toFixed(2).replace(/0$/, '').replace(/\.0$/, '')
  return unit && unit !== 'index' ? `${s} ${unit}` : s
}

/** Legend with numeric labels for the current domain ("Low (0 mm)" etc). */
export function resolveLegend(id: OverlayId, domain: [number, number]): OverlayLegendStop[] {
  const def = OVERLAYS[id]
  if (def.valueKind !== 'continuous') return def.legend
  return def.legend.map((s) => {
    const v = domain[0] + (domain[1] - domain[0]) * s.t
    const isTop = s.t === 1 && def.domain.kind !== 'range'
    return { ...s, label: `${s.label} (${fmt(v, def.unit)}${isTop ? '+' : ''})` }
  })
}

export interface OverlayTextures {
  /** RGBA8 sRGB colors per cell, alpha 255 where the cell has a value. */
  color: Uint8Array
  /** R: cue level 0..255, G: category code, B: 255 where the cell has a value. */
  cue: Uint8Array
  domain: [number, number]
}

/** Pack overlay colors and cue levels into per-cell texture data. */
export function buildOverlayTextures(id: OverlayId, values: Float32Array, domain: [number, number], target?: OverlayTextures): OverlayTextures {
  const n = values.length
  const color = target?.color && target.color.length === n * 4 ? target.color : new Uint8Array(n * 4)
  const cue = target?.cue && target.cue.length === n * 4 ? target.cue : new Uint8Array(n * 4)
  const def = OVERLAYS[id]
  for (let i = 0; i < n; i++) {
    const v = values[i]
    const c = overlayColor(id, v, domain)
    const o = i * 4
    if (c) {
      color[o] = Math.round(c[0] * 255)
      color[o + 1] = Math.round(c[1] * 255)
      color[o + 2] = Math.round(c[2] * 255)
      color[o + 3] = 255
    } else {
      color[o] = color[o + 1] = color[o + 2] = 0
      color[o + 3] = 0
    }
    cue[o] = Math.round(cueLevel(id, v, domain) * 255)
    cue[o + 1] = def.valueKind === 'categorical' && Number.isFinite(v) ? Math.round(v) : 0
    cue[o + 2] = c ? 255 : 0
    cue[o + 3] = 255
  }
  return { color, cue, domain }
}
