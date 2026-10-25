// Soil: a RUSLE-inspired erosion index, downstream sediment routing with deposition, and a
// bounded, lagged soil health index.
//
// Erosion index A = R * K * LS * C * P (Wischmeier and Smith 1978; Renard et al. 1997)
// computed per cell per season in GAME TONNES PER HA. The structure and the direction of each
// factor follow RUSLE; the magnitudes are scaled for play and are not validated soil loss.
//   R: seasonal rain (mm) * storm intensity * erosivityPerMm, times a bounded run-on factor
//      when more surface water arrives from upslope than under business as usual (MUSLE idea)
//   K: base erodibility, higher on degraded soil
//   LS: Moore and Burch (1986) unit-stream-power form with a capped slope length
//   C: cover-management, exponential in protective vegetation, with a land-use floor
//   P: support practice: the Wischmeier and Smith contouring table by slope, tree rows
// Sediment leaves each cell in flowOrder; each receiving cell deposits a share (trap) that is
// high on flat, well vegetated land, wetlands and reservoirs (the connectivity idea used by
// InVEST SDR), and zero in channels. Everything not deposited leaves at the outlet.
import { grazingSoilMult } from './grazing'
import { SOIL } from '../params'
import type { Terrain, WeatherSeason, WorldLayers } from '../types'
import { C, COVER_KEYS, INTENSITY_KEYS, S, clamp } from './cells'
import { cropActive } from './hydrology'

/** Moisture multiplier on soil recovery: floor + (1 - floor) x water factor (SOIL.recoveryMoisture). */
export const recoveryMoisture = (waterFactor: number): number => {
  const f = SOIL.recoveryMoisture.value.floor
  return f + (1 - f) * waterFactor
}

/** Share of a cell that is roofed or paved (cannot erode). */
export function sealedShare(cover: number, structure: number, level: number): number {
  const sh = SOIL.sealedShare.value
  if (structure === S.housing) return sh.housing[level] ?? sh.housing[1]
  if (structure === S.road) return sh.road
  if (structure === S.market) return sh.market
  if (structure === S.waterworks) return sh.waterworks
  if (cover === C.urban) return sh.urban
  return 0
}

/** Cover-management factor C for a cell. Built cells erode only on their unsealed share. */
export function coverFactor(cover: number, structure: number, intensity: number, vegetation: number, level = 1): number {
  if (cover === C.water || structure === S.reservoir) return 0
  const sealed = sealedShare(cover, structure, level)
  let cMin = SOIL.cMin.value[COVER_KEYS[cover]] ?? 0.2
  if (cover === C.cropland) cMin = SOIL.cIntensity.value[INTENSITY_KEYS[intensity] ?? 'medium']
  if (sealed > 0) cMin = SOIL.cMin.value.grassland
  return (1 - sealed) * (cMin + (1 - cMin) * Math.exp(-SOIL.cCoverDecay.value * clamp(vegetation, 0, 1)))
}

/** Contour-practice P for a slope (rise/run): the AH-537 table, linear between class midpoints. */
export function contouringP(slope: number): number {
  const t = SOIL.pContouring.value
  const steep = SOIL.pSteepLimit.value
  if (slope <= t[0][0]) return t[0][1]
  for (let k = 1; k < t.length; k++) {
    if (slope <= t[k][0]) {
      const [s0, p0] = t[k - 1]
      const [s1, p1] = t[k]
      return p0 + ((p1 - p0) * (slope - s0)) / (s1 - s0)
    }
  }
  const [sl, pl] = t[t.length - 1]
  if (slope >= steep.slope) return steep.p
  return pl + ((steep.p - pl) * (slope - sl)) / (steep.slope - sl)
}

/** Support practice factor P. */
export function practiceFactor(cover: number, conservation: number, slope: number): number {
  if (cover === C.cropland && conservation) return contouringP(slope)
  if (cover === C.agroforestry) return SOIL.pAgroforestry.value
  return 1
}

/**
 * Run-on multiplier on the erosion index (MUSLE idea: erosive energy grows with runoff).
 * Compares surface water on the cell with the business-as-usual twin under the same weather.
 * The cell's own runoff is taken from the twin on both sides, because the cell's own cover is
 * already in C; only extra water arriving from upslope raises the factor.
 */
export function runOnFactor(ownRefRunoffMm: number, inflowMm: number, refInflowMm: number): number {
  const r = SOIL.runoffErosion.value
  const num = ownRefRunoffMm + inflowMm + r.offsetMm
  const den = ownRefRunoffMm + refInflowMm + r.offsetMm
  return clamp(Math.pow(num / den, r.exponent), r.min, r.max)
}

/** Moore and Burch (1986) LS factor with slope length capped at lsMaxContribCells. */
export function lsFactor(slope: number, flowAccumulation: number, cellSizeM: number): number {
  const { m, n } = SOIL.lsExponents.value
  const as = Math.min(flowAccumulation, SOIL.lsMaxContribCells.value) * cellSizeM
  const sinB = Math.sin(Math.atan(slope))
  return Math.pow(as / 22.13, m) * Math.pow(sinB / 0.0896, n)
}

/** Smooth ceiling on the erosion index: identity below the knee, then bending toward the ceiling. Strictly increasing. */
export function softCapErosion(a: number): number {
  const knee = SOIL.maxErosion.value
  const ceiling = SOIL.erosionCeiling.value
  if (a <= knee) return a
  const span = ceiling - knee
  return knee + span * (1 - Math.exp(-(a - knee) / span))
}

/** Share of a soil health loss that applies at this soil health (1 on healthy soil, 0 at the floor). */
export function lossTaper(soilHealth: number): number {
  const d = soilHealth - SOIL.bounds.value.min
  return d <= 0 ? 0 : 1 - Math.exp(-d / SOIL.lossTaper.value)
}

export function erodibility(soilHealth: number): number {
  const k = SOIL.erodibility.value
  return k.base * (k.degraded + (k.healthy - k.degraded) * clamp(soilHealth, 0, 1))
}

/** Soil health a cover tends toward when undisturbed. */
export function soilMax(cover: number, conservation: number): number {
  if (cover === C.cropland && conservation) return SOIL.maxHealthConservation.value
  return SOIL.maxHealth.value[COVER_KEYS[cover]] ?? 0.6
}

/** Soil health lost per season from land use itself (cropping intensity, grazing), before recovery. */
export function landPressure(cover: number, irrigated: number, intensity: number, conservation: number, season: WeatherSeason['season'], grazing = 1): number {
  if (cover === C.cropland && cropActive(cover, irrigated, season)) {
    const pressure = SOIL.intensityPressure.value[INTENSITY_KEYS[intensity] ?? 'medium']
    return pressure * (conservation ? SOIL.conservationPressureMult.value : 1)
  }
  if (cover === C.grassland) return SOIL.grazingPressure.value * grazingSoilMult(grazing)
  return 0
}

/** Sediment trap share of reservoirs from the capacity-to-inflow ratio (Brune-curve shape). */
export function reservoirTrapShare(r?: { capacityM3: number; inflowM3: number }): number {
  if (!r) return SOIL.trap.value.reservoir
  const t = SOIL.reservoirTrap.value
  const ratio = r.inflowM3 > 0 ? r.capacityM3 / r.inflowM3 : 10
  return (t.max * ratio) / (ratio + t.halfRatio)
}

export interface SoilInput {
  terrain: Terrain
  layers: WorldLayers
  weather: WeatherSeason
  rainMm: Float32Array
  /** 0..1 water factor from hydrology (recovery needs moisture). */
  waterFactor: Float32Array
  /** Optional per-cell run-on multiplier on erosion (1 when omitted, as for the reference run). */
  runOnFactor?: Float32Array
  /** Reservoir storage capacity and season inflow, m3 (trap share follows their ratio). Omitted: fixed trap share. */
  reservoir?: { capacityM3: number; inflowM3: number }
  /** Livestock pressure on pasture (models/grazing); 1 when omitted. */
  grazingPressure?: number
}

export interface SoilOutput {
  erosion: Float32Array
  sedimentIn: Float32Array
  sedimentFlux: Float32Array
  soilHealth: Float32Array
  outletSedimentT: number
  reservoirSiltT: number
  totalErosionT: number
  /** Deposited sediment total (land, wetland and reservoir), game tonnes. */
  depositedT: number
}

export function runSoil(input: SoilInput): SoilOutput {
  const { terrain, layers, weather, rainMm, waterFactor, runOnFactor: runOn } = input
  const resTrap = reservoirTrapShare(input.reservoir)
  const n = terrain.width * terrain.height
  const { cover, structure, intensity, conservation, vegetation, soilHealth, irrigated } = layers
  const erosion = new Float32Array(n)
  const ha = (terrain.cellSizeM * terrain.cellSizeM) / 10_000
  let totalErosion = 0
  for (let i = 0; i < n; i++) {
    if (terrain.channel[i] || cover[i] === C.water || structure[i] === S.reservoir) continue
    const r = SOIL.erosivityPerMm.value * rainMm[i] * weather.stormIntensity * (runOn ? runOn[i] : 1)
    const a =
      r *
      erodibility(soilHealth[i]) *
      lsFactor(terrain.slope[i], terrain.flowAccumulation[i], terrain.cellSizeM) *
      coverFactor(cover[i], structure[i], intensity[i], vegetation[i], layers.structureLevel[i]) *
      practiceFactor(cover[i], conservation[i], terrain.slope[i])
    erosion[i] = softCapErosion(a)
    totalErosion += erosion[i] * ha
  }

  // sediment routing
  const tp = SOIL.trap.value
  const incoming = new Float64Array(n)
  const sedimentIn = new Float32Array(n)
  const sedimentFlux = new Float32Array(n)
  let outlet = 0
  let reservoirSilt = 0
  let deposited = 0
  for (let o = 0; o < n; o++) {
    const i = terrain.flowOrder[o]
    let trap: number
    if (structure[i] === S.reservoir) trap = resTrap
    else if (terrain.channel[i] || cover[i] === C.water) trap = 0
    else if (cover[i] === C.wetland) trap = tp.wetland
    else if (structure[i] !== S.none) trap = tp.urban
    else trap = (tp.landBase + tp.landVeg * vegetation[i]) * Math.exp(-terrain.slope[i] / tp.slopeScale)
    const dep = incoming[i] * trap
    sedimentIn[i] = dep
    deposited += dep
    if (structure[i] === S.reservoir) reservoirSilt += dep
    const out = incoming[i] - dep + erosion[i] * ha
    sedimentFlux[i] = out
    const t = terrain.flowTo[i]
    if (t >= 0) incoming[t] += out
    else outlet += out
  }

  // soil health: erosion loss, intensity pressure, recovery toward the cover maximum
  const next = soilHealth.slice()
  const b = SOIL.bounds.value
  for (let i = 0; i < n; i++) {
    const c = cover[i]
    if (terrain.channel[i] || c === C.water || structure[i] === S.reservoir) continue
    if (c === C.urban || structure[i] !== S.none) continue // sealed soil does not change
    let sh = soilHealth[i]
    const loss = (SOIL.healthLossPerT.value * erosion[i] + landPressure(c, irrigated[i], intensity[i], conservation[i], weather.season, input.grazingPressure ?? 1)) * lossTaper(sh)
    // the taper keeps losses from crossing the floor in one season except in extreme storms
    sh -= Math.min(loss, 0.9 * Math.max(0, sh - b.min))
    const max = soilMax(c, conservation[i])
    const moist = recoveryMoisture(waterFactor[i])
    if (sh < max) sh += SOIL.recoveryRate.value * vegetation[i] * moist * (max - sh)
    else sh -= SOIL.conversionDecline.value * (sh - max)
    next[i] = clamp(sh, b.min, b.max)
  }
  return {
    erosion,
    sedimentIn,
    sedimentFlux,
    soilHealth: next,
    outletSedimentT: outlet,
    reservoirSiltT: reservoirSilt,
    totalErosionT: totalErosion,
    depositedT: deposited,
  }
}
