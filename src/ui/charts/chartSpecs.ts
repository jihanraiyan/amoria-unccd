// Chart definitions shared by the Charts panel and Compare Futures. Every series reads a
// field of HistoryPoint, which the engine records after each simulated season.
import type { HistoryPoint } from '../../simulation/types'
import { fmtFixed, fmtInt, fmtMoney, fmtPct, type MetricKind } from '../metrics'
import { WEATHER_WORD } from '../timeline/history'
import type { Band } from './LineChart'

export interface ChartLine {
  id: string
  label: string
  get(p: HistoryPoint): number
}

export interface ChartSpec {
  id: string
  title: string
  lines: ChartLine[]
  format(v: number): string
  /** What kind of numbers the chart shows (see metrics.ts). */
  kind: MetricKind
  yMin?: number
  yMax?: number
  note?: string
}

export const CHARTS: readonly ChartSpec[] = [
  {
    id: 'food',
    kind: 'model',
    title: 'Food grown vs food needed',
    lines: [
      { id: 'prod', label: 'Grown', get: (p) => p.foodProducedT },
      { id: 'need', label: 'Needed', get: (p) => p.foodDemandT },
    ],
    format: fmtFixed(0),
    yMin: 0,
    note: 'Game-scaled tonnes per season.',
  },
  {
    id: 'security',
    kind: 'derived',
    title: 'Food and water security',
    lines: [
      { id: 'food', label: 'Food', get: (p) => p.foodSecurity },
      { id: 'water', label: 'Water', get: (p) => p.waterSecurity },
    ],
    format: fmtPct,
    yMin: 0,
    yMax: 1,
  },
  {
    id: 'harvest-factors',
    kind: 'model',
    title: 'What limited the harvest',
    lines: [
      { id: 'soilf', label: 'Soil factor', get: (p) => p.meanCropSoilFactor },
      { id: 'waterf', label: 'Water factor', get: (p) => p.meanCropWaterFactor },
      { id: 'eventf', label: 'Flood and mud factor', get: (p) => p.meanCropEventFactor },
    ],
    format: fmtPct,
    yMin: 0,
    note: 'Average multipliers on cropland in the harvest formula (100% = no limit). A dip shows which factor held yields back. The flood and mud factor is damage from flooding and sediment burying fields, which depends a lot on land use upstream and on the floodplain. Drought shows up in the water factor, not this one.',
  },
  {
    id: 'soil',
    kind: 'model',
    title: 'Land health (mean soil index)',
    lines: [{ id: 'soil', label: 'Soil health', get: (p) => p.meanSoilHealth }],
    format: fmtFixed(2),
    yMin: 0,
    yMax: 1,
  },
  {
    id: 'erosion',
    kind: 'model',
    title: 'Erosion pressure',
    lines: [{ id: 'erosion', label: 'Mean erosion', get: (p) => p.meanErosion }],
    format: fmtFixed(2),
    yMin: 0,
    note: 'Index in game units, not tonnes of soil.',
  },
  {
    id: 'sediment',
    kind: 'model',
    title: 'Sediment leaving the valley',
    lines: [{ id: 'sed', label: 'At outlet', get: (p) => p.outletSedimentT }],
    format: fmtFixed(1),
    yMin: 0,
  },
  {
    id: 'forest',
    kind: 'derived',
    title: 'Forest cover',
    lines: [{ id: 'forest', label: 'Forest', get: (p) => p.forestCoverFrac }],
    format: fmtPct,
    yMin: 0,
  },
  {
    id: 'budget',
    kind: 'model',
    title: 'Budget and debt',
    lines: [
      { id: 'budget', label: 'Budget', get: (p) => p.budget },
      { id: 'debt', label: 'Debt', get: (p) => p.debt },
    ],
    format: fmtMoney,
  },
  {
    id: 'cash',
    kind: 'model',
    title: 'Income and expenses per season',
    lines: [
      { id: 'inc', label: 'Income', get: (p) => p.income },
      { id: 'exp', label: 'Expenses', get: (p) => p.expenses },
    ],
    format: fmtMoney,
    yMin: 0,
  },
  {
    id: 'earnings',
    kind: 'model',
    title: 'Household earnings',
    lines: [
      { id: 'crops', label: 'Crop sales', get: (p) => Math.max(0, (p.farmValue ?? 0) - (p.treeProductValue ?? 0)) },
      { id: 'trees', label: 'Tree products', get: (p) => p.treeProductValue ?? 0 },
      { id: 'grazing', label: 'Grazing', get: (p) => p.grazingValue ?? 0 },
      { id: 'bought', label: 'Spent on bought food', get: (p) => p.foodImportCost ?? 0 },
    ],
    format: fmtMoney,
    yMin: 0,
    note: 'Money that reaches farm and herding households each season, not the town fund. Crop and tree values are before the cooperative levy (the share the fund takes). Agroforestry costs the fund up front and pays households a few years later, once the trees mature. Bought food is paid out of household income.',
  },
  {
    id: 'livelihood',
    kind: 'derived',
    title: 'Livelihoods',
    lines: [{ id: 'liv', label: 'Livelihoods', get: (p) => p.livelihood }],
    format: fmtPct,
    yMin: 0,
    yMax: 1,
    note: 'Mostly employment, plus an income index that stops counting at a decent income, so it moves less than the earnings above.',
  },
  {
    id: 'people',
    kind: 'model',
    title: 'Population and homes',
    lines: [
      { id: 'pop', label: 'Population', get: (p) => p.population },
      { id: 'cap', label: 'Housing capacity', get: (p) => p.housingCapacity },
    ],
    format: fmtInt,
  },
  {
    id: 'hazard',
    kind: 'derived',
    title: 'Floods and hazard exposure',
    lines: [
      { id: 'haz', label: 'Hazard exposure', get: (p) => p.hazardExposure },
      { id: 'flood', label: 'Peak flood ratio', get: (p) => p.peakFloodRatio },
    ],
    format: fmtFixed(2),
    yMin: 0,
    note: 'Hazard exposure is 0 to 1. Peak flood ratio compares river flow with channel capacity; above 1 the river overflows.',
  },
  {
    id: 'wellbeing',
    kind: 'derived',
    title: 'Community wellbeing',
    lines: [{ id: 'wb', label: 'Wellbeing', get: (p) => p.wellbeing }],
    format: fmtPct,
    yMin: 0,
    yMax: 1,
  },
  {
    id: 'rain',
    kind: 'exogenous',
    title: 'Rainfall (set by the seed, not by you)',
    lines: [{ id: 'rain', label: 'Rain', get: (p) => p.rainfallMm }],
    format: (v) => `${Math.round(v)}`,
    yMin: 0,
    note: 'mm per season. The same in every scenario with this seed.',
  },
]

/**
 * How many leading history points describe the starting world rather than a played season
 * (the engine may record a baseline point at step 0). With `lead` = 1, history[k] is the
 * world after k seasons; with 0, history[k] is the world after k + 1 seasons.
 */
export const historyLead = (historyLength: number, step: number): number => Math.max(0, Math.min(1, historyLength - step))

/** History index describing the world after `step` seasons, or -1 if none was recorded. */
export const historyIndexAt = (historyLength: number, currentStep: number, step: number): number => {
  const i = step - 1 + historyLead(historyLength, currentStep)
  return i >= 0 && i < historyLength ? i : -1
}

/** Same as historyIndexAt, but uses each point's own `step` field when the engine records it. */
export function historyIndexForStep(history: readonly HistoryPoint[], currentStep: number, step: number): number {
  for (let k = history.length - 1; k >= 0; k--) {
    const s = history[k].step
    if (typeof s !== 'number') return historyIndexAt(history.length, currentStep, step)
    if (s === step) return k
    if (s < step) break
  }
  return -1
}

export const historyLabel =
  (history: readonly HistoryPoint[]) =>
  (k: number): string => {
    const p = history[k]
    if (!p) return ''
    return isPlayedSeason(p) ? `Y${p.year} ${p.season}` : 'Start'
  }

/** True for a point that records a played season (not the pre-game baseline). */
export const isPlayedSeason = (p: HistoryPoint): boolean => (typeof p.step === 'number' ? p.step > 0 : p.year > 0)

/** Contiguous runs of non-normal weather as chart bands. */
export function weatherBands(history: readonly HistoryPoint[]): Band[] {
  const bands: Band[] = []
  history.forEach((p, k) => {
    if (p.weather === 'normal' || !isPlayedSeason(p)) return
    const last = bands[bands.length - 1]
    if (last && last.kind === p.weather && last.end === k - 1) bands[bands.length - 1] = { ...last, end: k }
    else bands.push({ start: k, end: k, kind: p.weather })
  })
  return bands
}

/** Weather of history point k in words, for chart tables ("drought"); null for the start. */
export const historyWeather =
  (history: readonly HistoryPoint[]) =>
  (k: number): string | null => {
    const p = history[k]
    return p && isPlayedSeason(p) ? WEATHER_WORD[p.weather] : null
  }
