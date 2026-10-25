// History: one compact HistoryPoint per step for charts and comparison, and a full Snapshot
// (layers and fields copied, terrain shared) for scrubbing and side-by-side futures.
import type { HistoryPoint, Season, SimulationState, Snapshot, WeatherSeason, WorldLayers, StepFields } from '../types'

export function copyLayers(l: WorldLayers): WorldLayers {
  return {
    baselineCover: l.baselineCover.slice(),
    cover: l.cover.slice(),
    structure: l.structure.slice(),
    structureLevel: l.structureLevel.slice(),
    intensity: l.intensity.slice(),
    conservation: l.conservation.slice(),
    irrigated: l.irrigated.slice(),
    coverAge: l.coverAge.slice(),
    soilHealth: l.soilHealth.slice(),
    soilMoistureMm: l.soilMoistureMm.slice(),
    vegetation: l.vegetation.slice(),
    groundwaterMm: l.groundwaterMm.slice(),
    wetlandStoreMm: l.wetlandStoreMm.slice(),
  }
}

export function copyFields(f: StepFields): StepFields {
  return {
    infiltrationMm: f.infiltrationMm.slice(),
    runoffMm: f.runoffMm.slice(),
    flowMm: f.flowMm.slice(),
    erosion: f.erosion.slice(),
    sedimentIn: f.sedimentIn.slice(),
    yieldT: f.yieldT.slice(),
    waterFactor: f.waterFactor.slice(),
    etMm: f.etMm.slice(),
    irrigationMm: f.irrigationMm.slice(),
    sedimentFlux: f.sedimentFlux.slice(),
    flooded: f.flooded.slice(),
    floodDepthM: f.floodDepthM.slice(),
  }
}

const countIrrigated = (l: WorldLayers) => {
  let k = 0
  for (let i = 0; i < l.irrigated.length; i++) if (l.irrigated[i] && l.cover[i] === 2) k++
  return k
}

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0)

/** History point for the season whose outcomes `state` now holds. */
export function makeHistoryPoint(state: SimulationState, year: number, season: Season, w: Pick<WeatherSeason, 'kind' | 'rainfallMm' | 'stormIntensity'>): HistoryPoint {
  const { totals: t, community: c, economy: e, diagnostics: d, layers } = state
  const r = state.reference.last
  let veg = 0
  let land = 0
  for (let i = 0; i < layers.vegetation.length; i++) {
    if (state.terrain.channel[i]) continue
    veg += layers.vegetation[i]
    land++
  }
  return {
    year,
    season,
    weather: w.kind,
    rainfallMm: w.rainfallMm,
    budget: e.budget,
    debt: e.debt,
    population: c.population,
    housingCapacity: c.housingCapacity,
    foodProducedT: t.foodProducedT,
    foodDemandT: t.foodDemandT,
    foodSecurity: c.foodSecurity,
    waterSecurity: c.waterSecurity,
    meanSoilHealth: t.meanSoilHealth,
    forestCoverFrac: t.forestCoverFrac,
    meanErosion: t.meanErosion,
    outletSedimentT: t.outletSedimentT,
    wellbeing: c.wellbeing,
    income: sum(e.income),
    expenses: sum(e.expenses),
    step: state.step,
    stormIntensity: w.stormIntensity,
    housingAdequacy: c.housingAdequacy,
    livelihood: c.livelihood,
    hazardExposure: c.hazardExposure,
    serviceLevel: e.serviceLevel,
    cropAreaHa: t.cropAreaHa,
    activeCropCells: d.activeCropCells,
    meanCropSoilFactor: d.meanSoilFactor,
    meanCropWaterFactor: d.meanWaterFactor,
    meanCropManagementFactor: d.meanManagementFactor,
    meanCropEventFactor: d.meanEventFactor,
    hillsideCropSoil: d.hillsideCropSoil,
    totalErosionT: t.totalErosionT,
    floodedCells: t.floodedCells,
    floodedHousingCells: t.floodedHousingCells,
    reservoirFillFrac: d.reservoirFillFrac,
    irrigationSupplyRatio: t.irrigationDemandM3 > 0 ? t.irrigationSuppliedM3 / t.irrigationDemandM3 : 1,
    outflowM3: t.outflowM3,
    treeProductValue: d.treeProductValue,
    meanVegetation: land ? veg / land : 0,
    arrivals: c.arrivals,
    departures: c.departures,
    peakFloodRatio: d.peakFloodRatio,
    settlementFloodRatio: d.settlementFloodRatio,
    farmValue: d.cropValue + d.treeProductValue,
    upstreamRunoffMm: d.upstreamRunoffMm,
    irrigatedCells: countIrrigated(layers),
    intakeFlowM3: d.intakeFlowM3,
    meanGroundwaterMm: d.meanGroundwaterMm,
    homeGroundwaterMm: d.homeGroundwaterMm,
    selfSupplyShare: t.townWaterDemandM3 > 0 ? t.selfSupplyM3 / t.townWaterDemandM3 : 0,
    pipedShare: t.townWaterDemandM3 > 0 ? t.pipedWaterM3 / t.townWaterDemandM3 : 0,
    grazingValue: t.grazingValue,
    forestProductValue: t.forestProductValue ?? 0,
    reservoirM3: state.reservoirM3,
    refTotalErosionT: r.totalErosionT,
    refOutletSedimentT: r.outletSedimentT,
    refUpstreamRunoffMm: r.upstreamRunoffMm,
    refSettlementFloodRatio: r.settlementFloodRatio,
    refFloodedHousingCells: r.floodedHousingCells,
    refMeanSoilHealth: r.meanSoilHealth,
    foodSelfSufficiency: c.foodSelfSufficiency ?? 1,
    foodImportCost: c.foodImportCost ?? 0,
    grazingPressure: d.grazingPressure ?? 1,
  }
}

export function makeSnapshot(state: SimulationState, year: number, season: Season): Snapshot {
  return {
    year,
    season,
    layers: copyLayers(state.layers),
    fields: copyFields(state.fields),
    community: structuredClone(state.community),
    economy: structuredClone(state.economy),
    totals: { ...state.totals },
    reservoirM3: state.reservoirM3,
    reservoirSiltM3: state.reservoirSiltM3,
  }
}
