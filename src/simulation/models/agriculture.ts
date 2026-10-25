// Agriculture: Harvest = area x potential yield x soil factor x water factor x management
// factor x event factor (SPEC 7.5). Every factor comes from simulation state:
//   soil factor   <- soil health (models/soil)
//   water factor  <- FAO-33 yield response to relative ET from hydrology: 1 - Ky (1 - ETa/ETm)
//   management    <- intensity and conservation chosen by the player, scaled down when the
//                    budget could not fund the farm program (shortage)
//   event factor  <- flooding and sediment burial this season (environmental conditions)
// Expansion (more area) and intensification (higher management factor, more water and input
// cost, faster soil decline) are therefore genuinely different strategies.
// Agroforestry grows a smaller staple crop and, once trees mature, tree products.
// Grassland is grazed: it yields livestock value for herding households (no staple food),
// scaled by grass cover and soil, so converting pasture has a livelihood cost. Standing forest
// gives households fuelwood, fodder and wild foods, scaled by canopy cover.
import { AGRI, ECON } from '../params'
import type { Season, Terrain, WorldLayers } from '../types'
import { C, INTENSITY_KEYS, S, cellHa, clamp } from './cells'
import { cropActive } from './hydrology'

export interface AgricultureInput {
  terrain: Terrain
  layers: WorldLayers
  season: Season
  waterFactor: Float32Array
  flooded: Uint8Array
  sedimentIn: Float32Array
  /** Last step's service level: below 1 the farm input program was only partly funded. */
  serviceLevel: number
}

export interface AgricultureOutput {
  yieldT: Float32Array
  foodT: number
  cropValue: number
  treeProductValue: number
  inputCost: number
  /** Active cropped cells by intensity. */
  activeByIntensity: [number, number, number]
  cropCells: number
  agroforestryCells: number
  activeCropCells: number
  irrigatedActiveCells: number
  matureAgroforestryCells: number
  floodedCropCells: number
  meanSoilFactor: number
  meanWaterFactor: number
  meanManagementFactor: number
  meanEventFactor: number
  meanRainfedWaterFactor: number
  /** Livestock value from grazing grassland this season, currency (to households, not levied). */
  grazingValue: number
  /** Fuelwood, fodder and wild-food value from standing forest this season, currency (to households, not levied). */
  forestProductValue: number
  /** Sum over active crop cells of area x potential (t), the yield ceiling. */
  potentialT: number
  marketCount: number
  priceMultiplier: number
}

export const soilFactor = (soilHealth: number): number => {
  const f = AGRI.soilFactor.value
  return clamp(f.intercept + f.slope * soilHealth, f.intercept, f.max)
}

/** FAO-33 yield response to water: 1 - Ky (1 - ETa/ETm), bounded to 0..1. */
export const waterYieldFactor = (relativeEt: number, ky: number): number => clamp(1 - ky * (1 - relativeEt), 0, 1)

export function managementFactor(intensity: number, conservation: number, serviceLevel: number): number {
  const m = AGRI.management.value
  const full = m[INTENSITY_KEYS[intensity] ?? 'medium']
  const funded = m.low + (full - m.low) * clamp(serviceLevel, 0, 1)
  return funded * (conservation ? AGRI.conservationYieldMult.value : 1)
}

export function eventFactor(flooded: number, sedimentT: number): number {
  let f = flooded ? AGRI.floodedYieldMult.value : 1
  const s = AGRI.sediment.value
  if (sedimentT > s.thresholdT) f *= 1 - Math.min(s.maxLoss, (sedimentT - s.thresholdT) * s.lossPerT)
  return f
}

/** Tree product ramp 0..1 by agroforestry age in seasons. */
export function treeProductRamp(coverAge: number): number {
  const t = AGRI.treeProduct.value
  return clamp((coverAge - t.startAge) / (t.fullAge - t.startAge), 0, 1)
}

export function runAgriculture(input: AgricultureInput): AgricultureOutput {
  const { terrain, layers, season, waterFactor, flooded, sedimentIn, serviceLevel } = input
  const n = layers.cover.length
  const ha = cellHa(terrain)
  const yieldT = new Float32Array(n)
  let markets = 0
  for (let i = 0; i < n; i++) if (layers.structure[i] === S.market) markets++
  const mk = ECON.market.value
  const priceMultiplier = 1 + mk.priceBoost * Math.min(markets, mk.maxMarkets)
  const price = AGRI.cropPrice.value * priceMultiplier
  const potential = AGRI.potentialT.value[season]
  let food = 0
  let tree = 0
  let inputCost = 0
  const byInt: [number, number, number] = [0, 0, 0]
  let cropCells = 0
  let agroCells = 0
  let active = 0
  let irrigatedActive = 0
  let matureAgro = 0
  let floodedCrop = 0
  let sSoil = 0
  let sWater = 0
  let sMgmt = 0
  let sEvent = 0
  let sRainfed = 0
  let nRainfed = 0
  let potentialT = 0
  let grazing = 0
  let forestProducts = 0
  const gz = AGRI.grazing.value
  const fp = AGRI.forestProducts.value
  for (let i = 0; i < n; i++) {
    const c = layers.cover[i]
    if (c === C.forest && layers.structure[i] === S.none) {
      forestProducts += fp.valuePerHa * ha * clamp(layers.vegetation[i] / fp.fullVegetation, 0, 1)
      continue
    }
    if (c === C.grassland && layers.structure[i] === S.none) {
      grazing += gz.valuePerHa * ha * clamp(layers.vegetation[i] / gz.fullVegetation, 0, 1) * soilFactor(layers.soilHealth[i]) * (flooded[i] ? AGRI.floodedYieldMult.value : 1)
      continue
    }
    if (c !== C.cropland && c !== C.agroforestry) continue
    if (c === C.cropland) cropCells++
    else agroCells++
    const isActive = cropActive(c, layers.irrigated[i], season)
    const ev = eventFactor(flooded[i], sedimentIn[i])
    if (c === C.agroforestry) {
      const ramp = treeProductRamp(layers.coverAge[i])
      if (ramp >= 1) matureAgro++
      // trees tap deeper water: product value only mildly sensitive to the season's water
      const tp = AGRI.treeProduct.value
      tree += tp.valuePerHa * ha * ramp * (1 - tp.waterSensitivity + tp.waterSensitivity * waterFactor[i]) * soilFactor(layers.soilHealth[i]) * ev
    }
    if (!isActive) continue
    active++
    if (flooded[i]) floodedCrop++
    const fs = soilFactor(layers.soilHealth[i])
    const fw = waterYieldFactor(waterFactor[i], c === C.agroforestry ? AGRI.kyAgroforestryCrop.value : AGRI.ky.value)
    let fm: number
    if (c === C.cropland) {
      fm = managementFactor(layers.intensity[i], layers.conservation[i], serviceLevel)
      byInt[layers.intensity[i]]++
      // billed in proportion to the share of the input program actually delivered,
      // matching the management interpolation (low intensity costs 0)
      inputCost += AGRI.inputCost.value[INTENSITY_KEYS[layers.intensity[i]] ?? 'medium'] * ha * clamp(serviceLevel, 0, 1)
      if (layers.irrigated[i]) irrigatedActive++
      else {
        sRainfed += waterFactor[i]
        nRainfed++
      }
    } else {
      fm = AGRI.agroforestryCropMult.value
    }
    const y = ha * potential * fs * fw * fm * ev
    yieldT[i] = y
    food += y
    potentialT += ha * potential
    sSoil += fs
    sWater += fw
    sMgmt += fm
    sEvent += ev
  }
  const k = Math.max(1, active)
  return {
    yieldT,
    foodT: food,
    cropValue: food * price,
    treeProductValue: tree * priceMultiplier,
    inputCost,
    activeByIntensity: byInt,
    cropCells,
    agroforestryCells: agroCells,
    activeCropCells: active,
    irrigatedActiveCells: irrigatedActive,
    matureAgroforestryCells: matureAgro,
    floodedCropCells: floodedCrop,
    meanSoilFactor: active ? sSoil / k : 0,
    meanWaterFactor: active ? sWater / k : 0,
    meanManagementFactor: active ? sMgmt / k : 0,
    meanEventFactor: active ? sEvent / k : 1,
    meanRainfedWaterFactor: nRainfed ? sRainfed / nRainfed : 1,
    grazingValue: grazing,
    forestProductValue: forestProducts,
    potentialT,
    marketCount: markets,
    priceMultiplier,
  }
}
