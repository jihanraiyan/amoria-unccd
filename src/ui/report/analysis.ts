// End-of-horizon report. Every sentence is built from recorded simulation history and the
// player's decision record; nothing here estimates or predicts.
import type { ActionType, DecisionRecord, HistoryPoint, SimulationState } from '../../simulation/types'
import { ACTION_PHRASE } from '../../state/toolActions'
import { historyLead, isPlayedSeason } from '../charts/chartSpecs'
import { fmtMoney, fmtPct } from '../metrics'

export interface Outcome {
  label: string
  start: string
  end: string
  direction: 'up' | 'down' | 'flat'
  good: boolean | null
}

export interface DecisionSummary {
  type: ActionType
  phrase: string
  times: number
  parcels: number
  spent: number
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)

function outcome(label: string, a: number, b: number, fmt: (v: number) => string, better: 'up' | 'down' | null): Outcome {
  const d = b - a
  const flat = Math.abs(d) < Math.max(1e-6, Math.abs(a) * 0.01)
  const direction = flat ? 'flat' : d > 0 ? 'up' : 'down'
  return { label, start: fmt(a), end: fmt(b), direction, good: better === null || flat ? null : (better === 'up') === d > 0 }
}

export function outcomes(s: SimulationState): Outcome[] {
  const h = s.history
  const first = h[0]
  const last = h[h.length - 1]
  if (!first || !last) return []
  const b = s.baseline
  return [
    outcome('Population', b?.population ?? first.population, last.population, (v) => Math.round(v).toLocaleString('en-US'), null),
    outcome('Housing capacity (people)', b?.housingCapacity ?? first.housingCapacity, last.housingCapacity, (v) => Math.round(v).toLocaleString('en-US'), null),
    outcome('Food security', first.foodSecurity, last.foodSecurity, fmtPct, 'up'),
    outcome('Water security', first.waterSecurity, last.waterSecurity, fmtPct, 'up'),
    outcome('Mean soil health', b?.meanSoilHealth ?? first.meanSoilHealth, last.meanSoilHealth, (v) => v.toFixed(3), 'up'),
    outcome('Forest cover', b?.forestCoverFrac ?? first.forestCoverFrac, last.forestCoverFrac, fmtPct, null),
    outcome('Erosion pressure', first.meanErosion, last.meanErosion, (v) => v.toFixed(2), 'down'),
    outcome('Budget', b?.budget ?? first.budget, last.budget, fmtMoney, 'up'),
    outcome('Debt', first.debt, last.debt, fmtMoney, 'down'),
    outcome('Wellbeing', first.wellbeing, last.wellbeing, fmtPct, 'up'),
  ]
}

export function decisionSummary(decisions: readonly DecisionRecord[]): DecisionSummary[] {
  const by = new Map<ActionType, DecisionSummary>()
  for (const d of decisions) {
    const cur = by.get(d.action.type) ?? { type: d.action.type, phrase: ACTION_PHRASE[d.action.type], times: 0, parcels: 0, spent: 0 }
    by.set(d.action.type, {
      ...cur,
      times: cur.times + 1,
      parcels: cur.parcels + ('cells' in d.action ? d.action.cells.length : 0),
      spent: cur.spent + d.cost,
    })
  }
  return [...by.values()].sort((a, b) => b.spent - a.spent)
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** "planted cropland on 3 parcels" / "took a loan 2 times". */
export function describeDecision(d: DecisionSummary): string {
  return `${d.phrase.toLowerCase()} ${d.parcels > 0 ? plural(d.parcels, 'parcel') : plural(d.times, 'time')}`
}

export const decisionCount = (n: number): string => plural(n, 'decision')

/** Weather-grouped comparisons: how the valley did in drought or heavy-rain seasons vs normal ones. */
export function weatherFindings(all: readonly HistoryPoint[]): string[] {
  const h = all.filter(isPlayedSeason)
  const out: string[] = []
  const normal = h.filter((p) => p.weather === 'normal')
  const drought = h.filter((p) => p.weather === 'drought')
  const heavy = h.filter((p) => p.weather === 'heavy-rain')
  if (drought.length && normal.length) {
    out.push(
      `There ${drought.length === 1 ? 'was 1 drought season' : `were ${drought.length} drought seasons`}. Food security averaged ${fmtPct(mean(drought.map((p) => p.foodSecurity)))} in them, against ${fmtPct(mean(normal.map((p) => p.foodSecurity)))} in normal seasons; water security averaged ${fmtPct(mean(drought.map((p) => p.waterSecurity)))} against ${fmtPct(mean(normal.map((p) => p.waterSecurity)))}.`,
    )
  }
  if (heavy.length && normal.length) {
    out.push(
      `In ${heavy.length === 1 ? 'the 1 heavy-rain season' : `the ${heavy.length} heavy-rain seasons`}, mean erosion pressure was ${mean(heavy.map((p) => p.meanErosion)).toFixed(2)} against ${mean(normal.map((p) => p.meanErosion)).toFixed(2)} in normal seasons, and sediment leaving the valley averaged ${mean(heavy.map((p) => p.outletSedimentT)).toFixed(1)} against ${mean(normal.map((p) => p.outletSedimentT)).toFixed(1)}.`,
    )
  }
  if (!drought.length && !heavy.length) out.push('The weather stayed fairly normal in this run, so the valley was not tested by drought or heavy rain.')
  return out
}

/** The drought season with the lowest food security, and what had been decided before it. */
export function worstDrought(s: SimulationState): string | null {
  const h = s.history
  let worst = -1
  h.forEach((p, k) => {
    if (isPlayedSeason(p) && p.weather === 'drought' && (worst < 0 || p.foodSecurity < h[worst].foodSecurity)) worst = k
  })
  if (worst < 0) return null
  const p = h[worst]
  // history[k] records the season simulated at step (k - lead); decisions up to that step shaped it
  const stepOfSeason = typeof p.step === 'number' ? p.step - 1 : worst - historyLead(h.length, s.step)
  const before = s.decisions.filter((d) => d.step <= stepOfSeason)
  const count = (t: ActionType) => before.filter((d) => d.action.type === t).reduce((n, d) => n + ('cells' in d.action ? d.action.cells.length : 1), 0)
  const parts: string[] = []
  const irrig = count('toggle-irrigation') + before.filter((d) => d.action.type === 'cropland' && d.action.irrigated).reduce((n, d) => n + ('cells' in d.action ? d.action.cells.length : 0), 0)
  if (irrig) parts.push(`${irrig} parcel${irrig === 1 ? '' : 's'} of irrigation changes`)
  if (count('reservoir')) parts.push(`${count('reservoir')} reservoir parcel${count('reservoir') === 1 ? '' : 's'}`)
  if (count('wetland')) parts.push(`${count('wetland')} wetland parcel${count('wetland') === 1 ? '' : 's'} restored`)
  if (count('conservation')) parts.push(`soil conservation on ${count('conservation')} parcel${count('conservation') === 1 ? '' : 's'}`)
  if (count('cropland')) parts.push(`${count('cropland')} new cropland parcel${count('cropland') === 1 ? '' : 's'}`)
  if (count('reforest') + count('agroforestry')) parts.push(`${count('reforest') + count('agroforestry')} parcels of trees planted`)
  const decided = parts.length ? `Before it, you had made these water and land choices: ${parts.join(', ')}.` : 'Before it, you had not changed the valley’s water or farmland.'
  return `The hardest drought came in year ${p.year} (${p.season} season, ${Math.round(p.rainfallMm)} mm of rain). Food security fell to ${fmtPct(p.foodSecurity)} and water security to ${fmtPct(p.waterSecurity)}. ${decided} The same drought hits every scenario with this seed; what changes is how ready the valley is.`
}

export const REFLECTION_PROMPTS = [
  { id: 'tradeoff', text: 'What tradeoff did you run into?' },
  { id: 'drought', text: 'Which earlier decision affected how the community coped with drought?' },
  { id: 'investigate', text: 'What would you look into before making a similar decision in your own community?' },
] as const
