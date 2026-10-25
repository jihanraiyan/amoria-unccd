// Livestock pressure on pasture. Herds grow with the town (more slowly than the population),
// and graze the fodder land: pasture, fodder trees in agroforestry, crop residues, forest
// browse and wetland grass. When the herd outgrows the fodder land, pasture is overgrazed:
// grass cover falls and soil wears out faster (see soil.landPressure and vegetation.runVegetation).
// The starting pasture is taken to be in balance with the starting homes full, so on the
// starting landscape the pressure is at most 1 and the spin-up balance, the business-as-usual
// twin and a valley left alone are unchanged.
import { AGRI } from '../params'
import type { WorldLayers } from '../types'
import { C, S, clamp } from './cells'

/** Fodder land in grassland-equivalent cells. */
export function fodderUnits(layers: WorldLayers): number {
  const f = AGRI.livestock.value.fodder
  let units = 0
  for (let i = 0; i < layers.cover.length; i++) {
    if (layers.structure[i] !== S.none) continue
    const c = layers.cover[i]
    if (c === C.grassland) units += f.grassland
    else if (c === C.agroforestry) units += f.agroforestry
    else if (c === C.cropland) units += f.cropland
    else if (c === C.forest) units += f.forest
    else if (c === C.wetland) units += f.wetland
  }
  return units
}

/**
 * Grazing pressure = (herd / reference herd) / (fodder land / starting fodder land), with
 * herd / reference herd = (population / reference population)^elasticity. The reference
 * population is the one the starting pasture is in balance with (the starting homes full, see
 * engine/season). Bounded to [1 / maxPressure, maxPressure]; 1 when the baseline is unknown
 * (older saves).
 */
export function grazingPressure(layers: WorldLayers, population: number, referencePopulation: number, baselineFodder: number | undefined): number {
  const lv = AGRI.livestock.value
  if (!baselineFodder || baselineFodder <= 0 || referencePopulation <= 0) return 1
  const herd = Math.pow(Math.max(0, population) / referencePopulation, lv.herdElasticity)
  const fodder = fodderUnits(layers) / baselineFodder
  if (fodder <= 0) return lv.maxPressure
  return clamp(herd / fodder, 1 / lv.maxPressure, lv.maxPressure)
}

/** Overgrazing excess above 1 (0 when the herd fits the fodder land). */
export const overgrazing = (pressure: number): number => Math.max(0, pressure - 1)

/** Multiplier on the grazing soil loss of pasture. */
export const grazingSoilMult = (pressure: number): number => 1 + AGRI.livestock.value.soilPressurePerExcess * overgrazing(pressure)

/** Multiplier on the grass cover target of pasture. */
export const grazingCoverMult = (pressure: number): number => 1 / (1 + AGRI.livestock.value.coverLossPerExcess * overgrazing(pressure))
