// Plays a set of bots over many scenario seeds on one map, for the cross-seed goal tests.
import { createInitialState } from '../../engine'
import { evaluateObjectives, landGain, type ObjectiveStatus } from '../../scenarios/guided'
import type { SimulationState, WorldInput } from '../../types'
import { FUNDED, NAIVE, STRATEGIES, play, type Bot } from './strategies'

/** Twenty scenario seeds, fixed so the test is reproducible. 42 is the documented default. */
export const SEEDS = [1, 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 42, 99, 123, 256, 777, 2024, 2026, 31337]

/** The best land-aware bot (planned restoration with the levy raised) and the comparison bots. */
export const SEED_BOTS: Record<string, Bot> = {
  idle: STRATEGIES.idle,
  fundedBalanced: FUNDED.fundedBalanced,
  agroforestry: STRATEGIES.agroforestry,
  clearAndFarm: STRATEGIES.clearAndFarm,
  housingFarms: NAIVE.housingFarms,
}

export interface SeedRun {
  seed: number
  droughtSeasons: number
  start: SimulationState
  goals: Record<string, ObjectiveStatus[]>
  land: Record<string, number>
}

export function playSeeds(world: WorldInput): SeedRun[] {
  return SEEDS.map((seed) => {
    const start = createInitialState(world, seed)
    const goals: Record<string, ObjectiveStatus[]> = {}
    const land: Record<string, number> = {}
    for (const [name, bot] of Object.entries(SEED_BOTS)) {
      const final = play(name, bot, { from: start }).final
      goals[name] = evaluateObjectives(final)
      land[name] = landGain(final).gain
    }
    const droughtSeasons = start.weather.slice(0, start.horizonYears * 2).filter((w) => w.kind === 'drought').length
    return { seed, droughtSeasons, start, goals, land }
  })
}

export const metCount = (g: ObjectiveStatus[]) => g.filter((o) => o.met).length
