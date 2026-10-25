// What one parcel earned its households in a simulated season. It repeats the engine's own
// per-parcel formulas (models/agriculture) on the layers and step fields of that season, so the
// parcels add up to the season totals the engine recorded (HistoryPoint.farmValue and friends).
import { eventFactor, soilFactor, treeProductRamp } from '../../simulation/models/agriculture'
import { C, S, cellHa, clamp } from '../../simulation/models/cells'
import { AGRI, ECON } from '../../simulation/params'
import type { StepFields, Terrain, WorldLayers } from '../../simulation/types'

export interface ParcelValue {
  kind: 'crop' | 'agroforestry' | 'grazing' | 'forest' | 'none'
  /** Staple crop sold, currency (before the cooperative levy). */
  crop: number
  /** Agroforestry fruit, fodder and timber, currency (before the levy). */
  trees: number
  /** Livestock from grazing (to herding households, no levy). */
  grazing: number
  /** Fuelwood, fodder and wild food from standing forest (to households, no levy). */
  forest: number
  total: number
}

const marketMultiplier = (layers: WorldLayers): number => {
  let markets = 0
  for (let i = 0; i < layers.structure.length; i++) if (layers.structure[i] === S.market) markets++
  const mk = ECON.market.value
  return 1 + mk.priceBoost * Math.min(markets, mk.maxMarkets)
}

/** Per-parcel earnings for the season that produced `fields`, read with that season's `layers`. */
export function parcelValue(terrain: Terrain, layers: WorldLayers, fields: StepFields, i: number): ParcelValue {
  const ha = cellHa(terrain)
  const c = layers.cover[i]
  const free = layers.structure[i] === S.none
  const out: ParcelValue = { kind: 'none', crop: 0, trees: 0, grazing: 0, forest: 0, total: 0 }
  if (c === C.forest && free) {
    const fp = AGRI.forestProducts.value
    out.kind = 'forest'
    out.forest = fp.valuePerHa * ha * clamp(layers.vegetation[i] / fp.fullVegetation, 0, 1)
  } else if (c === C.grassland && free) {
    const gz = AGRI.grazing.value
    out.kind = 'grazing'
    out.grazing =
      gz.valuePerHa * ha * clamp(layers.vegetation[i] / gz.fullVegetation, 0, 1) * soilFactor(layers.soilHealth[i]) * (fields.flooded[i] ? AGRI.floodedYieldMult.value : 1)
  } else if (c === C.cropland || c === C.agroforestry) {
    const mult = marketMultiplier(layers)
    out.kind = c === C.cropland ? 'crop' : 'agroforestry'
    out.crop = fields.yieldT[i] * AGRI.cropPrice.value * mult
    if (c === C.agroforestry) {
      const tp = AGRI.treeProduct.value
      const ev = eventFactor(fields.flooded[i], fields.sedimentIn[i])
      out.trees =
        tp.valuePerHa * ha * treeProductRamp(layers.coverAge[i]) * (1 - tp.waterSensitivity + tp.waterSensitivity * fields.waterFactor[i]) * soilFactor(layers.soilHealth[i]) * ev * mult
    }
  }
  out.total = out.crop + out.trees + out.grazing + out.forest
  return out
}
