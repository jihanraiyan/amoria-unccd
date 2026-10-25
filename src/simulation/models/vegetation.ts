// Vegetation: protective cover grows toward a land-use target limited by water and soil, with
// restoration maturity driven by coverAge (VEG.matureSeasons: planted forest takes about 10
// years, agroforestry 6, wetlands 3). Young plantings keep a grass and herb understory on the
// ground their canopy does not yet cover (VEG.understory). Under water stress cover dies back toward the lower target; trees resist
// drought better than crops and grass, but young plantings can fail in severe drought.
// Bare land left alone long enough regrows into grassland (natural succession).
import { grazingCoverMult } from './grazing'
import { VEG } from '../params'
import type { Season, WorldLayers } from '../types'
import { C, S, clamp } from './cells'
import { cropActive } from './hydrology'

/** Restoration maturity 0..1 from seasons since the cover was established. */
export function maturity(cover: number, coverAge: number): number {
  const m = VEG.matureSeasons.value
  const seasons = cover === C.forest ? m.forest : cover === C.agroforestry ? m.agroforestry : cover === C.wetland ? m.wetland : m.other
  return clamp(coverAge / seasons, 0, 1)
}

type TargetKey = keyof typeof VEG.target.value

function targetKey(cover: number, structure: number, irrigated: number, conservation: number, season: Season): TargetKey | null {
  if (structure === S.road) return 'road'
  if (structure !== S.none && structure !== S.reservoir) return 'housing'
  switch (cover) {
    case C.forest:
      return 'forest'
    case C.grassland:
      return 'grassland'
    case C.cropland:
      return cropActive(cover, irrigated, season) ? 'cropland' : conservation ? 'fallowConservation' : 'fallow'
    case C.agroforestry:
      return 'agroforestry'
    case C.wetland:
      return 'wetland'
    case C.bare:
      return 'bare'
    case C.urban:
      return 'housing'
    default:
      return null
  }
}

/** Share of the mature cover a restoration planting has reached (1 for other covers). */
export function canopyShare(cover: number, coverAge: number): number {
  if (cover !== C.forest && cover !== C.agroforestry && cover !== C.wetland) return 1
  const est = VEG.establishFrac.value[cover === C.forest ? 'forest' : cover === C.agroforestry ? 'agroforestry' : 'wetland']
  return est + (1 - est) * maturity(cover, coverAge)
}

/** Unconstrained target cover (before water and soil limits) for a cell this season. */
export function baseTarget(cover: number, structure: number, irrigated: number, conservation: number, coverAge: number, season: Season): number {
  const key = targetKey(cover, structure, irrigated, conservation, season)
  if (!key) return 0
  const t = VEG.target.value[key][season]
  if (cover === C.forest || cover === C.agroforestry || cover === C.wetland) {
    const canopy = canopyShare(cover, coverAge)
    // the herb layer holds the ground the young canopy does not yet cover
    return t * canopy + (1 - canopy) * VEG.understory.value.share * VEG.target.value.grassland[season]
  }
  return t
}

export interface VegetationOutput {
  vegetation: Float32Array
  cover: Uint8Array
  coverAge: Uint16Array
  /** Cells that reverted from bare to grassland this step. */
  succeeded: number[]
}

export function runVegetation(layers: WorldLayers, waterFactor: Float32Array, season: Season, channel: Uint8Array, grazingPressure = 1): VegetationOutput {
  const grazedMult = grazingCoverMult(grazingPressure)
  const n = layers.cover.length
  const veg = layers.vegetation.slice()
  const cover = layers.cover.slice()
  const coverAge = layers.coverAge.slice()
  const succeeded: number[] = []
  const wl = VEG.waterLimit.value
  const sl = VEG.soilLimit.value
  const gr = VEG.growthRate.value
  const dr = VEG.diebackRate.value
  const ytl = VEG.youngTreeDroughtLoss.value
  for (let i = 0; i < n; i++) {
    const c = cover[i]
    if (channel[i] || c === C.water || layers.structure[i] === S.reservoir) {
      veg[i] = 0
      continue
    }
    const wf = waterFactor[i]
    const irrigatedCrop = c === C.cropland && layers.irrigated[i] === 1
    const waterMult = irrigatedCrop ? 1 : wl.floor + (1 - wl.floor) * wf
    const soilMult = sl.floor + (1 - sl.floor) * clamp(layers.soilHealth[i] / sl.full, 0, 1)
    let target = baseTarget(c, layers.structure[i], layers.irrigated[i], layers.conservation[i], layers.coverAge[i], season)
    // crops respond to water through yields; their cover still follows the stress signal
    target *= (irrigatedCrop ? 1 : waterMult) * soilMult
    // overgrazed pasture holds less grass
    if (c === C.grassland && layers.structure[i] === S.none) target *= grazedMult
    const isTree = c === C.forest || c === C.agroforestry
    // the herb understory of a young planting grows and dies back at herb rates
    const canopy = canopyShare(c, layers.coverAge[i])
    const g = isTree ? canopy * gr.trees + (1 - canopy) * gr.herbs : c === C.wetland ? gr.wetland : gr.herbs
    const d = isTree ? canopy * dr.trees + (1 - canopy) * dr.herbs : c === C.wetland ? dr.wetland : dr.herbs
    let v = veg[i]
    v += v < target ? g * (target - v) : -d * (v - target)
    if (isTree && wf < ytl.waterFactor && maturity(c, layers.coverAge[i]) < 0.5) v -= ytl.loss
    veg[i] = clamp(v, 0, 1)
    coverAge[i] = Math.min(65535, layers.coverAge[i] + 1)
    const sc = VEG.succession.value
    if (c === C.bare && layers.structure[i] === S.none && coverAge[i] >= sc.minAge && veg[i] >= sc.minVeg && layers.soilHealth[i] >= sc.minSoil) {
      cover[i] = C.grassland
      coverAge[i] = 0
      succeeded.push(i)
    }
  }
  return { vegetation: veg, cover, coverAge, succeeded }
}
