// Summary metrics of a finished playthrough, computed only from recorded history and state.
import { evaluateObjectives, resilienceMeasures } from '../../scenarios/guided'
import type { SimulationState } from '../../types'

export interface StrategyMetrics {
  netWorth: number
  budget: number
  debt: number
  cumFoodT: number
  endSoil: number
  hillsideSoil: number
  endWellbeing: number
  endPopulation: number
  endHousingAdequacy: number
  cumOutletSedimentT: number
  minWaterSecurity: number
  meanWaterSecurity: number
  endFoodSecurity: number
  forestFrac: number
  floodedHousingCum: number
  droughtYieldRatio: number
  droughtValueRatio: number
  heavyRainSettlementRatio: number
  heavyRainOutflowM3: number
  /** Mean quick runoff from the hillsides in heavy-rain wet seasons, mm. */
  heavyRainUpstreamRunoffMm: number
  droughtTownWater: number
  /** Mean river flow passing the waterworks intakes in drought seasons, m3. */
  droughtIntakeFlowM3: number
  heavyRainPeakRatio: number
  heavyRainSedimentT: number
  budgetYear3: number
  minServiceLevel: number
  worstDroughtSecurity: number
  /** Mean household livelihood over the game (the levy lowers it). */
  meanLivelihood: number
  floodedHomesRatio: number
  erosionRatio: number
  heavyRainFloodedCells: number
  goalsMet: string[]
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)

export function metrics(s: SimulationState): StrategyMetrics {
  const h = s.history.slice(1)
  const last4 = h.slice(-4)
  const wetNormal = h.filter((p) => p.season === 'wet' && (p.weather === 'normal' || p.weather === 'favorable'))
  const wetDrought = h.filter((p) => p.season === 'wet' && p.weather === 'drought')
  const heavy = h.filter((p) => p.weather === 'heavy-rain' && p.season === 'wet')
  const r = resilienceMeasures(s)
  return {
    netWorth: s.economy.budget - s.economy.debt,
    budget: s.economy.budget,
    debt: s.economy.debt,
    cumFoodT: h.reduce((a, p) => a + p.foodProducedT, 0),
    endSoil: s.totals.meanSoilHealth,
    hillsideSoil: s.diagnostics.hillsideCropSoil,
    endWellbeing: mean(last4.map((p) => p.wellbeing)),
    endPopulation: s.community.population,
    endHousingAdequacy: s.community.housingAdequacy,
    cumOutletSedimentT: h.reduce((a, p) => a + p.outletSedimentT, 0),
    minWaterSecurity: Math.min(...h.map((p) => p.waterSecurity)),
    meanWaterSecurity: mean(h.map((p) => p.waterSecurity)),
    endFoodSecurity: mean(last4.map((p) => p.foodSecurity)),
    forestFrac: s.totals.forestCoverFrac,
    floodedHousingCum: h.reduce((a, p) => a + p.floodedHousingCells, 0),
    droughtYieldRatio: mean(wetDrought.map((p) => p.foodProducedT)) / Math.max(1, mean(wetNormal.map((p) => p.foodProducedT))),
    heavyRainPeakRatio: mean(heavy.map((p) => p.peakFloodRatio)),
    droughtValueRatio: mean(wetDrought.map((p) => p.farmValue)) / Math.max(1, mean(wetNormal.map((p) => p.farmValue))),
    heavyRainSettlementRatio: mean(heavy.map((p) => p.settlementFloodRatio)),
    heavyRainOutflowM3: mean(heavy.map((p) => p.outflowM3)),
    heavyRainUpstreamRunoffMm: mean(heavy.map((p) => p.upstreamRunoffMm)),
    droughtTownWater: mean(h.filter((p) => p.weather === 'drought').map((p) => p.waterSecurity)),
    droughtIntakeFlowM3: mean(h.filter((p) => p.weather === 'drought').map((p) => p.intakeFlowM3)),
    heavyRainSedimentT: mean(heavy.map((p) => p.outletSedimentT)),
    budgetYear3: h[5]?.budget ?? 0,
    minServiceLevel: Math.min(...h.map((p) => p.serviceLevel)),
    worstDroughtSecurity: r.worstDroughtSecurity,
    meanLivelihood: mean(h.map((p) => p.livelihood)),
    floodedHomesRatio: r.floodedHomesRatio,
    erosionRatio: r.erosionRatio,
    heavyRainFloodedCells: mean(heavy.map((p) => p.floodedCells)),
    goalsMet: evaluateObjectives(s).filter((o) => o.met).map((o) => o.id),
  }
}
