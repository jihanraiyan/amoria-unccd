// Economy: the community development fund. Income comes from a cooperative levy on farm and
// tree-product value, local taxes on residents, water tariffs and market activity. Costs are
// maintenance per structure, water treatment (dearer when the river carries more sediment),
// the farm input program, irrigation operation, protection of young plantings, flood repairs
// and loan interest. The budget never goes below zero: if obligations exceed what is
// available, everything is paid pro rata and the next step runs at a reduced service level.
// Nothing is forgiven: the unpaid part of every bill (maintenance, services, repairs, farm
// inputs, interest) is carried as arrears on the debt, where it accrues interest like a loan
// until it is repaid. This is the explicit debt route; there is no free money.
import { AGRI, ECON } from '../params'
import type { Economy, Terrain, WorldLayers } from '../types'
import { C, S, clamp } from './cells'

export interface EconomyInput {
  terrain: Terrain
  layers: WorldLayers
  economy: Economy
  population: number
  cropValue: number
  treeProductValue: number
  inputCost: number
  marketCount: number
  townSuppliedM3: number
  irrigationSuppliedM3: number
  intakeTurbidity: number
  flooded: Uint8Array
  /** Cooperative levy rate (per-map calibration or the rate the player set); defaults to AGRI.levy. */
  levy?: number
  /** Local tax per resident per season; defaults to ECON.housingTaxPerResident. */
  taxPerResident?: number
}

export interface EconomyOutput {
  economy: Economy
  totalIncome: number
  totalExpenses: number
  /** Value kept by farm households after the levy. */
  farmHouseholdIncome: number
}

const round2 = (v: number) => Math.round(v * 100) / 100

export function runEconomy(input: EconomyInput): EconomyOutput {
  const { layers, economy, population } = input
  const mt = ECON.maintenance.value
  const n = layers.cover.length
  let roads = 0
  let housingLevels = 0
  let reservoirs = 0
  let waterworks = 0
  let markets = 0
  let wetlands = 0
  let conservation = 0
  let irrigated = 0
  let young = 0
  let floodedHousingLevels = 0
  let floodedRoads = 0
  const youngSeasons = ECON.youngPlantingSeasons.value
  for (let i = 0; i < n; i++) {
    const st = layers.structure[i]
    const c = layers.cover[i]
    if (st === S.road) {
      roads++
      if (input.flooded[i]) floodedRoads++
    } else if (st === S.housing) {
      housingLevels += layers.structureLevel[i]
      if (input.flooded[i]) floodedHousingLevels += layers.structureLevel[i]
    } else if (st === S.reservoir) reservoirs++
    else if (st === S.waterworks) waterworks++
    else if (st === S.market) markets++
    if (c === C.wetland && layers.baselineCover[i] !== C.wetland) wetlands++
    if (c === C.cropland && layers.conservation[i]) conservation++
    if (c === C.cropland && layers.irrigated[i]) irrigated++
    if ((c === C.forest || c === C.agroforestry || c === C.wetland) && layers.coverAge[i] < youngSeasons && layers.baselineCover[i] !== c) young++
  }

  const levy = input.levy ?? AGRI.levy.value
  const mk = ECON.market.value
  const income: Record<string, number> = {
    farmLevy: round2(input.cropValue * levy),
    treeProducts: round2(input.treeProductValue * levy),
    localTax: round2(population * (input.taxPerResident ?? ECON.housingTaxPerResident.value)),
    waterTariff: round2(input.townSuppliedM3 * ECON.waterTariffPerM3.value),
    markets:
      markets > 0
        ? round2(population * mk.feePerResident * Math.sqrt(Math.min(markets, mk.maxMarkets)) + input.cropValue * mk.cropShare)
        : 0,
  }
  const expenses: Record<string, number> = {
    roads: round2(roads * mt.road),
    housing: round2(housingLevels * mt.housingPerLevel),
    services: round2(population * ECON.servicesPerResident.value),
    waterworks: round2(waterworks * mt.waterworks + input.townSuppliedM3 * mt.treatmentPerM3 * input.intakeTurbidity),
    reservoirs: round2(reservoirs * mt.reservoir),
    markets: round2(markets * mt.market),
    wetlands: round2(wetlands * mt.wetland),
    conservation: round2(conservation * mt.conservation),
    irrigation: round2(irrigated * mt.irrigatedCell + input.irrigationSuppliedM3 * AGRI.irrigationOpexPerM3.value),
    farmInputs: round2(input.inputCost),
    youngPlantings: round2(young * mt.youngPlanting),
    floodRepairs: round2(floodedHousingLevels * ECON.floodRepair.value.housingPerLevel + floodedRoads * ECON.floodRepair.value.road),
    interest: round2(economy.debt * ECON.interestPerSeason.value),
  }
  const totalIncome = Object.values(income).reduce((a, b) => a + b, 0)
  const totalExpenses = Object.values(expenses).reduce((a, b) => a + b, 0)
  const available = economy.budget + totalIncome
  let budget: number
  let debt = economy.debt
  let serviceLevel = 1
  let unpaid = 0
  if (available >= totalExpenses) {
    budget = available - totalExpenses
  } else {
    serviceLevel = totalExpenses > 0 ? clamp(available / totalExpenses, 0, 1) : 1
    unpaid = totalExpenses - available
    budget = 0
    debt += unpaid // arrears: the unpaid bills are still owed and accrue interest
  }
  return {
    economy: { budget, debt, income, expenses, serviceLevel, unpaid, ...(economy.levyRate !== undefined ? { levyRate: economy.levyRate } : {}) },
    totalIncome,
    totalExpenses,
    farmHouseholdIncome: (input.cropValue + input.treeProductValue) * (1 - levy),
  }
}

/** The levy rate in force: the player's setting, or the map's starting rate. */
export function levyRateOf(economy: Economy, calibratedLevy: number): number {
  return economy.levyRate ?? calibratedLevy
}

/** Local tax per resident at a levy rate: the starting tax scaled by the same multiple as the levy. */
export function taxPerResidentAt(rate: number, calibratedLevy: number): number {
  return ECON.housingTaxPerResident.value * (calibratedLevy > 0 ? rate / calibratedLevy : 1)
}

/** Multiplier on newcomers from the levy rate (1 at the starting rate). */
export function arrivalRateFactor(rate: number, calibratedLevy: number): number {
  const rp = ECON.ratePolicy.value
  const mult = calibratedLevy > 0 ? rate / calibratedLevy : 1
  return clamp(1 - rp.arrivalSensitivity * (mult - 1), rp.arrivalFactorMin, rp.arrivalFactorMax)
}

/** Loan and repayment actions (explicit debt mechanism). */
export function applyFinance(economy: Economy, type: 'loan' | 'repay', amount: number): Economy {
  if (type === 'loan') return { ...economy, budget: economy.budget + amount, debt: economy.debt + amount }
  return { ...economy, budget: economy.budget - amount, debt: Math.max(0, economy.debt - amount) }
}
