// Single source of truth for every metric the interface shows: what it measures, how it
// is calculated at a high level, what moves it, and what kind of number it is.
import { AGRI, COMMUNITY } from '../simulation/params'
import type { HistoryPoint, SimulationState, WorldMeta } from '../simulation/types'
import { genericClimateNote } from '../state/climateNote'

/**
 * Residents per housing parcel at density levels 1 to 3 on this map. The simulation scales
 * its base numbers once per map (household size), so read the live calibration when present.
 */
export function housingPerParcel(s: Pick<SimulationState, 'calibration'> | null): number[] {
  const live = s?.calibration?.residentsPerHome
  return (Array.isArray(live) && live.length >= 4 ? live : COMMUNITY.housingCapacity.value).slice(1)
}

/** "25, 55 or 90" */
export const listOr = (xs: readonly number[]): string => xs.map((x) => Math.round(x).toLocaleString('en-US')).join(', ').replace(/, ([^,]+)$/, ' or $1')

const IMPORT_SHARE = Math.round(AGRI.imports.value.maxShare * 100)
const LW_EMPLOY = Math.round(COMMUNITY.livelihoodWeights.value.employment * 100)
const LW_INCOME = Math.round(COMMUNITY.livelihoodWeights.value.income * 100)
const INCOME_REF = COMMUNITY.incomeReferencePerCapita.value

/**
 * observed: baseline data from a real dataset (only for real-data worlds).
 * derived: an indicator computed from other simulated values (a ratio or average).
 * model: an illustrative output of the simplified simulation, in game units.
 * exogenous: an input generated from the game seed (weather), never changed by the player.
 */
export type MetricKind = 'observed' | 'derived' | 'model' | 'exogenous'

export const KIND_LABEL: Record<MetricKind, string> = {
  observed: 'Observed baseline data',
  derived: 'Derived indicator',
  model: 'Illustrative model output',
  exogenous: 'Generated from the seed',
}

export const KIND_NOTE: Record<MetricKind, string> = {
  observed: 'Comes from a real dataset describing past conditions. It does not predict the effect of your choices.',
  derived: 'Calculated from other simulated values. As reliable as the values it is built from.',
  model: 'Produced by a simplified teaching model. Good for comparing choices, not a forecast for a real place.',
  exogenous: 'Generated from the seed when the game starts and never changed by your choices. Every run with the same seed gets the same values.',
}

export type MetricId =
  | 'budget'
  | 'debt'
  | 'population'
  | 'housing'
  | 'food'
  | 'water'
  | 'land'
  | 'wellbeing'
  | 'forest'
  | 'erosion'
  | 'sediment'
  | 'foodProduced'
  | 'income'
  | 'expenses'
  | 'rainfall'
  | 'livelihood'
  | 'landEarnings'
  | 'treeEarnings'
  | 'foodBought'

export interface MetricDef {
  id: MetricId
  label: string
  measures: string
  calculation: string
  influences: string
  kind: MetricKind
  format(v: number): string
  /** Current value from the live state. */
  current(s: SimulationState): number
  /** Value from a stored history point. */
  history(p: HistoryPoint): number
  /** Direction that counts as better, for coloring changes. */
  better: 'up' | 'down' | 'neutral'
  /** Extra line shown on real-data maps, where the value is still a generic game value. */
  realDataNote?: (meta: Pick<WorldMeta, 'kind' | 'name' | 'id'>) => string | null
}

export const fmtMoney = (v: number): string => {
  const sign = v < 0 ? '-' : ''
  const a = Math.abs(v)
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`
  if (a >= 10_000) return `${sign}$${Math.round(a / 1000)}k`
  return `${sign}$${Math.round(a).toLocaleString('en-US')}`
}
export const fmtPct = (v: number): string => `${Math.round(v * 100)}%`
export const fmtInt = (v: number): string => Math.round(v).toLocaleString('en-US')
export const fmtFixed =
  (d: number) =>
  (v: number): string =>
    Number.isFinite(v) ? v.toFixed(d) : '-'

/** Value households earned from the land in one recorded season (crops, tree products, grazing, forest products), before the cooperative levy. */
export const landValueOf = (p: HistoryPoint): number => (p.farmValue ?? 0) + (p.grazingValue ?? 0) + (p.forestProductValue ?? 0)

const lastPoint = (s: SimulationState): HistoryPoint | undefined => s.history[s.history.length - 1]

export const METRICS: Record<MetricId, MetricDef> = {
  budget: {
    id: 'budget',
    label: 'Budget',
    measures: 'Public money the valley can spend right now.',
    calculation: 'Starting budget, plus income each season (farm sales, taxes, markets), minus building costs, upkeep and loan interest.',
    influences: 'Everything you build or restore, crop harvests, population size, and any loans you take.',
    kind: 'model',
    format: fmtMoney,
    current: (s) => s.economy.budget,
    history: (p) => p.budget,
    better: 'up',
  },
  debt: {
    id: 'debt',
    label: 'Debt',
    measures: 'Money borrowed that still has to be paid back.',
    calculation: 'Loans taken, plus any bills the budget could not pay (arrears), minus repayments. Interest on it is charged every season as an expense.',
    influences: 'Taking loans and repaying them from the budget, and seasons when the bills are bigger than the money in the fund.',
    kind: 'model',
    format: fmtMoney,
    current: (s) => s.economy.debt,
    history: (p) => p.debt,
    better: 'down',
  },
  population: {
    id: 'population',
    label: 'Population',
    measures: 'People living in the valley.',
    calculation: 'Grows when there are homes, food, water and jobs; shrinks or stalls when they are short.',
    influences: 'Housing capacity, food and water security, jobs from farms and markets.',
    kind: 'model',
    format: fmtInt,
    current: (s) => s.community.population,
    history: (p) => p.population,
    better: 'neutral',
  },
  housing: {
    id: 'housing',
    label: 'Housing',
    measures: 'How many of the people who want to live here have a place to live.',
    calculation:
      'Housing places (a fixed number of people per housing parcel, more at higher density) divided by everyone who wants to live here: residents plus the people turned away for lack of homes, who stay on a waiting list that slowly shrinks. Capped at 100%.',
    influences: 'Building, densifying or demolishing housing; how many people arrive (drawn by jobs, food, water and safety) or leave.',
    kind: 'derived',
    format: fmtPct,
    current: (s) => s.community.housingAdequacy,
    history: (p) =>
      typeof p.housingAdequacy === 'number' ? p.housingAdequacy : p.population > 0 ? Math.min(1, p.housingCapacity / p.population) : 1,
    better: 'up',
  },
  food: {
    id: 'food',
    label: 'Food security',
    measures: 'Whether households have enough food over the last year.',
    calculation:
      `Local harvest this season plus last season, plus food bought from outside, divided by two seasons of need for the people living here at the start of the season. Purchases only cover a shortfall and are capped at ${IMPORT_SHARE}% of need, scaled down when livelihoods are weak. Capped at 100%.`,
    influences: 'Cropland area, farming intensity, soil health, water for crops (rain and irrigation), drought, livelihoods (jobs and income), population.',
    kind: 'derived',
    format: fmtPct,
    current: (s) => s.community.foodSecurity,
    history: (p) => p.foodSecurity,
    better: 'up',
  },
  water: {
    id: 'water',
    label: 'Water security',
    measures: 'Whether homes get the water they need, from roof tanks, wells and piped supply.',
    calculation:
      'Household water this season divided by household demand, capped at 100%. Household water is what homes collect themselves (roof tanks, and shallow wells that depend on how full the groundwater nearby is) plus piped water from waterworks, taken from the river or a reservoir. Irrigation is not part of this ratio, but it draws on the same river and reservoir, so heavy irrigation in a dry season can leave less for homes.',
    influences: 'Rainfall and river flow, waterworks and reservoirs, groundwater near homes (land that lets rain soak in recharges it), irrigated fields competing for river and reservoir water, population.',
    kind: 'derived',
    format: fmtPct,
    current: (s) => s.community.waterSecurity,
    history: (p) => p.waterSecurity,
    better: 'up',
  },
  land: {
    id: 'land',
    label: 'Land health',
    measures: 'Average soil condition across the valley.',
    calculation: 'Mean of the 0 to 1 soil health index over land parcels (river channels, lakes and reservoirs are left out). It is a teaching index, not a lab measurement.',
    influences: 'Erosion from runoff on bare or steep land, farming intensity, conservation practices, vegetation and restoration.',
    kind: 'model',
    format: fmtFixed(2),
    current: (s) => s.totals.meanSoilHealth,
    history: (p) => p.meanSoilHealth,
    better: 'up',
  },
  wellbeing: {
    id: 'wellbeing',
    label: 'Wellbeing',
    measures: 'How well life in the valley is going overall.',
    calculation: 'A weighted blend of housing, food security, water security, livelihoods and exposure to floods or drought. The Community panel shows each part.',
    influences: 'All of the indicators above.',
    kind: 'derived',
    format: fmtPct,
    current: (s) => s.community.wellbeing,
    history: (p) => p.wellbeing,
    better: 'up',
  },
  forest: {
    id: 'forest',
    label: 'Forest cover',
    measures: 'Share of the land covered by forest.',
    calculation: 'Forest parcels divided by land parcels (river channels, lakes and reservoirs are left out). Agroforestry is not counted as forest.',
    influences: 'Clearing land or building on forest, reforestation.',
    kind: 'derived',
    format: fmtPct,
    current: (s) => s.totals.forestCoverFrac,
    history: (p) => p.forestCoverFrac,
    better: 'neutral',
  },
  erosion: {
    id: 'erosion',
    label: 'Erosion pressure',
    measures: 'Average erosion pressure on the land this season.',
    calculation: 'An index inspired by the RUSLE soil-loss method: runoff and storm strength, slope, and how much bare soil is exposed. Game units, not tonnes of soil.',
    influences: 'Steep cleared land, heavy rain, cropland without conservation, vegetation cover.',
    kind: 'model',
    format: fmtFixed(2),
    current: (s) => s.totals.meanErosion,
    history: (p) => p.meanErosion,
    better: 'down',
  },
  sediment: {
    id: 'sediment',
    label: 'Sediment at outlet',
    measures: 'Soil washed out of the valley at the river outlet this season.',
    calculation: 'Eroded soil routed downhill along flow paths, minus what wetlands and vegetation trap. Game-scaled units.',
    influences: 'Upstream erosion, wetlands and riparian vegetation.',
    kind: 'model',
    format: fmtFixed(1),
    current: (s) => s.totals.outletSedimentT,
    history: (p) => p.outletSedimentT,
    better: 'down',
  },
  foodProduced: {
    id: 'foodProduced',
    label: 'Food produced',
    measures: 'Harvest this season.',
    calculation: 'Area farmed times potential yield, scaled by soil health, water availability, management and weather.',
    influences: 'Cropland, intensity, irrigation, soil health, drought.',
    kind: 'model',
    format: fmtFixed(0),
    current: (s) => s.totals.foodProducedT,
    history: (p) => p.foodProducedT,
    better: 'up',
  },
  income: {
    id: 'income',
    label: 'Income',
    measures: 'Money earned last season.',
    calculation: 'Sum of all income lines in the budget breakdown.',
    influences: 'Harvests, population, markets.',
    kind: 'model',
    format: fmtMoney,
    current: (s) => Object.values(s.economy.income).reduce((a, b) => a + b, 0),
    history: (p) => p.income,
    better: 'up',
  },
  expenses: {
    id: 'expenses',
    label: 'Expenses',
    measures: 'Money spent last season on upkeep and interest.',
    calculation: 'Sum of all expense lines in the budget breakdown.',
    influences: 'How much infrastructure you maintain, irrigation, debt.',
    kind: 'model',
    format: fmtMoney,
    current: (s) => Object.values(s.economy.expenses).reduce((a, b) => a + b, 0),
    history: (p) => p.expenses,
    better: 'down',
  },
  rainfall: {
    id: 'rainfall',
    label: 'Rainfall',
    measures: 'Rain that fell during the season.',
    calculation: 'Drawn once from the game seed at the start (wet and dry seasons, with droughts and heavy rain). Your actions never change it.',
    influences: 'Nothing you do. It is the same in every scenario with the same seed.',
    realDataNote: genericClimateNote,
    kind: 'exogenous',
    format: (v) => `${Math.round(v)} mm`,
    current: (s) => s.weather[Math.max(0, s.step - 1)]?.rainfallMm ?? 0,
    history: (p) => p.rainfallMm,
    better: 'neutral',
  },
  livelihood: {
    id: 'livelihood',
    label: 'Livelihoods',
    measures: 'Whether people have work and enough income to live on.',
    calculation: `A blend: ${LW_EMPLOY}% weight on employment (jobs for working-age residents) and ${LW_INCOME}% on an income index, household income per resident against $${INCOME_REF} a season, capped at 100%. Household income is what farm families keep from crops and tree products after the cooperative levy, plus grazing, forest products and wages, minus what they spend on bought food. Because the income part is capped and only weighs ${LW_INCOME}%, earnings can rise a lot while this index moves a little; the Household earnings chart shows the money itself.`,
    influences: 'Harvests, agroforestry once the trees mature, pasture and forest left standing, jobs from markets and the town, food bought in lean seasons, population.',
    kind: 'derived',
    format: fmtPct,
    current: (s) => s.community.livelihood,
    history: (p) => p.livelihood,
    better: 'up',
  },
  landEarnings: {
    id: 'landEarnings',
    label: 'Earned from the land',
    measures: 'What farm and herding households earned from the land this season.',
    calculation:
      'Crop sales plus tree products from agroforestry, plus livestock from grazing and fuelwood, fodder and wild food from standing forest, at game prices. Counted before the cooperative levy, the share of crop and tree value that goes to the town fund.',
    influences: 'Cropland area and yields, agroforestry (it pays little until the trees are 3 to 7 years old), grass and forest cover, soil health, markets, weather.',
    kind: 'model',
    format: fmtMoney,
    current: (s) => {
      const p = lastPoint(s)
      return p ? landValueOf(p) : 0
    },
    history: landValueOf,
    better: 'up',
  },
  treeEarnings: {
    id: 'treeEarnings',
    label: 'Tree products',
    measures: 'Fruit, fodder and timber value from agroforestry this season.',
    calculation: 'Per hectare of agroforestry, a value that ramps up from 3 to 7 years after planting, scaled by soil health and (only partly) by the season water. Before the cooperative levy.',
    influences: 'How much agroforestry you plant and how long ago, soil health, floods and mud on the plots.',
    kind: 'model',
    format: fmtMoney,
    current: (s) => lastPoint(s)?.treeProductValue ?? 0,
    history: (p) => p.treeProductValue ?? 0,
    better: 'up',
  },
  foodBought: {
    id: 'foodBought',
    label: 'Spent on bought food',
    measures: 'What households paid this season for food bought from outside the valley.',
    calculation: `Food bought to cover a shortfall (at most ${IMPORT_SHARE}% of need) times the outside price, which is higher than the local farm price. It comes out of household income.`,
    influences: 'Local harvests against need, population, livelihoods (poorer households can buy less).',
    kind: 'model',
    format: fmtMoney,
    current: (s) => s.community.foodImportCost ?? 0,
    history: (p) => p.foodImportCost ?? 0,
    better: 'down',
  },
}

/** Status band for 0..1 indicators where higher is better. */
export function band(v: number): 'good' | 'warn' | 'bad' {
  if (v >= 0.85) return 'good'
  if (v >= 0.6) return 'warn'
  return 'bad'
}

export const seasonLabel = (season: 'wet' | 'dry'): string => (season === 'wet' ? 'Wet season' : 'Dry season')
