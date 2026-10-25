// One simulated season, in the explicit order of SPEC 7.9:
//   1. exogenous weather and demographic conditions (passed in, generated at start)
//   2. hydrology: water inputs, local retention, routing, withdrawals, flooding
//   3. erosion and sediment routing; soil health update
//   4. vegetation update (growth, dieback, restoration maturity, succession)
//   5. agricultural production
//   6. economy: revenue, costs, budget, shortages
//   7. population and community outcomes
//   8. totals and diagnostics (explanations and snapshots are built by the caller)
// Each quantity is produced once by one module and consumed downstream, so nothing is
// double counted.
//
// Alongside the player's valley the engine runs a business-as-usual twin: the starting land
// use with no decisions, through the same weather (its soil, vegetation and water still evolve).
// The twin is the reference for run-on erosion, the resilience goals and the flood, erosion
// and downstream-sediment explanations, which cite its same-weather values as the effect of
// the weather and the difference from it as the effect of land changes ("what would have
// happened here without the changes you made"). It never reads player state.
import { AGRI, COMMUNITY, ECON, HYDRO, SOIL } from '../params'
import type { DemographySeason, ReferenceOutcome, ReferenceRun, SimulationState, StepDiagnostics, StepFields, Totals, WeatherSeason, WorldLayers } from '../types'
import { runAgriculture, type AgricultureOutput } from '../models/agriculture'
import { C, S, cellHa, clamp } from '../models/cells'
import { housingCapacity, residentsPerHome, runCommunity } from '../models/community'
import { arrivalRateFactor, levyRateOf, runEconomy, taxPerResidentAt } from '../models/economy'
import { runHydrology, type HydrologyOutput } from '../models/hydrology'
import { contouringP, runOnFactor, runSoil, type SoilOutput } from '../models/soil'
import { maturity, runVegetation } from '../models/vegetation'
import { grazingPressure } from '../models/grazing'
import { intakeSedimentConc, pipedWaterQuality } from '../models/waterQuality'

export interface SeasonOutcome {
  layers: WorldLayers
  fields: StepFields
  economy: SimulationState['economy']
  community: SimulationState['community']
  totals: Totals
  ledger: SimulationState['ledger']
  reservoirM3: number
  reservoirSiltM3: number
  diagnostics: StepDiagnostics
  hydro: HydrologyOutput
  soil: SoilOutput
  agri: AgricultureOutput
  /** Cells that reverted from bare to grassland. */
  succeeded: number[]
  /** Business-as-usual twin after this season. */
  reference: ReferenceRun
  /** Twin hydrology this season (for explanations). */
  refHydro: HydrologyOutput
}

export function reservoirCapacityM3(layers: WorldLayers, siltM3: number): number {
  let cells = 0
  for (let i = 0; i < layers.structure.length; i++) if (layers.structure[i] === S.reservoir) cells++
  return Math.max(0, cells * HYDRO.reservoir.value.capacityM3PerCell - siltM3)
}

/** Cells that carry a soil (not channel, lake or reservoir). */
export const isLandCell = (state: Pick<SimulationState, 'terrain'>, layers: WorldLayers, i: number): boolean =>
  !state.terrain.channel[i] && layers.cover[i] !== C.water && layers.structure[i] !== S.reservoir

/** Housing cells flooded this step. */
function floodedHomes(layers: WorldLayers, flooded: Uint8Array): number {
  let k = 0
  for (let i = 0; i < flooded.length; i++) if (flooded[i] && layers.structure[i] === S.housing) k++
  return k
}

/** Population the starting pasture is in balance with: the starting homes full (with the usual overcrowding allowance). */
const herdReference = (state: SimulationState): number => state.baseline.housingCapacity * COMMUNITY.overcrowding.value

/** Mean soil health over land cells. */
function meanSoil(state: Pick<SimulationState, 'terrain'>, layers: WorldLayers): number {
  let s = 0
  let k = 0
  for (let i = 0; i < layers.cover.length; i++) {
    if (!isLandCell(state, layers, i)) continue
    s += layers.soilHealth[i]
    k++
  }
  return k ? s / k : 0
}

interface TwinStep {
  reference: ReferenceRun
  hydro: HydrologyOutput
}

/**
 * True when the twin is provably the player's valley: the same layer object and the same stores,
 * population and service level. Only the frozen pre-game year can be in this state (any action
 * or played season gives the player new layer arrays), and there the twin's season would repeat
 * the player's season exactly, so it is not run twice.
 */
function twinIsPlayer(state: SimulationState): boolean {
  const ref = state.reference
  return (
    ref.layers === state.layers &&
    ref.reservoirM3 === state.reservoirM3 &&
    ref.reservoirSiltM3 === state.reservoirSiltM3 &&
    ref.population === state.community.population &&
    state.economy.serviceLevel === 1
  )
}

/** One season of the business-as-usual twin (same models, no decisions). */
function stepReference(state: SimulationState, w: WeatherSeason, frozen: boolean): TwinStep {
  const { terrain } = state
  const ref = state.reference
  const L0 = ref.layers
  const hydro = runHydrology({
    terrain,
    layers: L0,
    weather: w,
    reservoirM3: ref.reservoirM3,
    reservoirCapacityM3: reservoirCapacityM3(L0, ref.reservoirSiltM3),
    townDemandM3: ref.population * HYDRO.townUseM3PerPersonSeason.value,
    serviceLevel: 1,
    groundwaterRefMm: state.baseline.groundwaterRefMm,
  })
  const L1: WorldLayers = { ...L0, soilMoistureMm: hydro.soilMoistureMm, groundwaterMm: hydro.groundwaterMm, wetlandStoreMm: hydro.wetlandStoreMm }
  const graze = grazingPressure(L0, ref.population, herdReference(state), state.baseline.fodderUnits)
  const soil = runSoil({
    terrain,
    layers: L1,
    weather: w,
    rainMm: hydro.rainMm,
    waterFactor: hydro.waterFactor,
    reservoir: { capacityM3: reservoirCapacityM3(L0, ref.reservoirSiltM3), inflowM3: hydro.reservoirInflowM3 },
    grazingPressure: graze,
  })
  return referenceFrom(state, w, frozen, hydro, soil, L1, graze)
}

/** The twin's state after a season, given its hydrology and soil results and its layers with updated water stores. */
function referenceFrom(state: SimulationState, w: WeatherSeason, frozen: boolean, hydro: HydrologyOutput, soil: SoilOutput, L1: WorldLayers, graze: number): TwinStep {
  const { terrain } = state
  const ref = state.reference
  let L = L1
  if (!frozen) {
    const L2 = { ...L1, soilHealth: soil.soilHealth }
    const veg = runVegetation(L2, hydro.waterFactor, w.season, terrain.channel, graze)
    L = { ...L2, vegetation: veg.vegetation, cover: veg.cover, coverAge: veg.coverAge }
  }
  const last: ReferenceOutcome = {
    totalErosionT: soil.totalErosionT,
    outletSedimentT: soil.outletSedimentT,
    upstreamRunoffMm: hydro.uplandRunoffMm,
    settlementFloodRatio: hydro.settlementFloodRatio,
    peakFloodRatio: hydro.peakFloodRatio,
    floodedHousingCells: floodedHomes(L, hydro.flooded),
    meanSoilHealth: meanSoil(state, L),
    outflowM3: hydro.outflowM3,
  }
  return {
    reference: {
      ...ref,
      layers: L,
      reservoirM3: hydro.reservoirM3,
      reservoirSiltM3: frozen ? ref.reservoirSiltM3 : ref.reservoirSiltM3 + soil.reservoirSiltT / SOIL.siltDensityTPerM3.value,
      runoffMm: hydro.runoffMm,
      surfaceInMm: hydro.surfaceInMm,
      erosion: soil.erosion,
      last,
    },
    hydro,
  }
}

export function simulateSeason(state: SimulationState, w: WeatherSeason, d: DemographySeason, frozen: boolean): SeasonOutcome {
  const { terrain } = state
  const layers0 = state.layers
  const n = terrain.width * terrain.height
  const pop0 = state.community.population
  const siltBefore = state.reservoirSiltM3
  const cal = state.calibration

  // 1b. the business-as-usual twin under the same weather (shared with the player's season
  // when the twin is provably the same valley, see twinIsPlayer)
  const separateTwin = !(frozen && twinIsPlayer(state))
  const twinRun = separateTwin ? stepReference(state, w, frozen) : null

  // 2. hydrology
  const hydro = runHydrology({
    terrain,
    layers: layers0,
    weather: w,
    reservoirM3: state.reservoirM3,
    reservoirCapacityM3: reservoirCapacityM3(layers0, siltBefore),
    townDemandM3: pop0 * HYDRO.townUseM3PerPersonSeason.value,
    serviceLevel: state.economy.serviceLevel,
    groundwaterRefMm: state.baseline.groundwaterRefMm,
  })
  const L1: WorldLayers = { ...layers0, soilMoistureMm: hydro.soilMoistureMm, groundwaterMm: hydro.groundwaterMm, wetlandStoreMm: hydro.wetlandStoreMm }

  // 3. erosion (with run-on relative to the twin), sediment, soil health; livestock pressure on
  // pasture from this season's town and fodder land
  const graze = grazingPressure(layers0, pop0, herdReference(state), state.baseline.fodderUnits)
  let runOn: Float32Array | undefined
  if (twinRun) {
    runOn = new Float32Array(n)
    for (let i = 0; i < n; i++) runOn[i] = runOnFactor(twinRun.hydro.runoffMm[i], hydro.surfaceInMm[i], twinRun.hydro.surfaceInMm[i])
  }
  const soil = runSoil({
    terrain,
    layers: L1,
    weather: w,
    rainMm: hydro.rainMm,
    waterFactor: hydro.waterFactor,
    runOnFactor: runOn,
    reservoir: { capacityM3: reservoirCapacityM3(layers0, siltBefore), inflowM3: hydro.reservoirInflowM3 },
    grazingPressure: graze,
  })
  const twin = twinRun ?? referenceFrom(state, w, frozen, hydro, soil, L1, graze)
  const L2: WorldLayers = frozen ? L1 : { ...L1, soilHealth: soil.soilHealth }
  const siltM3 = siltBefore + soil.reservoirSiltT / SOIL.siltDensityTPerM3.value

  // 4. vegetation
  const veg = runVegetation(L2, hydro.waterFactor, w.season, terrain.channel, graze)
  const L3: WorldLayers = frozen ? L2 : { ...L2, vegetation: veg.vegetation, cover: veg.cover, coverAge: veg.coverAge }

  // 5. agriculture
  const agri = runAgriculture({
    terrain,
    layers: L3,
    season: w.season,
    waterFactor: hydro.waterFactor,
    flooded: hydro.flooded,
    sedimentIn: soil.sedimentIn,
    serviceLevel: state.economy.serviceLevel,
  })

  // water treatment turbidity at intakes
  let intakeSed = 0
  for (const c of new Set(hydro.intakeCells)) intakeSed += soil.sedimentFlux[c]
  const tb = ECON.turbidity.value
  const conc = intakeSedimentConc(intakeSed, hydro.intakeFlowM3)
  const waterQuality = pipedWaterQuality(conc)
  const intakeTurbidity = 1 + Math.min(tb.max, tb.costPerTPer1000M3 * conc)

  // 6. economy
  const econ = runEconomy({
    levy: levyRateOf(state.economy, cal.levy),
    taxPerResident: taxPerResidentAt(levyRateOf(state.economy, cal.levy), cal.levy),
    terrain,
    layers: L3,
    economy: state.economy,
    population: pop0,
    cropValue: agri.cropValue,
    treeProductValue: agri.treeProductValue,
    inputCost: agri.inputCost,
    marketCount: agri.marketCount,
    townSuppliedM3: hydro.townSuppliedM3,
    irrigationSuppliedM3: hydro.irrigationSuppliedM3,
    intakeTurbidity,
    flooded: hydro.flooded,
  })
  const economy = frozen ? { ...state.economy, income: econ.economy.income, expenses: econ.economy.expenses } : econ.economy

  // 7. community
  const capPer = residentsPerHome(cal.householdScale)
  let floodedCap = 0
  let floodedHousingCells = 0
  let sedHaz = 0
  let housingCells = 0
  for (let i = 0; i < n; i++) {
    if (L3.structure[i] !== S.housing) continue
    housingCells++
    sedHaz += clamp(soil.sedimentIn[i] / COMMUNITY.sedimentHazardT.value, 0, 1)
    if (hydro.flooded[i]) {
      floodedCap += capPer[L3.structureLevel[i]] ?? 0
      floodedHousingCells++
    }
  }
  const cap = housingCapacity(L3, cal.householdScale)
  const ref = state.baseline
  const season = w.season
  const refOut = ref.referenceOutflowM3[season]
  const refSed = ref.referenceSedimentT[season]
  let wetlandCells = 0
  for (let i = 0; i < n; i++) if (L3.cover[i] === C.wetland) wetlandCells++
  const dx = COMMUNITY.downstreamIndex.value
  const dsWater = refOut > 0 ? clamp(hydro.outflowM3 / refOut, 0, 1) : 1
  const dsHazard = clamp(
    dx.sedimentWeight * clamp(soil.outletSedimentT / Math.max(1, dx.sedimentFullHazardMult * refSed), 0, 1) +
      dx.floodWeight * clamp((hydro.peakFloodRatio - 1) / dx.floodFullHazardExcess, 0, 1),
    0,
    1,
  )
  const dsIncome =
    clamp((dx.wetlandWeight * clamp(wetlandCells / Math.max(1, ref.wetlandCells), 0, dx.wetlandCap)) / dx.wetlandCap + dx.flowWeight * dsWater, 0, 1) * (1 - dx.hazardIncomeLoss * dsHazard)
  const comm = runCommunity({
    prev: state.community,
    layers: L3,
    demography: d,
    foodNowT: agri.foodT,
    foodPrevT: state.totals.foodProducedT,
    townDemandM3: hydro.townDemandM3,
    townSuppliedM3: hydro.householdSuppliedM3,
    selfSuppliedM3: hydro.selfSuppliedM3,
    waterQuality,
    waterworks: countStructure(L3, S.waterworks),
    householdScale: cal.householdScale,
    // farm and herding income smoothed over the two-season window (households live on a yearly harvest)
    farmHouseholdIncome: 0.5 * (econ.farmHouseholdIncome + agri.grazingValue + agri.forestProductValue + prevFarmIncome(state, agri.priceMultiplier)),
    floodedHousingShare: cap > 0 ? floodedCap / cap : 0,
    floodedCropShare: agri.activeCropCells > 0 ? agri.floodedCropCells / agri.activeCropCells : 0,
    droughtStress: agri.activeCropCells > 0 ? 1 - agri.meanWaterFactor : 0,
    sedimentHazard: housingCells > 0 ? sedHaz / housingCells : 0,
    irrigationSupplyRatio: hydro.irrigationDemandM3 > 0 ? hydro.irrigationSuppliedM3 / hydro.irrigationDemandM3 : 1,
    downstream: { waterAccess: dsWater, hazard: dsHazard, income: dsIncome },
    frozen,
    foodPerPersonT: AGRI.foodPerPersonT.value,
    // tax paid above the starting rate comes out of household income; newcomers are put off
    extraTax: pop0 * (taxPerResidentAt(levyRateOf(state.economy, cal.levy), cal.levy) - ECON.housingTaxPerResident.value),
    arrivalFactor: arrivalRateFactor(levyRateOf(state.economy, cal.levy), cal.levy),
  })

  // 8. fields, totals, diagnostics
  const fields: StepFields = {
    infiltrationMm: hydro.infiltrationMm,
    runoffMm: hydro.runoffMm,
    flowMm: hydro.flowMm,
    erosion: soil.erosion,
    sedimentIn: soil.sedimentIn,
    yieldT: agri.yieldT,
    waterFactor: hydro.waterFactor,
    etMm: hydro.etMm,
    irrigationMm: hydro.irrigationMm,
    sedimentFlux: soil.sedimentFlux,
    flooded: hydro.flooded,
    floodDepthM: hydro.floodDepthM,
  }
  const resCap = reservoirCapacityM3(L3, siltM3)
  const totals = deriveTotals(state, L3, fields, {
    foodT: agri.foodT,
    foodPrevT: state.totals.foodProducedT,
    foodDemandT: pop0 * AGRI.foodPerPersonT.value,
    foodImportedT: comm.foodImportedT,
    hydro,
    outletSedimentT: soil.outletSedimentT,
    totalErosionT: soil.totalErosionT,
    reservoirCapacityM3: resCap,
    floodedHousingCells,
    grazingValue: agri.grazingValue,
    forestProductValue: agri.forestProductValue,
  })
  const diagnostics = { ...buildDiagnostics(state, L3, fields, agri, hydro, intakeTurbidity, resCap, hydro.reservoirM3), grazingPressure: graze }

  return {
    layers: L3,
    fields,
    economy,
    community: comm.community,
    totals,
    ledger: hydro.ledger,
    reservoirM3: hydro.reservoirM3,
    reservoirSiltM3: frozen ? siltBefore : siltM3,
    diagnostics,
    hydro,
    soil,
    agri,
    succeeded: frozen ? [] : veg.succeeded,
    reference: twin.reference,
    refHydro: twin.hydro,
  }
}

function countStructure(layers: WorldLayers, st: number): number {
  let k = 0
  for (let i = 0; i < layers.structure.length; i++) if (layers.structure[i] === st) k++
  return k
}

/** Farm and herding household income of the previous step, from its recorded production. */
function prevFarmIncome(state: SimulationState, priceMultiplier: number): number {
  const value = state.totals.foodProducedT * AGRI.cropPrice.value * priceMultiplier + state.diagnostics.treeProductValue
  return value * (1 - levyRateOf(state.economy, state.calibration.levy)) + (state.totals.grazingValue ?? 0) + (state.totals.forestProductValue ?? 0)
}

/** Forest and wetland cells plus half of agroforestry cells. */
export function naturalCover(layers: WorldLayers): number {
  let k = 0
  for (let i = 0; i < layers.cover.length; i++) {
    const c = layers.cover[i]
    if (c === C.forest || c === C.wetland) k += 1
    else if (c === C.agroforestry) k += 0.5
  }
  return k
}

interface TotalsExtra {
  foodT: number
  foodPrevT: number
  foodDemandT: number
  foodImportedT: number
  hydro: HydrologyOutput
  outletSedimentT: number
  totalErosionT: number
  reservoirCapacityM3: number
  floodedHousingCells: number
  grazingValue: number
  forestProductValue: number
}

/** Totals derived from layers and fields (tests recompute these independently). */
export function deriveTotals(state: Pick<SimulationState, 'terrain'>, layers: WorldLayers, fields: StepFields, x: TotalsExtra): Totals {
  const n = layers.cover.length
  const ha = cellHa(state.terrain)
  let land = 0
  let soilSum = 0
  let forest = 0
  let erosionSum = 0
  let flooded = 0
  let crop = 0
  let agro = 0
  let urban = 0
  let wetland = 0
  for (let i = 0; i < n; i++) {
    const c = layers.cover[i]
    if (c === C.cropland) crop++
    else if (c === C.agroforestry) agro++
    else if (c === C.urban) urban++
    else if (c === C.wetland) wetland++
    if (fields.flooded[i]) flooded++
    if (!isLandCell(state, layers, i)) continue
    land++
    soilSum += layers.soilHealth[i]
    erosionSum += fields.erosion[i]
    if (c === C.forest) forest++
  }
  const h = x.hydro
  return {
    foodProducedT: x.foodT,
    foodDemandT: x.foodDemandT,
    waterSupplyM3: h.householdSuppliedM3 + h.irrigationSuppliedM3,
    waterDemandM3: h.townDemandM3 + h.irrigationDemandM3,
    meanSoilHealth: land ? soilSum / land : 0,
    forestCoverFrac: land ? forest / land : 0,
    meanErosion: land ? erosionSum / land : 0,
    outletSedimentT: x.outletSedimentT,
    floodedCells: flooded,
    foodProducedPrevT: x.foodPrevT,
    foodImportedT: x.foodImportedT,
    townWaterDemandM3: h.townDemandM3,
    townWaterSuppliedM3: h.householdSuppliedM3,
    irrigationDemandM3: h.irrigationDemandM3,
    irrigationSuppliedM3: h.irrigationSuppliedM3,
    outflowM3: h.outflowM3,
    reservoirCapacityM3: x.reservoirCapacityM3,
    cropAreaHa: crop * ha,
    agroforestryAreaHa: agro * ha,
    urbanCells: urban,
    wetlandCells: wetland,
    totalErosionT: x.totalErosionT,
    floodedHousingCells: x.floodedHousingCells,
    naturalCover: naturalCover(layers),
    pipedWaterM3: h.townSuppliedM3,
    selfSupplyM3: h.selfSuppliedM3,
    grazingValue: x.grazingValue,
    forestProductValue: x.forestProductValue,
  }
}

function buildDiagnostics(
  state: SimulationState,
  layers: WorldLayers,
  fields: StepFields,
  agri: AgricultureOutput,
  hydro: HydrologyOutput,
  intakeTurbidity: number,
  resCap: number,
  resM3: number,
): StepDiagnostics {
  const n = layers.cover.length
  const sens = SOIL.sensitiveSlope.value
  let hillSoil = 0
  let hillN = 0
  let cropEro = 0
  let cropN = 0
  let young = 0
  let mature = 0
  let pSum = 0
  let pN = 0
  for (let i = 0; i < n; i++) {
    const c = layers.cover[i]
    if (c === C.cropland) {
      cropEro += fields.erosion[i]
      cropN++
      if (state.terrain.slope[i] > sens) {
        hillSoil += layers.soilHealth[i]
        hillN++
        if (layers.conservation[i]) {
          pSum += contouringP(state.terrain.slope[i])
          pN++
        }
      }
    }
    const restored = (c === C.forest || c === C.agroforestry || c === C.wetland) && layers.baselineCover[i] !== c
    if (restored) {
      if (maturity(c, layers.coverAge[i]) >= 1) mature++
      else young++
    }
  }
  return {
    cropCells: agri.cropCells,
    activeCropCells: agri.activeCropCells,
    meanSoilFactor: agri.meanSoilFactor,
    meanWaterFactor: agri.meanWaterFactor,
    meanManagementFactor: agri.meanManagementFactor,
    meanEventFactor: agri.meanEventFactor,
    hillsideCropSoil: hillN ? hillSoil / hillN : 0,
    hillsideCropCells: hillN,
    meanCropErosion: cropN ? cropEro / cropN : 0,
    matureAgroforestryCells: agri.matureAgroforestryCells,
    treeProductValue: agri.treeProductValue,
    youngRestorationCells: young,
    matureRestorationCells: mature,
    intakeTurbidity,
    reservoirFillFrac: resCap > 0 ? clamp(resM3 / resCap, 0, 1) : 0,
    floodedCropCells: agri.floodedCropCells,
    peakFloodRatio: hydro.peakFloodRatio,
    settlementFloodRatio: hydro.settlementFloodRatio,
    cropValue: agri.cropValue,
    upstreamRunoffMm: hydro.uplandRunoffMm,
    meanCropWaterFactorRainfed: agri.meanRainfedWaterFactor,
    meanGroundwaterMm: hydro.meanGroundwaterMm,
    homeGroundwaterMm: hydro.homeGroundwaterMm,
    grazingValue: agri.grazingValue,
    hillsideConservationP: pN ? pSum / pN : 1,
    hillsideConservationCells: pN,
    intakeFlowM3: hydro.intakeFlowM3,
  }
}
