// Dates and decision records for the history timeline. Pure lookups over recorded state.
//
// Step k is the number of seasons simulated. Snapshot k is the world after season k - 1
// ended, which is also the start of season k. Decisions recorded with step s were made
// during season s, before it ran, so they first show up in snapshot s + 1.
import type { DecisionRecord, Explanation, SimulationState, WeatherSeason } from '../../simulation/types'
import { describeAction } from '../../state/messages'
import { fmtMoney, seasonLabel } from '../metrics'

export const stepDate = (step: number): { year: number; season: 'wet' | 'dry' } => ({
  year: Math.floor(step / 2) + 1,
  season: step % 2 === 0 ? 'wet' : 'dry',
})

/** "Year 3, dry season": the season that is played at step `step`. */
export function seasonText(step: number): string {
  const d = stepDate(step)
  return `Year ${d.year}, ${seasonLabel(d.season).toLowerCase()}`
}

/** "After year 3, wet season": what snapshot `step` shows. */
export function afterText(step: number): string {
  if (step <= 0) return 'At the start'
  return `After ${seasonText(step - 1).charAt(0).toLowerCase()}${seasonText(step - 1).slice(1)}`
}

export const WEATHER_WORD: Record<WeatherSeason['kind'], string> = {
  normal: 'normal weather',
  drought: 'drought',
  'heavy-rain': 'heavy rain',
  favorable: 'good growing season',
}

/** Weather of the season that ended in snapshot `step`, or null at the start. */
export function weatherBefore(sim: Pick<SimulationState, 'weather'>, step: number): WeatherSeason['kind'] | null {
  return step > 0 ? (sim.weather[step - 1]?.kind ?? null) : null
}

/** "built housing on 4 parcels for $8,000" (with any one-off revenue). */
export function describeRecord(d: DecisionRecord): string {
  return describeAction(d.action, d.cost, d.revenue, fmtMoney)
}

export interface DecisionMarker {
  /** Season the decisions were made in. */
  step: number
  /** Snapshot that first shows them in place (equal to the current step for this season's edits). */
  viewAt: number
  records: DecisionRecord[]
  label: string
}

/** One marker per season with decisions, labelled in words. */
export function decisionMarkers(decisions: readonly DecisionRecord[], currentStep: number): DecisionMarker[] {
  const by = new Map<number, DecisionRecord[]>()
  for (const d of decisions) by.set(d.step, [...(by.get(d.step) ?? []), d])
  return [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([step, records]) => {
      const d = stepDate(step)
      const what = records.map(describeRecord).join('; ')
      return { step, viewAt: Math.min(step + 1, currentStep), records, label: `Year ${d.year} ${d.season}: ${what}` }
    })
}

/** First parcel a decision touched, for "show on the map". */
export const firstCell = (d: DecisionRecord): number | null => ('cells' in d.action && d.action.cells.length ? d.action.cells[0] : null)

/**
 * The step whose simulation wrote this explanation, i.e. the snapshot it explains. The engine
 * prefixes ids with "s<step>-"; older ids fall back to matching the season label.
 */
export function explanationStep(e: Explanation): number | null {
  const m = /^s(\d+)-/.exec(e.id)
  return m ? Number(m[1]) : null
}

/** True if the explanation describes the season that ended in snapshot `step`. */
export function explainsStep(e: Explanation, step: number): boolean {
  const k = explanationStep(e)
  if (k !== null) return k === step
  if (step === 0) return false
  const d = stepDate(step - 1)
  return e.year === d.year && e.season === d.season
}
