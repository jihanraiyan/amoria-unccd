// Cross-seed goal checks shared by the valley and Kaani seed test files.
import { OBJECTIVES } from '../params'
import { SEEDS, SEED_BOTS, metCount, playSeeds, type SeedRun } from './bots/seeds'
import type { WorldInput } from '../types'

export function seedSuite(label: string, world: WorldInput): void {
  describe(`guided goals across ${SEEDS.length} scenario seeds on ${label}`, () => {
    let runs: SeedRun[] = []
    beforeAll(() => {
      runs = playSeeds(world)
    }, 600_000)

    test('the best land-aware strategy meets at least 7 goals on at least 90% of seeds', () => {
      const good = runs.filter((r) => metCount(r.goals.fundedBalanced) >= 7)
      const report = runs.map((r) => `${r.seed}:${metCount(r.goals.fundedBalanced)}`).join(' ')
      expect(good.length / runs.length, report).toBeGreaterThanOrEqual(0.9)
    })

    test('doing nothing fails at least 5 goals on every seed, and no strategy meets all 11 on any seed', () => {
      for (const r of runs) {
        expect(r.goals.idle.length - metCount(r.goals.idle), `idle on seed ${r.seed}`).toBeGreaterThanOrEqual(5)
        for (const name of Object.keys(SEED_BOTS)) expect(metCount(r.goals[name]), `${name} on seed ${r.seed}`).toBeLessThan(r.goals[name].length)
      }
    })

    test('the land goal is decided by land use, not by the weather seed', () => {
      const target = OBJECTIVES.value.soilVsReference
      for (const r of runs) {
        // a valley left alone is its own twin on every seed
        expect(Math.abs(r.land.idle), `idle on seed ${r.seed}`).toBeLessThan(1e-4)
        // restoration moves the value well past the target; clearing and naive growth move it the other way
        expect(r.land.agroforestry, `agroforestry on seed ${r.seed}`).toBeGreaterThan(3 * target)
        expect(r.land.fundedBalanced, `fundedBalanced on seed ${r.seed}`).toBeGreaterThan(3 * target)
        expect(r.land.clearAndFarm, `clearAndFarm on seed ${r.seed}`).toBeLessThan(0)
        expect(r.land.housingFarms, `housingFarms on seed ${r.seed}`).toBeLessThan(target)
      }
    })

    test('the scenario intro reports how many drought seasons this seed brings', () => {
      for (const r of runs) {
        const intro = r.start.explanations.find((e) => e.id === 's0-start-0')!
        expect(intro.body).toContain(`${r.droughtSeasons} drought seasons`)
        expect(intro.evidence.find((e) => e.label === 'Drought seasons ahead')!.after).toBe(r.droughtSeasons)
      }
      // the seeds really differ: some bring far more drought than others
      const counts = runs.map((r) => r.droughtSeasons)
      expect(Math.max(...counts) - Math.min(...counts)).toBeGreaterThanOrEqual(3)
    })
  })
}
