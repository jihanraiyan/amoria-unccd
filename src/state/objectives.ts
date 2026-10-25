// Guided watershed scenario objectives with live progress, read straight from the
// simulation's own scenario module (src/simulation/scenarios/guided.ts). The interface
// never substitutes goals of its own: if the simulation cannot evaluate them, the player
// is told plainly that goals are unavailable.
import { droughtEpisodes, endReport as simEndReport, evaluateObjectives as simEvaluate, type ObjectiveStatus as SimObjective } from '../simulation/scenarios/guided'
import type { SimulationState } from '../simulation/types'

export interface ObjectiveStatus {
  id: string
  label: string
  description: string
  /** 0..1 share of the target reached right now. */
  progress: number
  met: boolean
  /**
   * 'met' when on track, 'missed' when the result already played out below the goal (the most
   * recent drought fell short), 'open' otherwise.
   */
  state: 'met' | 'open' | 'missed'
  /** Year of the drought season that fell short, for a missed drought goal. */
  missedYear?: number
  /** Whether a missed goal can still be won back before the end of the scenario. */
  recoverable?: boolean
  /** Current value in words, e.g. "86% now (goal at least 90%)". */
  detail: string
}

export interface ObjectivesResult {
  items: ObjectiveStatus[]
  /** Set when the simulation could not evaluate its goals; items is then empty. */
  error: string | null
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)
const pct = (v: number) => `${Math.round(v * 100)}%`

/** Writes the current value and the target in words, from the simulation's own numbers. */
export function detailFor(o: Pick<SimObjective, 'id' | 'value' | 'target' | 'direction' | 'unit'>): string {
  const { value, target } = o
  if (!Number.isFinite(value) || !Number.isFinite(target)) return ''
  const goal = o.direction === 'atMost' ? 'at most' : 'at least'
  if (o.id === 'floods') {
    const limit = `goal: none, or ${goal} ${target} times as often`
    return value <= 0
      ? `no home flooded so far (${limit})`
      : `homes flooded ${value.toFixed(2)} times as often as the starting village would in the same weather (${limit})`
  }
  if (o.id === 'erosion') return `${value.toFixed(2)} times what the starting landscape would lose in the same weather (goal ${goal} ${target} times)`
  if (o.unit === 'x') return `${value.toFixed(2)} times the start (goal ${goal} ${target} times)`
  if (o.id === 'land') {
    return value <= 0
      ? `soil health is ${(-value).toFixed(3)} above where it started (limit: a drop of ${target})`
      : `soil health has dropped ${value.toFixed(3)} (limit ${target})`
  }
  if (o.id === 'solvency') return `debt is ${pct(value)} of the borrowing limit (goal ${goal} ${pct(target)}; any unpaid bills count as 100%)`
  return `${pct(value)} now (goal ${goal} ${pct(target)})`
}

/**
 * For the drought goal: the year the most recent drought fell below the target, and whether
 * another drought is still to come before the end of the scenario (weather is drawn from the
 * seed at the start, so this is known). Null when the goal is not missed.
 */
export function droughtMiss(s: SimulationState, o: Pick<SimObjective, 'id' | 'value' | 'target' | 'met'>): { year: number; recoverable: boolean } | null {
  if (o.id !== 'drought' || o.met || !(o.value < o.target)) return null
  const played = s.history.filter((p) => p.step > 0)
  const episodes = droughtEpisodes(played)
  const last = episodes[episodes.length - 1]
  if (!last) return null
  const fell = last.find((p) => Math.min(p.foodSecurity, p.waterSecurity) < o.target) ?? last[0]
  const horizon = horizonSteps(s)
  // a drought still to come is a fresh chance only if it starts a new episode (not the current one continuing)
  let recoverable = false
  for (let k = s.step; k < Math.min(horizon, s.weather.length) && !recoverable; k++) {
    recoverable = s.weather[k]?.kind === 'drought' && (k === 0 || s.weather[k - 1]?.kind !== 'drought')
  }
  return { year: fell.year, recoverable }
}

export const GOALS_UNAVAILABLE = 'Goals are unavailable right now: the simulation could not evaluate them for this game. The valley still runs normally.'

export function evaluateObjectives(s: SimulationState): ObjectivesResult {
  try {
    const out = simEvaluate(s)
    return {
      items: out.map((o) => {
        const miss = droughtMiss(s, o)
        const detail = detailFor(o)
        return {
          id: o.id,
          label: o.label,
          description: o.description,
          met: o.met,
          state: o.met ? 'met' : miss ? 'missed' : 'open',
          ...(miss ? { missedYear: miss.year, recoverable: miss.recoverable } : {}),
          progress: clamp01(o.progress),
          detail: miss
            ? `Missed in the year ${miss.year} drought: ${detail}.${miss.recoverable ? ' Another drought is still to come, so being ready for it can win this back.' : ' No drought is left before the end, so this one stays missed.'}`
            : detail,
        } satisfies ObjectiveStatus
      }),
      error: null,
    }
  } catch (e) {
    console.error('Scenario goals could not be evaluated', e)
    return { items: [], error: GOALS_UNAVAILABLE }
  }
}

/** The parts of the simulation's end-of-horizon report the interface shows. */
export interface ScenarioReport {
  cumulative: ReturnType<typeof simEndReport>['cumulative']
  weather: ReturnType<typeof simEndReport>['weather']
  keyMoments: SimulationState['explanations']
}

/** The simulation's own end report, or null (with the error logged) if it fails. */
export function scenarioReport(s: SimulationState): ScenarioReport | null {
  try {
    const r = simEndReport(s)
    return { cumulative: r.cumulative, weather: r.weather, keyMoments: r.keyMoments }
  } catch (e) {
    console.error('The end-of-horizon report could not be built', e)
    return null
  }
}

/** Steps in the guided horizon (two seasons per year). */
export const horizonSteps = (s: SimulationState): number => s.horizonYears * 2
