// Metric tooltips must describe what the engine actually computes. Each check recomputes a
// headline indicator from the engine's own totals and layers and compares it with the
// value the interface shows.
import { describe, expect, test, vi } from 'vitest'
import { createInitialState, step } from '../../src/simulation/engine'
import { AGRI } from '../../src/simulation/params'
import { coverCode, structureCode, type SimulationState } from '../../src/simulation/types'
import { PROCEDURAL_WORLD_ID, loadWorld } from '../../src/state/worlds'
import { KIND_LABEL, METRICS, housingPerParcel } from '../../src/ui/metrics'

// these run the engine for several seasons; give them room when every suite runs in parallel
vi.setConfig({ testTimeout: 30_000 })

async function played(seasons: number): Promise<SimulationState> {
  let s = createInitialState(await loadWorld(PROCEDURAL_WORLD_ID), 7)
  for (let k = 0; k < seasons; k++) s = step(s).state
  return s
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

describe('metric definitions match the engine', () => {
  test('food security: two seasons of harvest plus imports over two seasons of need', async () => {
    for (const s of [await played(3), await played(14)]) {
      const t = s.totals
      const expected = clamp01((t.foodProducedT + t.foodProducedPrevT + t.foodImportedT) / (2 * t.foodDemandT))
      expect(METRICS.food.current(s)).toBeCloseTo(expected, 9)
    }
    expect(METRICS.food.calculation).toMatch(/last season/)
    expect(METRICS.food.calculation).toMatch(/bought from outside/)
    expect(METRICS.food.calculation).toMatch(new RegExp(`${Math.round(AGRI.imports.value.maxShare * 100)}% of need`))
  })

  test('water security: household supply over household demand only', async () => {
    const s = await played(9)
    const t = s.totals
    expect(METRICS.water.current(s)).toBeCloseTo(clamp01(t.townWaterSuppliedM3 / t.townWaterDemandM3), 9)
    // household water is piped water plus what homes collect themselves, as the tooltip says
    expect(t.pipedWaterM3 + t.selfSupplyM3).toBeCloseTo(t.townWaterSuppliedM3, 3)
    expect(METRICS.water.calculation).toMatch(/roof tanks/)
    expect(METRICS.water.calculation).toMatch(/Irrigation is not part of this ratio/)
  })

  test('housing: capacity in residents over everyone who wants to live here', async () => {
    const s = await played(10)
    const c = s.community
    expect(METRICS.housing.current(s)).toBeCloseTo(clamp01(c.housingCapacity / c.housingDemand), 9)
    // capacity counts residents per housing parcel by density level, not homes
    const housing = structureCode('housing')
    const perParcel = housingPerParcel(s)
    let residents = 0
    for (let i = 0; i < s.layers.structure.length; i++) {
      if (s.layers.structure[i] === housing) residents += perParcel[s.layers.structureLevel[i] - 1]
    }
    expect(c.housingCapacity).toBeCloseTo(residents, 6)
    expect(METRICS.housing.calculation).toMatch(/waiting list/)
  })

  test('forest cover and land health are shares of land parcels', async () => {
    const s = await played(4)
    const forest = coverCode('forest')
    const water = coverCode('water')
    const reservoir = structureCode('reservoir')
    let land = 0
    let trees = 0
    let soil = 0
    for (let i = 0; i < s.layers.cover.length; i++) {
      if (s.terrain.channel[i] || s.layers.cover[i] === water || s.layers.structure[i] === reservoir) continue
      land++
      soil += s.layers.soilHealth[i]
      if (s.layers.cover[i] === forest) trees++
    }
    expect(METRICS.forest.current(s)).toBeCloseTo(trees / land, 9)
    expect(METRICS.land.current(s)).toBeCloseTo(soil / land, 6)
    expect(METRICS.forest.calculation).toMatch(/land parcels/)
  })

  test('rainfall is labelled as a seeded input, not model output', () => {
    expect(METRICS.rainfall.kind).toBe('exogenous')
    expect(KIND_LABEL.exogenous).toBe('Generated from the seed')
  })

  test('debt includes bills the budget could not pay (arrears), as the tooltip says', async () => {
    const world = await loadWorld(PROCEDURAL_WORLD_ID)
    const s0 = createInitialState(world, 5)
    // an empty fund and a large debt: this season's interest bill cannot be paid
    const owed = 5_000_000
    const broke: SimulationState = { ...s0, economy: { ...s0.economy, budget: 0, debt: owed } }
    const next = step(broke).state
    expect(next.economy.unpaid).toBeGreaterThan(0)
    expect(next.economy.serviceLevel).toBeLessThan(1)
    // no loan was taken or repaid, so the debt grew by exactly the unpaid bills
    expect(next.economy.debt).toBeCloseTo(owed + next.economy.unpaid, 4)
    expect(METRICS.debt.current(next)).toBeCloseTo(owed + next.economy.unpaid, 4)
    expect(METRICS.debt.calculation).toMatch(/bills the budget could not pay \(arrears\)/)
    expect(METRICS.debt.calculation).toMatch(/Interest on it is charged every season/)
  })
})
