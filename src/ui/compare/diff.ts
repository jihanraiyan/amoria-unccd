// Grounded comparison of two runs. Statements only restate recorded values.
import type { HistoryPoint, SimulationState } from '../../simulation/types'
import type { RunData } from '../../state/store'
import { historyIndexForStep } from '../charts/chartSpecs'
import { METRICS, fmtMoney, landValueOf, type MetricId } from '../metrics'
import { decisionSummary, describeDecision } from '../report/analysis'

export const COMPARE_METRICS: MetricId[] = [
  'population',
  'housing',
  'food',
  'water',
  'land',
  'erosion',
  'sediment',
  'forest',
  'budget',
  'debt',
  'landEarnings',
  'treeEarnings',
  'foodBought',
  'livelihood',
  'wellbeing',
]

/** Sum of what households earned from the land over the run up to `step` seasons (played seasons only). */
export function earnedSoFar(s: SimulationState, step: number): { land: number; trees: number; bought: number } {
  const out = { land: 0, trees: 0, bought: 0 }
  for (const p of s.history) {
    const at = typeof p.step === 'number' ? p.step : null
    if (at === null || at <= 0 || at > step) continue
    out.land += landValueOf(p)
    out.trees += p.treeProductValue ?? 0
    out.bought += p.foodImportCost ?? 0
  }
  return out
}

export interface Fairness {
  sameWorld: boolean
  sameSeed: boolean
  sameBudget: boolean
  sameWeather: boolean
  weatherSeasonsChecked: number
}

/** Checks that the two runs really started from equivalent conditions. */
export function fairness(a: SimulationState, b: SimulationState): Fairness {
  const n = Math.min(a.weather.length, b.weather.length)
  let same = n > 0
  for (let i = 0; i < n && same; i++) {
    const x = a.weather[i]
    const y = b.weather[i]
    same = x.rainfallMm === y.rainfallMm && x.kind === y.kind && x.petMm === y.petMm && x.stormIntensity === y.stormIntensity
  }
  const budgetA = a.baseline?.budget ?? a.history[0]?.budget
  const budgetB = b.baseline?.budget ?? b.history[0]?.budget
  return {
    sameWorld: a.meta.id === b.meta.id,
    sameSeed: a.seed === b.seed,
    sameBudget: budgetA === budgetB,
    sameWeather: same,
    weatherSeasonsChecked: n,
  }
}

export interface MetricRow {
  id: MetricId
  label: string
  a: number
  b: number
  aText: string
  bText: string
  /** 'A' or 'B' if one is better by this metric's own direction, else null. */
  better: 'A' | 'B' | null
}

/** The history point describing a run after `step` seasons, if recorded. */
export const pointAt = (s: SimulationState, step: number): HistoryPoint | null => {
  const i = historyIndexForStep(s.history, s.step, Math.min(step, s.step))
  return i >= 0 ? s.history[i] : null
}

export function metricRows(a: HistoryPoint, b: HistoryPoint): MetricRow[] {
  return COMPARE_METRICS.map((id) => {
    const def = METRICS[id]
    const va = def.history(a)
    const vb = def.history(b)
    const rel = Math.abs(va - vb) / Math.max(1e-9, Math.abs(va), Math.abs(vb))
    let better: 'A' | 'B' | null = null
    if (def.better !== 'neutral' && rel > 0.01) better = (def.better === 'up') === va > vb ? 'A' : 'B'
    return { id, label: def.label, a: va, b: vb, aText: def.format(va), bText: def.format(vb), better }
  })
}

/** Plain-language summary of the largest differences at a given step, citing values. */
export function diffSummary(A: RunData, B: RunData, step: number): string[] {
  const pa = pointAt(A.state, step)
  const pb = pointAt(B.state, step)
  if (!pa || !pb) return ['Advance both scenarios at least one season to compare them.']
  const rows = metricRows(pa, pb)
  const lines: string[] = []
  const ranked = rows
    .map((r) => ({ r, rel: Math.abs(r.a - r.b) / Math.max(1e-9, Math.abs(r.a), Math.abs(r.b)) }))
    .filter((x) => x.rel > 0.02)
    .sort((x, y) => y.rel - x.rel)
  if (!ranked.length) {
    lines.push(
      pa.year === 0
        ? 'At the start the two futures are identical, as they should be.'
        : `After year ${pa.year} (${pa.season} season) the two futures are almost identical on every headline measure.`,
    )
  }
  for (const { r } of ranked.slice(0, 5)) {
    const lead = r.better ? `Scenario ${r.better} is ahead on ${r.label.toLowerCase()}` : `${r.label} differs`
    lines.push(`${lead}: ${r.aText} in A against ${r.bText} in B.`)
  }
  const won = { A: rows.filter((r) => r.better === 'A').length, B: rows.filter((r) => r.better === 'B').length }
  if (won.A || won.B) lines.push(`Across ${rows.length} measures, A does better on ${won.A} and B on ${won.B}. Neither result is "correct": each path trades some things for others.`)
  const ea = earnedSoFar(A.state, step)
  const eb = earnedSoFar(B.state, step)
  if (ea.land > 0 || eb.land > 0) {
    lines.push(
      `So far households earned ${fmtMoney(ea.land)} from the land in A (${fmtMoney(ea.trees)} of it from tree products) and ${fmtMoney(eb.land)} in B (${fmtMoney(eb.trees)} from trees), and spent ${fmtMoney(ea.bought)} and ${fmtMoney(eb.bought)} on bought food. This money goes to households, not the town fund.`,
    )
  }
  const da = decisionSummary(A.state.decisions.filter((d) => d.step < step))
  const db = decisionSummary(B.state.decisions.filter((d) => d.step < step))
  const describe = (ds: ReturnType<typeof decisionSummary>) =>
    ds.length ? ds.slice(0, 3).map(describeDecision).join(', ') : 'no changes to the land'
  lines.push(`Up to this point, A's main moves: ${describe(da)}. B's main moves: ${describe(db)}.`)
  return lines
}
