// Community: population and interpretable indicators derived from the other systems.
// Population grows from an exogenous seeded curve (natural increase plus a regional migration
// wave) but only settles where there is housing; arrivals respond to jobs, food, water and
// safety, and people leave when wellbeing or food is poor. No indicator is set directly by
// an action: each one is computed from simulated quantities.
import { AGRI, COMMUNITY, WELLBEING_WEIGHTS } from '../params'
import type { Community, DemographySeason, StakeholderView, WorldLayers } from '../types'
import { C, S, clamp } from './cells'

/** Residents per home cell by density level, after the per-map household scale. */
export function residentsPerHome(householdScale = 1): number[] {
  return COMMUNITY.housingCapacity.value.map((v) => Math.round(v * householdScale))
}

export function housingCapacity(layers: WorldLayers, householdScale = 1): number {
  const per = residentsPerHome(householdScale)
  let cap = 0
  for (let i = 0; i < layers.structure.length; i++) if (layers.structure[i] === S.housing) cap += per[layers.structureLevel[i]] ?? 0
  return cap
}

export interface JobCount {
  farm: number
  nonFarm: number
  total: number
}

export function countJobs(layers: WorldLayers, population: number): JobCount {
  const j = COMMUNITY.jobs.value
  let farm = 0
  let nonFarm = 0
  for (let i = 0; i < layers.cover.length; i++) {
    const c = layers.cover[i]
    const st = layers.structure[i]
    if (c === C.cropland) {
      farm += [j.croplandLow, j.croplandMedium, j.croplandHigh][layers.intensity[i]] ?? j.croplandMedium
      if (layers.irrigated[i]) farm += j.irrigated
    } else if (c === C.agroforestry) farm += j.agroforestry
    else if (c === C.grassland && st === S.none) farm += j.grassland
    else if (c === C.forest) nonFarm += j.forest
    else if (c === C.wetland) nonFarm += j.wetland
    if (st === S.market) nonFarm += j.market
    else if (st === S.waterworks) nonFarm += j.waterworks
    else if (st === S.reservoir) nonFarm += j.reservoir
  }
  nonFarm += population * j.servicesPerResident
  return { farm, nonFarm, total: farm + nonFarm }
}

export interface CommunityInput {
  prev: Community
  layers: WorldLayers
  demography: DemographySeason
  /** Local production this step and last step, t. */
  foodNowT: number
  foodPrevT: number
  townDemandM3: number
  /** All household water delivered (piped plus roof tanks and wells), m3. */
  townSuppliedM3: number
  /** Part of townSuppliedM3 that came from roof tanks and wells, m3. */
  selfSuppliedM3?: number
  /** Share of piped water safe to drink after treatment, 0..1 (models/waterQuality). Missing means clean. */
  waterQuality?: number
  /** Waterworks in the valley (for the townspeople note). */
  waterworks?: number
  /** Residents per home cell multiplier (per-map calibration). */
  householdScale?: number
  farmHouseholdIncome: number
  /** Share of housing capacity on flooded cells. */
  floodedHousingShare: number
  floodedCropShare: number
  /** 1 - mean water factor of cropped cells (drought stress). */
  droughtStress: number
  /** Mean sediment hazard on housing cells 0..1. */
  sedimentHazard: number
  irrigationSupplyRatio: number
  downstream: { waterAccess: number; hazard: number; income: number }
  /** When true, indicators are evaluated but population does not change (initial state). */
  frozen?: boolean
  foodPerPersonT: number
  /** Local tax households pay above the starting rate this season (negative below it), currency. */
  extraTax?: number
  /** Multiplier on arrivals from the levy rate (1 at the starting rate). */
  arrivalFactor?: number
}

export interface CommunityOutput {
  community: Community
  foodImportedT: number
}

export function runCommunity(input: CommunityInput): CommunityOutput {
  const { prev, layers, demography } = input
  const pop0 = prev.population
  const capacity = housingCapacity(layers, input.householdScale ?? 1)
  const jobs = countJobs(layers, pop0)
  const labor0 = pop0 * COMMUNITY.laborForceShare.value

  // food security over a two-season window (one harvest feeds the whole year)
  const need = 2 * pop0 * input.foodPerPersonT
  const local = input.foodNowT + input.foodPrevT
  const deficit = Math.max(0, need - local)
  const imp = AGRI.imports.value
  const importCap = imp.maxShare * clamp(prev.livelihood, 0, 1) * need
  const imported = Math.min(deficit, importCap)
  const foodSecurity = need > 0 ? clamp((local + imported) / need, 0, 1) : 1
  const foodSelfSufficiency = need > 0 ? clamp(local / need, 0, 2) : 1
  // households pay for bought food out of their income; the window covers two seasons, so one
  // season pays for half of the window's purchases
  const foodImportCost = 0.5 * imported * imp.pricePerT
  // only safe water counts: piped water from muddy intakes is partly unusable, wells are not affected
  const waterQuality = clamp(input.waterQuality ?? 1, 0, 1)
  const pipedM3 = Math.max(0, input.townSuppliedM3 - (input.selfSuppliedM3 ?? 0))
  const safeM3 = input.townSuppliedM3 - pipedM3 * (1 - waterQuality)
  const waterSecurity = input.townDemandM3 > 0 ? clamp(safeM3 / input.townDemandM3, 0, 1) : 1

  const employment = labor0 > 0 ? clamp(jobs.total / labor0, 0, 1) : 1
  const nonFarmFilled = Math.min(jobs.nonFarm, Math.max(0, labor0 - Math.min(jobs.farm, labor0)))
  const grossIncome = input.farmHouseholdIncome + nonFarmFilled * COMMUNITY.wagePerJob.value
  const householdIncome = Math.max(0, grossIncome - foodImportCost - (input.extraTax ?? 0))
  const incomePerCapita = pop0 > 0 ? householdIncome / pop0 : 0
  const lw = COMMUNITY.livelihoodWeights.value
  const livelihood = clamp(lw.employment * employment + lw.income * clamp(incomePerCapita / COMMUNITY.incomeReferencePerCapita.value, 0, 1), 0, 1)

  const hw = COMMUNITY.hazardWeights.value
  // homes flooded in earlier seasons are still being repaired
  const floodRecovery = clamp(Math.max(input.floodedHousingShare, (prev.floodRecovery ?? 0) * COMMUNITY.floodRecovery.value), 0, 1)
  const hazardExposure = clamp(
    hw.floodHousing * floodRecovery + hw.floodCrops * input.floodedCropShare + hw.droughtStress * input.droughtStress + hw.sediment * input.sedimentHazard,
    0,
    1,
  )

  // population change
  let births = 0
  let arrivals = 0
  let departures = 0
  let population = pop0
  let waitlist = Math.max(0, prev.housingDemand - prev.population)
  if (!input.frozen) {
    births = pop0 * demography.naturalGrowthRate * clamp(foodSecurity / COMMUNITY.birthsFoodSecurityFull.value, 0, 1)
    const a = COMMUNITY.attractiveness.value
    const attract = a.jobs * employment + a.food * foodSecurity + a.water * waterSecurity + a.safety * (1 - hazardExposure)
    arrivals = pop0 * demography.migrationPressure * a.scale * attract * attract * (input.arrivalFactor ?? 1)
    const d = COMMUNITY.departure.value
    departures = pop0 * d.rate * Math.max(0, (d.wellbeingThreshold - prev.wellbeing) / d.wellbeingThreshold)
    if (foodSecurity < d.foodCrisis) departures += pop0 * d.foodCrisisRate * ((d.foodCrisis - foodSecurity) / d.foodCrisis)
    const desired = Math.max(0, pop0 + births + arrivals - departures)
    const maxPop = capacity * COMMUNITY.overcrowding.value
    population = Math.min(desired, maxPop)
    const turnedAway = Math.max(0, desired - population)
    waitlist = waitlist * COMMUNITY.waitlistDecay.value + turnedAway
  }
  const housingDemand = population + waitlist
  const housingAdequacy = housingDemand > 0 ? clamp(capacity / housingDemand, 0, 1) : 1

  const W = WELLBEING_WEIGHTS.value
  const parts = { housing: housingAdequacy, food: foodSecurity, water: waterSecurity, livelihood, safety: 1 - hazardExposure }
  const wellbeing = W.housing * parts.housing + W.food * parts.food + W.water * parts.water + W.livelihood * parts.livelihood + W.safety * parts.safety

  const farmJobs = Math.max(1, jobs.farm)
  const farmers: StakeholderView = {
    income: input.farmHouseholdIncome / farmJobs,
    waterAccess: clamp(input.irrigationSupplyRatio, 0, 1),
    hazardExposure: clamp(input.floodedCropShare + COMMUNITY.farmerDroughtHazardWeight.value * input.droughtStress, 0, 1),
    note: farmerNote(input),
  }
  const townspeople: StakeholderView = {
    income: pop0 > 0 ? (nonFarmFilled * COMMUNITY.wagePerJob.value) / pop0 : 0,
    waterAccess: waterSecurity,
    hazardExposure: clamp(floodRecovery + input.sedimentHazard, 0, 1),
    note: townNote(waterSecurity, housingAdequacy, input.floodedHousingShare, input.townDemandM3 > 0 ? (input.selfSuppliedM3 ?? 0) / input.townDemandM3 : 0, input.waterworks ?? 1),
  }
  const downstream: StakeholderView = {
    income: input.downstream.income,
    waterAccess: input.downstream.waterAccess,
    hazardExposure: input.downstream.hazard,
    note: downstreamNote(input.downstream),
  }

  return {
    community: {
      population,
      housingCapacity: capacity,
      jobs: jobs.total,
      housingAdequacy,
      foodSecurity,
      waterSecurity,
      waterQuality,
      livelihood,
      hazardExposure,
      wellbeing,
      stakeholders: { farmers, townspeople, downstream },
      housingDemand,
      laborForce: population * COMMUNITY.laborForceShare.value,
      births,
      arrivals,
      departures,
      wellbeingParts: parts,
      floodRecovery,
      foodSelfSufficiency,
      foodImportCost,
    },
    foodImportedT: imported,
  }
}

const pct = (v: number) => `${Math.round(v * 100)}%`

function farmerNote(input: CommunityInput): string {
  const bits: string[] = []
  if (input.irrigationSupplyRatio < 0.95) bits.push(`irrigation met ${pct(input.irrigationSupplyRatio)} of demand`)
  if (input.droughtStress > 0.2) bits.push(`crops reached ${pct(1 - input.droughtStress)} of their water need`)
  if (input.floodedCropShare > 0) bits.push(`${pct(input.floodedCropShare)} of cropped fields flooded`)
  return bits.length ? `Farmers: ${bits.join('; ')}.` : 'Farmers: crops had the water they needed this season.'
}

function townNote(water: number, housing: number, flooded: number, selfShare: number, works: number): string {
  const bits: string[] = []
  if (water < 0.95) {
    const own = selfShare > 0.005 ? ` (${pct(selfShare)} from roof tanks and shallow wells${works === 0 ? ', as there is no waterworks' : ''})` : ''
    bits.push(`households got ${pct(water)} of the water they need${own}`)
  }
  if (housing < 0.95) bits.push(`housing covers ${pct(housing)} of people who want to live here`)
  if (flooded > 0) bits.push(`${pct(flooded)} of homes stood in floodwater`)
  return bits.length ? `Townspeople: ${bits.join('; ')}.` : 'Townspeople: homes, water and safety are holding up.'
}

function downstreamNote(d: CommunityInput['downstream']): string {
  const bits: string[] = []
  bits.push(`river flow leaving the valley is ${pct(d.waterAccess)} of the usual amount for this season`)
  if (d.hazard > 0.3) bits.push('muddy water and flood peaks are a concern')
  return `Downstream households (outside the map): ${bits.join('; ')}.`
}
