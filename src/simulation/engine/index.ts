// Public simulation engine. Pure functions: inputs are never mutated; each call returns new
// state. Signatures follow SimulationEngine in ../types.ts.
import { AGRI, CALIBRATION, CLIMATE, COMMUNITY, ECON, HYDRO, SOIL, SPINUP, TIME } from '../params'
import { STREAM, signed, stream } from '../rng'
import {
  type ActionValidation,
  type Community,
  type PlayerAction,
  type ReferenceRun,
  type ScenarioCalibration,
  type StepDiagnostics,
  type Terrain,
  type SimulationEngine,
  type SimulationState,
  type StepFields,
  type StepResult,
  type Totals,
  type WaterLedger,
  type WeatherSeason,
  type WorldInput,
  type WorldLayers,
} from '../types'
import { demographyForStep, generateDemography } from '../events/demography'
import { generateWeather, seasonValues, weatherForStep } from '../events/weather'
import { C, COVER_KEYS, S, clamp } from '../models/cells'
import { applyFinance } from '../models/economy'
import { fodderUnits } from '../models/grazing'
import { bankfullFromReference, runHydrology, soilCapacityMm } from '../models/hydrology'
import { applyLandUse, validateLandUse } from '../models/landUse'
import { landPressure, lossTaper, recoveryMoisture, runSoil, soilMax } from '../models/soil'
import { baseTarget, runVegetation } from '../models/vegetation'
import { housingCapacity, residentsPerHome } from '../models/community'
import { explainStart, explainStep } from './explain'
import { makeHistoryPoint, makeSnapshot } from './history'
import { naturalCover, reservoirCapacityM3, simulateSeason } from './season'
import { deriveTerrain } from './terrain'

export { deriveTerrain } from './terrain'

/** How many explanations the state keeps (older ones live on in history/snapshots). */
export const MAX_EXPLANATIONS = 120

export interface CreateOptions {
  horizonYears?: number
  /** Guided-scenario weather design (default on). Sandbox-only worlds may turn it off. */
  guidedWeather?: boolean
}

/** Normal-weather season used for spin-up and references (exactly the seasonal normals). */
export function referenceSeason(season: 'wet' | 'dry'): WeatherSeason {
  return { year: 0, season, kind: 'normal', designed: false, ...seasonValues(season, 'normal', { uRain: 0.5, uPet: 0.5, uInt: 0.5 }) }
}

const INITIAL_SOIL: Record<string, number> = {
  forest: 0.82,
  grassland: 0.66,
  cropland: 0.6,
  agroforestry: 0.72,
  urban: 0.5,
  wetland: 0.85,
  water: 0.5,
  bare: 0.32,
}

function emptyFields(n: number): StepFields {
  const f = () => new Float32Array(n)
  return {
    infiltrationMm: f(),
    runoffMm: f(),
    flowMm: f(),
    erosion: f(),
    sedimentIn: f(),
    yieldT: f(),
    waterFactor: new Float32Array(n).fill(1),
    etMm: f(),
    irrigationMm: f(),
    sedimentFlux: f(),
    flooded: new Uint8Array(n),
    floodDepthM: f(),
  }
}

const emptyTotals = (): Totals => ({
  foodProducedT: 0,
  foodDemandT: 0,
  waterSupplyM3: 0,
  waterDemandM3: 0,
  meanSoilHealth: 0,
  forestCoverFrac: 0,
  meanErosion: 0,
  outletSedimentT: 0,
  floodedCells: 0,
  foodProducedPrevT: 0,
  foodImportedT: 0,
  townWaterDemandM3: 0,
  townWaterSuppliedM3: 0,
  irrigationDemandM3: 0,
  irrigationSuppliedM3: 0,
  outflowM3: 0,
  reservoirCapacityM3: 0,
  cropAreaHa: 0,
  agroforestryAreaHa: 0,
  urbanCells: 0,
  wetlandCells: 0,
  totalErosionT: 0,
  floodedHousingCells: 0,
  naturalCover: 0,
  pipedWaterM3: 0,
  selfSupplyM3: 0,
  grazingValue: 0,
  forestProductValue: 0,
})

const emptyDiagnostics = (): StepDiagnostics => ({
  cropCells: 0,
  activeCropCells: 0,
  meanSoilFactor: 0,
  meanWaterFactor: 0,
  meanManagementFactor: 0,
  meanEventFactor: 1,
  hillsideCropSoil: 0,
  hillsideCropCells: 0,
  meanCropErosion: 0,
  matureAgroforestryCells: 0,
  treeProductValue: 0,
  youngRestorationCells: 0,
  matureRestorationCells: 0,
  intakeTurbidity: 1,
  reservoirFillFrac: 0,
  floodedCropCells: 0,
  peakFloodRatio: 0,
  settlementFloodRatio: 0,
  cropValue: 0,
  upstreamRunoffMm: 0,
  meanCropWaterFactorRainfed: 1,
  meanGroundwaterMm: 0,
  homeGroundwaterMm: 0,
  grazingValue: 0,
  hillsideConservationP: 1,
  hillsideConservationCells: 0,
  intakeFlowM3: 0,
})

const emptyLedger = (): WaterLedger => ({
  rainMm: 0,
  infiltrationMm: 0,
  evapotranspirationMm: 0,
  storageChangeMm: 0,
  withdrawalsMm: 0,
  outflowMm: 0,
  wetlandRetentionMm: 0,
  reservoirStorageChangeMm: 0,
  groundwaterChangeMm: 0,
  irrigationMm: 0,
  residualMm: 0,
})

function initialLayers(world: WorldInput, seed: number, slope: Float32Array, channel: Uint8Array): WorldLayers {
  const n = world.width * world.height
  const rnd = stream(seed, STREAM.soil)
  const cover = world.cover.slice()
  for (let i = 0; i < n; i++) if (channel[i]) cover[i] = C.water
  const structure = world.structure?.slice() ?? new Uint8Array(n)
  const intensity = world.intensity?.slice() ?? new Uint8Array(n).fill(1)
  const irrigated = new Uint8Array(n)
  const soilHealth = new Float32Array(n)
  const vegetation = new Float32Array(n)
  const soilMoistureMm = new Float32Array(n)
  const groundwaterMm = new Float32Array(n)
  const wetlandStoreMm = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const c = cover[i]
    if (c === C.cropland && world.irrigated?.[i]) irrigated[i] = 1
    const base = INITIAL_SOIL[COVER_KEYS[c]] ?? 0.5
    const slopePenalty = c === C.forest || c === C.wetland ? 0.2 : 0.7
    soilHealth[i] = clamp(base - slopePenalty * slope[i] + 0.04 * signed(rnd), SOIL.bounds.value.min, SOIL.bounds.value.max)
    const water = channel[i] || c === C.water || structure[i] === S.reservoir
    if (water) continue
    const soilMult = 0.5 + 0.5 * clamp(soilHealth[i] / 0.6, 0, 1)
    vegetation[i] = baseTarget(c, structure[i], irrigated[i], 0, 60, 'dry') * soilMult
    soilMoistureMm[i] = 0.4 * soilCapacityMm(c, soilHealth[i])
    groundwaterMm[i] = 40
    if (c === C.wetland) wetlandStoreMm[i] = 120
  }
  return {
    baselineCover: cover.slice(),
    cover,
    structure,
    structureLevel: world.structureLevel?.slice() ?? new Uint8Array(n),
    intensity,
    conservation: new Uint8Array(n),
    irrigated,
    coverAge: new Uint16Array(n).fill(60),
    soilHealth,
    soilMoistureMm,
    vegetation,
    groundwaterMm,
    wetlandStoreMm,
  }
}

/**
 * Long-run erosivity of each season relative to a normal season: the expected value of
 * (rain multiplier x storm intensity) under the Markov weather chain, before scenario design.
 * Used so starting soil is in balance with the climate, not just with normal seasons.
 */
export function climateErosivity(): { wet: number; dry: number } {
  const kinds = CLIMATE.kinds.value
  const tr = CLIMATE.transition.value
  const mult = (k: keyof typeof kinds) => kinds[k].rain * kinds[k].intensity
  let pDrought = 0
  const acc = { wet: 0, dry: 0 }
  const SEASONS = 400
  for (let s = 0; s < SEASONS; s++) {
    const season = s % 2 === 0 ? 'wet' : 'dry'
    const a = tr[season].afterDrought
    const o = tr[season].otherwise
    const p = {
      drought: pDrought * a.drought + (1 - pDrought) * o.drought,
      'heavy-rain': pDrought * a['heavy-rain'] + (1 - pDrought) * o['heavy-rain'],
      favorable: pDrought * a.favorable + (1 - pDrought) * o.favorable,
    }
    const normal = 1 - p.drought - p['heavy-rain'] - p.favorable
    if (s >= SEASONS - 2) acc[season] = normal * mult('normal') + p.drought * mult('drought') + p['heavy-rain'] * mult('heavy-rain') + p.favorable * mult('favorable')
    pDrought = p.drought
  }
  return acc
}

const soilChanges = (terrain: Terrain, L: WorldLayers, i: number): boolean =>
  !terrain.channel[i] && L.cover[i] !== C.water && L.structure[i] === S.none && L.cover[i] !== C.urban

/**
 * Land spin-up: bring soil health and protective vegetation to balance with the starting land
 * use and the long-run climate. Each model year runs hydrology, the erosion index and the
 * vegetation model for a normal wet and dry season, then solves each cell's soil health for
 * the level where yearly losses (erosion scaled to the long-run erosivity, farming and grazing
 * pressure) equal recovery. Erodibility depends on soil health, so the solve is exact for that
 * linear dependence and repeated as vegetation adjusts.
 */
/**
 * Soil health where a season's recovery balances its losses: rec x (max - h) =
 * (alpha x K(h) + press) x lossTaper(h), with K(h) = kDegraded - delta x h. The left side falls
 * and the right side rises with h, so bisection on [floor, max] finds the single crossing. The
 * taper is 0 at the floor, so a cell with any recovery settles above it.
 */
export function equilibriumSoil(rec: number, alpha: number, press: number, max: number, kDegraded: number, delta: number): number {
  const lo0 = SOIL.bounds.value.min
  if (max <= lo0) return lo0
  const f = (h: number) => rec * (max - h) - (alpha * (kDegraded - delta * h) + press) * lossTaper(h)
  let lo = lo0
  let hi = max
  if (f(hi) >= 0) return max
  for (let it = 0; it < 40; it++) {
    const mid = 0.5 * (lo + hi)
    if (f(mid) > 0) lo = mid
    else hi = mid
  }
  return 0.5 * (lo + hi)
}

function spinUpLand(terrain: Terrain, layers: WorldLayers, townDemandM3: number, seed: number): WorldLayers {
  const n = terrain.width * terrain.height
  const clim = climateErosivity()
  const k = SOIL.erodibility.value
  const delta = k.degraded - k.healthy
  const b = SOIL.bounds.value
  let L = layers
  for (let y = 0; y < SPINUP.value.landYears; y++) {
    const alpha = new Float64Array(n)
    const press = new Float64Array(n)
    const rec = new Float64Array(n)
    for (const season of ['wet', 'dry'] as const) {
      const w = referenceSeason(season)
      const h = runHydrology({ terrain, layers: L, weather: w, reservoirM3: 0, reservoirCapacityM3: reservoirCapacityM3(L, 0), townDemandM3, serviceLevel: 1 })
      L = { ...L, soilMoistureMm: h.soilMoistureMm, groundwaterMm: h.groundwaterMm, wetlandStoreMm: h.wetlandStoreMm }
      const so = runSoil({ terrain, layers: L, weather: w, rainMm: h.rainMm, waterFactor: h.waterFactor })
      for (let i = 0; i < n; i++) {
        if (!soilChanges(terrain, L, i)) continue
        const kMult = k.degraded - delta * clamp(L.soilHealth[i], 0, 1)
        alpha[i] += (SOIL.healthLossPerT.value * clim[season] * so.erosion[i]) / kMult
        press[i] += landPressure(L.cover[i], L.irrigated[i], L.intensity[i], L.conservation[i], season)
        rec[i] += SOIL.recoveryRate.value * L.vegetation[i] * recoveryMoisture(h.waterFactor[i])
      }
      const veg = runVegetation(L, h.waterFactor, season, terrain.channel)
      L = { ...L, vegetation: veg.vegetation }
    }
    const sh = L.soilHealth.slice()
    for (let i = 0; i < n; i++) {
      if (!soilChanges(terrain, L, i)) continue
      sh[i] = equilibriumSoil(rec[i], alpha[i], press[i], soilMax(L.cover[i], L.conservation[i]), k.degraded, delta)
    }
    L = { ...L, soilHealth: sh }
  }
  // a little seeded texture (recovery is linear, so it does not bias the mean drift)
  const rnd = stream(seed, STREAM.soil)
  const sh = L.soilHealth.slice()
  for (let i = 0; i < n; i++) {
    const noise = signed(rnd)
    if (!soilChanges(terrain, L, i)) continue
    sh[i] = clamp(sh[i] + SPINUP_NOISE * noise, b.min, soilMax(L.cover[i], L.conservation[i]))
  }
  return { ...L, soilHealth: sh }
}

const SPINUP_NOISE = 0.015

function emptyReference(layers: WorldLayers, population: number, n: number): ReferenceRun {
  return {
    layers,
    reservoirM3: 0,
    reservoirSiltM3: 0,
    population,
    runoffMm: new Float32Array(n),
    surfaceInMm: new Float32Array(n),
    erosion: new Float32Array(n),
    last: { totalErosionT: 0, outletSedimentT: 0, upstreamRunoffMm: 0, settlementFloodRatio: 0, peakFloodRatio: 0, floodedHousingCells: 0, meanSoilHealth: 0, outflowM3: 0 },
  }
}

function makeCommunity(population: number, capacity: number): Community {
  const stake = { income: 0, waterAccess: 1, hazardExposure: 0, note: '' }
  return {
    population,
    housingCapacity: capacity,
    jobs: 0,
    housingAdequacy: 1,
    foodSecurity: 1,
    waterSecurity: 1,
    livelihood: 0.7,
    hazardExposure: 0,
    wellbeing: 0.7,
    stakeholders: { farmers: { ...stake }, townspeople: { ...stake }, downstream: { ...stake } },
    housingDemand: population,
    laborForce: population * COMMUNITY.laborForceShare.value,
    births: 0,
    arrivals: 0,
    departures: 0,
    wellbeingParts: { housing: 1, food: 1, water: 1, livelihood: 0.7, safety: 1 },
  }
}

/** A designed drought season at mid-range draws (used only by the calibration probe). */
function droughtSeason(season: 'wet' | 'dry'): WeatherSeason {
  return { year: 0, season, kind: 'drought', designed: false, ...seasonValues(season, 'drought', { uRain: 0.5, uPet: 0.5, uInt: 0.5 }) }
}

/** Run the frozen pre-game year (indicators only; land and population do not change). */
function frozenYear(
  state: SimulationState,
  seasons: WeatherSeason[] = [referenceSeason('wet'), referenceSeason('dry')],
): { state: SimulationState; income: Record<string, number>[]; expenses: Record<string, number>[]; foodT: number; foodBySeason: number[] } {
  let s = state
  const income: Record<string, number>[] = []
  const expenses: Record<string, number>[] = []
  const foodBySeason: number[] = []
  let foodT = 0
  for (const w of seasons) {
    const out = simulateSeason(s, w, { naturalGrowthRate: 0, migrationPressure: 0 }, true)
    s = { ...s, layers: out.layers, fields: out.fields, economy: out.economy, community: out.community, totals: out.totals, ledger: out.ledger, diagnostics: out.diagnostics, reservoirM3: out.reservoirM3, reference: out.reference }
    income.push(out.economy.income)
    expenses.push(out.economy.expenses)
    foodT += out.totals.foodProducedT
    foodBySeason.push(out.totals.foodProducedT)
  }
  return { state: s, income, expenses, foodT, foodBySeason }
}

const sumRec = (rs: Record<string, number>[], pick?: (k: string) => boolean) =>
  rs.reduce((a, r) => a + Object.entries(r).reduce((b, [k, v]) => b + (!pick || pick(k) ? v : 0), 0), 0)

export function createInitialState(world: WorldInput, seed: number, opts: CreateOptions = {}): SimulationState {
  const horizonYears = opts.horizonYears ?? TIME.horizonYears.value
  const terrain = deriveTerrain(world)
  const n = world.width * world.height
  const weather = generateWeather(seed, { guidedHorizonYears: opts.guidedWeather === false ? 0 : horizonYears })
  const demography = generateDemography(seed, weather.length)
  const use = HYDRO.townUseM3PerPersonSeason.value

  // 1. land spin-up: soil and vegetation in balance with the starting land use and climate
  const layers0 = initialLayers(world, seed, terrain.slope, terrain.channel)
  const pop1 = Math.round(housingCapacity(layers0, 1) * COMMUNITY.initialOccupancy.value)
  let L = spinUpLand(terrain, layers0, pop1 * use, seed)

  // 2. water spin-up: three normal years so soil water, groundwater and wetland stores start
  // near equilibrium, then references for bankfull capacity, the downstream "usual flow and
  // sediment" baselines and the normal groundwater level that wells are judged against.
  const wet = referenceSeason('wet')
  const dry = referenceSeason('dry')
  const refOut = { wet: 0, dry: 0 }
  const refSed = { wet: 0, dry: 0 }
  const refEro = { wet: 0, dry: 0 }
  let lastWet: ReturnType<typeof runHydrology> | null = null
  const gwRef = new Float32Array(n)
  const years = SPINUP.value.waterYears
  for (let s = 0; s < years * 2; s++) {
    const w = s % 2 === 0 ? wet : dry
    const h = runHydrology({ terrain, layers: L, weather: w, reservoirM3: 0, reservoirCapacityM3: reservoirCapacityM3(L, 0), townDemandM3: pop1 * use, serviceLevel: 1 })
    L = { ...L, soilMoistureMm: h.soilMoistureMm, groundwaterMm: h.groundwaterMm, wetlandStoreMm: h.wetlandStoreMm }
    const so = runSoil({ terrain, layers: L, weather: w, rainMm: h.rainMm, waterFactor: h.waterFactor })
    refOut[w.season] = h.outflowM3
    refSed[w.season] = so.outletSedimentT
    refEro[w.season] = so.totalErosionT
    if (w.season === 'wet') lastWet = h
    if (s >= years * 2 - 2) for (let i = 0; i < n; i++) gwRef[i] += 0.5 * h.groundwaterMm[i]
  }
  terrain.bankfullMm = bankfullFromReference(terrain, lastWet!)

  let land = 0
  let soilSum = 0
  let forest = 0
  let wetlands = 0
  let cropSoil = 0
  let crops = 0
  for (let i = 0; i < n; i++) {
    if (L.cover[i] === C.wetland) wetlands++
    if (L.cover[i] === C.cropland) {
      cropSoil += L.soilHealth[i]
      crops++
    }
    if (terrain.channel[i] || L.cover[i] === C.water) continue
    land++
    soilSum += L.soilHealth[i]
    if (L.cover[i] === C.forest) forest++
  }

  const cap1 = housingCapacity(L, 1)
  const baseCal: ScenarioCalibration = {
    householdScale: 1,
    residentsPerHome: residentsPerHome(1),
    levy: AGRI.levy.value,
    foodBalanceUnscaled: 1,
    foodBalance: 1,
    normalYearSurplus: 0,
  }
  let state: SimulationState = {
    version: 1,
    seed,
    meta: world.meta,
    terrain,
    layers: L,
    fields: emptyFields(n),
    step: 0,
    year: 1,
    season: 'wet',
    weather,
    economy: { budget: ECON.startBudget.value, debt: 0, income: {}, expenses: {}, serviceLevel: 1, unpaid: 0 },
    community: makeCommunity(pop1, cap1),
    totals: emptyTotals(),
    ledger: emptyLedger(),
    reservoirM3: 0,
    explanations: [],
    decisions: [],
    history: [],
    horizonYears,
    demography,
    reservoirSiltM3: 0,
    diagnostics: emptyDiagnostics(),
    baseline: {
      meanSoilHealth: land ? soilSum / land : 0,
      forestCoverFrac: land ? forest / land : 0,
      population: pop1,
      housingCapacity: cap1,
      budget: ECON.startBudget.value,
      wetlandCells: wetlands,
      meanCropSoilHealth: crops ? cropSoil / crops : 0,
      referenceOutflowM3: refOut,
      referenceSedimentT: refSed,
      referenceErosionT: refEro,
      naturalCover: naturalCover(L),
      groundwaterRefMm: gwRef,
    },
    calibration: baseCal,
    reference: emptyReference(L, pop1, n),
  }

  // 3. per-map calibration (game-balance, params.CALIBRATION): household size so a normal year
  // of the starting farmland feeds foodBalance x the residents, then the levy so the starting
  // village saves a fixed share of the starting fund in a normal year.
  // The drought probe (three designed drought seasons) also bounds the scale, so that on every
  // map the starting farms alone still grow droughtFoodBalance x need in the worst two seasons
  // of a long drought. Without it a map whose farms are generous in normal years but fragile in
  // drought starts with a drought goal no strategy can meet.
  const cb = CALIBRATION.value
  const probe = frozenYear(state)
  const need1 = 2 * pop1 * AGRI.foodPerPersonT.value
  const balance0 = need1 > 0 ? probe.foodT / need1 : 1
  const dProbe = frozenYear(state, [droughtSeason('wet'), droughtSeason('dry'), droughtSeason('wet')]).foodBySeason
  const worstPair = Math.min(dProbe[0] + dProbe[1], dProbe[1] + dProbe[2])
  const droughtBalance0 = need1 > 0 ? worstPair / need1 : 1
  const scaleNormal = balance0 / cb.foodBalance
  const scaleDrought = droughtBalance0 / cb.droughtFoodBalance
  const householdScale = clamp(Math.min(scaleNormal, scaleDrought), 1, cb.maxHouseholdScale)
  const householdScaleBy = householdScale !== Math.min(scaleNormal, scaleDrought) ? 'bound' : scaleDrought < scaleNormal ? 'drought' : 'normal-year'
  const capacity = housingCapacity(L, householdScale)
  const population = Math.round(capacity * COMMUNITY.initialOccupancy.value)
  state = {
    ...state,
    community: makeCommunity(population, capacity),
    calibration: {
      ...baseCal,
      householdScale,
      residentsPerHome: residentsPerHome(householdScale),
      foodBalanceUnscaled: balance0,
      droughtFoodBalanceUnscaled: droughtBalance0,
      householdScaleBy,
    },
    reference: { ...state.reference, population },
    baseline: { ...state.baseline, population, housingCapacity: capacity, fodderUnits: fodderUnits(L) },
  }
  const econProbe = frozenYear(state)
  const levied = (k: string) => k === 'farmLevy' || k === 'treeProducts'
  const leviedValue = sumRec(econProbe.income, levied) / Math.max(1e-9, state.calibration.levy)
  const otherIncome = sumRec(econProbe.income, (k) => !levied(k))
  const costs = sumRec(econProbe.expenses)
  const target = cb.surplusShareOfStartBudget * ECON.startBudget.value
  const levy = leviedValue > 1 ? clamp((target + costs - otherIncome) / leviedValue, cb.levyRange[0], cb.levyRange[1]) : AGRI.levy.value
  const need = 2 * population * AGRI.foodPerPersonT.value
  state = {
    ...state,
    calibration: {
      ...state.calibration,
      levy,
      foodBalance: need > 0 ? econProbe.foodT / need : 1,
      droughtFoodBalance: need > 0 ? (droughtBalance0 * need1) / need : 1,
      normalYearSurplus: levy * leviedValue + otherIncome - costs,
    },
  }

  // 4. the pre-game year (frozen: indicators only) fills fields, totals and community so the
  // first screen shows real values. Layers other than water stores are unchanged.
  state = frozenYear(state).state
  state = { ...state, economy: { ...state.economy, budget: ECON.startBudget.value, debt: 0, serviceLevel: 1, unpaid: 0 } }
  state = { ...state, history: [makeHistoryPoint(state, 0, 'dry', dry)] }
  return { ...state, explanations: explainStart(state) }
}

export function validateAction(state: SimulationState, action: PlayerAction): ActionValidation {
  return validateLandUse(state, action)
}

export function applyAction(state: SimulationState, action: PlayerAction): { state: SimulationState; validation: ActionValidation } {
  const validation = validateAction(state, action)
  if (!validation.ok) return { state, validation }
  let economy = state.economy
  let layers = state.layers
  let reservoirSiltM3 = state.reservoirSiltM3
  const finance = action.type === 'loan' || action.type === 'repay' || action.type === 'set-levy'
  if (action.type === 'loan' || action.type === 'repay') {
    economy = applyFinance(economy, action.type, action.amount)
  } else if (action.type === 'set-levy') {
    economy = { ...economy, levyRate: action.rate }
  } else {
    const applied = applyLandUse(state, action, validation)
    layers = applied.layers
    reservoirSiltM3 = applied.reservoirSiltM3
    economy = { ...economy, budget: economy.budget - validation.cost + (validation.revenue ?? 0) }
    if (validation.timberHa) economy = { ...economy, timberSoldHa: (economy.timberSoldHa ?? 0) + validation.timberHa }
  }
  const community =
    finance ? state.community : { ...state.community, housingCapacity: housingCapacity(layers, state.calibration.householdScale) }
  const decision = {
    year: state.year,
    season: state.season,
    action: structuredClone(action),
    cost: validation.cost,
    step: state.step,
    revenue: validation.revenue ?? 0,
  }
  return {
    state: { ...state, layers, economy, community, reservoirSiltM3, decisions: [...state.decisions, decision] },
    validation,
  }
}

export function step(state: SimulationState): StepResult {
  const guided = state.weather.some((x) => x.designed) ? state.horizonYears : 0
  const w = weatherForStep(state.seed, state.weather, state.step, guided)
  const d = demographyForStep(state.seed, state.demography, state.step)
  const out = simulateSeason(state, w, d, false)
  const advancedYear = state.season === 'dry' ? state.year + 1 : state.year
  const nextSeason = state.season === 'wet' ? 'dry' : 'wet'
  let weather = state.weather
  let demography = state.demography
  if (state.step >= weather.length) weather = [...weather, w]
  if (state.step >= demography.length) demography = [...demography, d]
  let next: SimulationState = {
    ...state,
    layers: out.layers,
    fields: out.fields,
    economy: out.economy,
    community: out.community,
    totals: out.totals,
    ledger: out.ledger,
    reservoirM3: out.reservoirM3,
    reservoirSiltM3: out.reservoirSiltM3,
    diagnostics: out.diagnostics,
    reference: out.reference,
    weather,
    demography,
    step: state.step + 1,
    year: advancedYear,
    season: nextSeason,
  }
  const explanations = explainStep(state, next, w, out)
  const point = makeHistoryPoint(next, state.year, state.season, w)
  next = {
    ...next,
    history: [...state.history, point],
    explanations: [...state.explanations, ...explanations].slice(-MAX_EXPLANATIONS),
  }
  return { state: next, explanations, snapshot: makeSnapshot(next, state.year, state.season) }
}

/** Convenience: run n steps (no actions). */
export function advance(state: SimulationState, steps: number): SimulationState {
  let s = state
  for (let k = 0; k < steps; k++) s = step(s).state
  return s
}

export const engine: SimulationEngine = { createInitialState, validateAction, applyAction, step }

