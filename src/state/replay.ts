// Deterministic replay: rebuild a run from (world, seed, action log) by re-running the
// engine. Saves never store simulation state, only the inputs needed to recompute it,
// so a loaded game is exactly the game the engine would produce.
import { applyAction, createInitialState, step } from '../simulation/engine'
import type { Explanation, PlayerAction, SimulationState, Snapshot, WorldInput } from '../simulation/types'

export interface LogEntry {
  /** Simulation step (season index) during which the action was taken. */
  step: number
  action: PlayerAction
}

export function snapshotOf(s: SimulationState): Snapshot {
  return {
    year: s.year,
    season: s.season,
    layers: s.layers,
    fields: s.fields,
    community: s.community,
    economy: s.economy,
    totals: s.totals,
  }
}

export interface ReplayResult {
  state: SimulationState
  /** snapshots[k] is the world at the start of season k (index 0 = the initial world). */
  snapshots: Snapshot[]
  /** Every explanation produced by the replayed steps, oldest first. */
  explanations: Explanation[]
  /** Log entries the engine rejected during replay (should be empty for a healthy save). */
  rejected: { index: number; entry: LogEntry; reasons: string[] }[]
  /**
   * Undo points for the edits made during `targetStep` (the season not yet simulated): the
   * state before each accepted edit and the length of the accepted log at that moment.
   */
  undoStack: { state: SimulationState; logLength: number }[]
}

/**
 * The replay itself, as a generator that yields after every simulated season so a caller can
 * pause between seasons (see replayRunAsync). Entries must be in the order they were taken;
 * entries for a step are applied before that step is simulated.
 */
function* replaySteps(world: WorldInput, seed: number, log: readonly LogEntry[], targetStep: number): Generator<number, ReplayResult, void> {
  let state = createInitialState(world, seed)
  const snapshots: Snapshot[] = [snapshotOf(state)]
  const rejected: ReplayResult['rejected'] = []
  const explanations: Explanation[] = [...(state.explanations ?? [])]
  const undoStack: ReplayResult['undoStack'] = []
  const advance = () => {
    const r = step(state)
    state = r.state
    snapshots.push(r.snapshot)
    explanations.push(...r.explanations)
  }
  for (let index = 0; index < log.length; index++) {
    const entry = log[index]
    while (state.step < entry.step) {
      advance()
      yield state.step
    }
    const r = applyAction(state, entry.action)
    if (r.validation.ok) {
      if (state.step === targetStep) undoStack.push({ state, logLength: index - rejected.length })
      state = r.state
    } else rejected.push({ index, entry, reasons: r.validation.reasons })
  }
  while (state.step < targetStep) {
    advance()
    yield state.step
  }
  return { state, snapshots, explanations, rejected, undoStack }
}

/** Replays `log` from a fresh start and advances to `targetStep`, in one go. */
export function replayRun(world: WorldInput, seed: number, log: readonly LogEntry[], targetStep: number): ReplayResult {
  const it = replaySteps(world, seed, log, targetStep)
  for (;;) {
    const r = it.next()
    if (r.done) return r.value
  }
}

/**
 * Lets the browser paint (and handle input) before more work runs. Waits for a frame, then a
 * task; a plain timer backs that up because hidden tabs do not run animation frames.
 */
export function yieldToBrowser(): Promise<void> {
  if (typeof window === 'undefined' || typeof setTimeout !== 'function') return Promise.resolve()
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(finish, 0))
    setTimeout(finish, 50)
  })
}

/** Wall time spent replaying before pausing to let the page paint and respond. */
const REPLAY_SLICE_MS = 40

/**
 * Same result as replayRun, but pauses every few tens of milliseconds so a long replay never
 * freezes the page. `onProgress` gets the season reached and the target.
 */
export async function replayRunAsync(
  world: WorldInput,
  seed: number,
  log: readonly LogEntry[],
  targetStep: number,
  onProgress?: (step: number, target: number) => void,
): Promise<ReplayResult> {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  await yieldToBrowser()
  const it = replaySteps(world, seed, log, targetStep)
  let sliceStart = now()
  for (;;) {
    const r = it.next()
    if (r.done) return r.value
    if (now() - sliceStart >= REPLAY_SLICE_MS) {
      onProgress?.(r.value, targetStep)
      await yieldToBrowser()
      sliceStart = now()
    }
  }
}

/** A small fingerprint of a state used to confirm that a replay reproduced the save. */
export function fingerprint(s: SimulationState): { step: number; budget: number; debt: number; population: number } {
  const round = (v: number) => Math.round(v * 100) / 100
  return { step: s.step, budget: round(s.economy.budget), debt: round(s.economy.debt), population: round(s.community.population) }
}
