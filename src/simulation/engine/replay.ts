// Replay: rebuild any state from the world, the seed and the action log. Because the engine
// is deterministic and weather is fixed by the seed, this reproduces the exact state, which
// is what save/load and "compare futures" rely on.
import type { PlayerAction, SimulationState, WorldInput } from '../types'
import { applyAction, createInitialState, step, type CreateOptions } from './index'

export interface LoggedAction {
  /** Step at which the action was applied (state.step before stepping). */
  step: number
  action: PlayerAction
}

/** The action log of a state, in application order. */
export function actionLog(state: SimulationState): LoggedAction[] {
  return state.decisions.map((d) => ({ step: d.step, action: d.action }))
}

/**
 * Replay from scratch until state.step === untilStep. Actions logged at untilStep itself
 * (taken after the last step, before the next) are applied too, so replaying a live game's
 * log reproduces it exactly. Throws if a logged action no longer validates (log mismatch).
 */
export function replay(world: WorldInput, seed: number, log: LoggedAction[], untilStep: number, opts?: CreateOptions): SimulationState {
  let s = createInitialState(world, seed, opts)
  const sorted = log.map((e, k) => ({ ...e, k })).sort((a, b) => a.step - b.step || a.k - b.k)
  let p = 0
  for (;;) {
    while (p < sorted.length && sorted[p].step === s.step) {
      const r = applyAction(s, sorted[p].action)
      if (!r.validation.ok) throw new Error(`replay: action ${p} (${sorted[p].action.type}) at step ${s.step} is invalid: ${r.validation.reasons.join('; ')}`)
      s = r.state
      p++
    }
    if (s.step >= untilStep) break
    s = step(s).state
  }
  return s
}

/** Branch: same world and seed, the log truncated to actions before `atStep` (for "try another future"). */
export function branchAt(world: WorldInput, seed: number, log: LoggedAction[], atStep: number, opts?: CreateOptions): SimulationState {
  return replay(
    world,
    seed,
    log.filter((e) => e.step < atStep),
    atStep,
    opts,
  )
}
