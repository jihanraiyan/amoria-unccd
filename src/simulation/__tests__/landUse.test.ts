import { applyAction, validateAction } from '../engine'
import { ECON, HYDRO } from '../params'
import { CLEARABLE, irrigationReachable, irrigationReason, irrigationSources, removalCost } from '../models/landUse'
import type { PlayerAction, SimulationState } from '../types'
import { C, S, cells, initial, must, rich } from './helpers'
import { serializeState } from '../engine/serialize'

const firstValid = (s: SimulationState, make: (c: number[]) => PlayerAction, candidates: number[], k = 1) => {
  const v = validateAction(s, make(candidates))
  return candidates.filter((_, j) => v.cellOk[j]).slice(0, k)
}

describe('land-use conversion and placement', () => {
  const s0 = rich(initial())

  test('converting grassland to cropland updates the authoritative layers', () => {
    const grass = firstValid(s0, (c) => ({ type: 'cropland', cells: c, intensity: 'high', irrigated: false }), cells(s0, (i) => s0.layers.cover[i] === C.grassland), 5)
    const s1 = must(s0, { type: 'cropland', cells: grass, intensity: 'high', irrigated: false })
    for (const i of grass) {
      expect(s1.layers.cover[i]).toBe(C.cropland)
      expect(s1.layers.intensity[i]).toBe(2)
      expect(s1.layers.coverAge[i]).toBe(0)
      expect(s0.layers.cover[i]).toBe(C.grassland) // input untouched
    }
    expect(s1.decisions.at(-1)).toMatchObject({ step: 0, action: { type: 'cropland' } })
  })

  test('construction deducts exactly the validated cost (plus one-off revenue)', () => {
    const s = initial()
    const forest = firstValid(s, (c) => ({ type: 'clear', cells: c }), cells(s, (i) => s.layers.cover[i] === C.forest), 4)
    const v = validateAction(s, { type: 'clear', cells: forest })
    expect(v.ok).toBe(true)
    expect(v.cost).toBe(Math.round(4 * (ECON.capex.value.clear + ECON.capex.value.clearForestExtra)))
    expect(v.revenue).toBeGreaterThan(0)
    const s1 = applyAction(s, { type: 'clear', cells: forest }).state
    expect(s1.economy.budget).toBeCloseTo(s.economy.budget - v.cost + (v.revenue ?? 0), 6)
    const homes = firstValid(s, (c) => ({ type: 'housing', cells: c }), cells(s, (i) => s.layers.structure[i] === S.none), 3)
    const vh = validateAction(s, { type: 'housing', cells: homes })
    const s2 = applyAction(s, { type: 'housing', cells: homes }).state
    expect(s2.economy.budget).toBeCloseTo(s.economy.budget - vh.cost + (vh.revenue ?? 0), 6)
    expect(s2.community.housingCapacity).toBeGreaterThan(s.community.housingCapacity)
  })

  test('a conversion costs the same whether made directly or by clearing first', () => {
    // cost(convert X) == cost(clear X) + cost(convert the bare cell), with the same timber revenue,
    // for every cover the clear action removes and every action that builds over the cover
    const s0 = rich(initial())
    // the starting valley has no agroforestry: plant some on grassland near the village first
    const grass = cells(s0, (i) => s0.layers.cover[i] === C.grassland && !s0.terrain.protected[i] && s0.terrain.slope[i] < 0.1)
    const s = rich(must(s0, { type: 'agroforestry', cells: grass.slice(0, 300) }))
    const builds: { name: string; make: (c: number[]) => PlayerAction }[] = [
      { name: 'cropland', make: (c) => ({ type: 'cropland', cells: c, intensity: 'medium', irrigated: false }) },
      { name: 'irrigated cropland', make: (c) => ({ type: 'cropland', cells: c, intensity: 'high', irrigated: true }) },
      { name: 'housing', make: (c) => ({ type: 'housing', cells: c }) },
      { name: 'road', make: (c) => ({ type: 'road', cells: c }) },
      { name: 'waterworks', make: (c) => ({ type: 'waterworks', cells: c }) },
      { name: 'market', make: (c) => ({ type: 'market', cells: c }) },
    ]
    const checked = new Set<string>()
    for (const cover of CLEARABLE) {
      const pool = cells(s, (i) => s.layers.cover[i] === cover && s.layers.structure[i] === S.none && !s.terrain.protected[i] && !s.terrain.channel[i])
      expect(pool.length, `cells of cover ${cover}`).toBeGreaterThan(0)
      // clearing charges exactly the removal cost and sells the timber
      const vc = validateAction(s, { type: 'clear', cells: [pool[0]] })
      expect(vc.ok).toBe(true)
      expect(vc.cost).toBe(Math.round(removalCost(cover)))
      for (const b of builds) {
        const batch = validateAction(s, b.make(pool))
        const ok = pool.filter((_, k) => batch.cellOk[k]).slice(0, 4)
        for (const i of ok) {
          const direct = validateAction(s, b.make([i]))
          if (!direct.ok) continue
          const clear = validateAction(s, { type: 'clear', cells: [i] })
          const bare = must(s, { type: 'clear', cells: [i] })
          expect(bare.layers.cover[i]).toBe(C.bare)
          const after = validateAction(bare, b.make([i]))
          expect(after.ok, `${b.name} on cleared cover ${cover}`).toBe(true)
          expect(direct.cost, `${b.name} on cover ${cover}`).toBe(clear.cost + after.cost)
          expect(direct.revenue).toBe(clear.revenue)
          expect(after.revenue).toBe(0)
          checked.add(`${b.name}:${cover}`)
          break
        }
      }
      // farming and building homes are possible on every clearable cover, so both were checked
      expect(checked.has(`cropland:${cover}`), `cropland on cover ${cover}`).toBe(true)
      expect(checked.has(`housing:${cover}`), `housing on cover ${cover}`).toBe(true)
    }
    expect(checked.size).toBeGreaterThanOrEqual(12)
    // the surcharges are real: forest and wetland cost more to remove than grass
    expect(removalCost(C.forest)).toBe(ECON.capex.value.clear + ECON.capex.value.clearForestExtra)
    expect(removalCost(C.wetland)).toBe(ECON.capex.value.clear + ECON.capex.value.drainWetlandExtra)
    expect(removalCost(C.bare)).toBe(0)
  })

  test('invalid placements are rejected with reasons and leave state unchanged', () => {
    const s = s0
    const channel = cells(s, (i) => s.terrain.channel[i] === 1 && !s.terrain.protected[i])[10]
    const steep = cells(s, (i) => s.terrain.slope[i] > 0.2 && !s.terrain.protected[i] && s.layers.structure[i] === S.none)[0]
    const protectedCell = cells(s, (i) => s.terrain.protected[i] === 1)[0]
    const farFromRoad = cells(s, (i) => s.layers.cover[i] === C.grassland && s.terrain.slope[i] < 0.05 && Math.abs((i % 64) - 5) < 2 && !s.terrain.protected[i])[0]
    const hill = cells(s, (i) => s.layers.cover[i] === C.grassland && s.terrain.heightAboveChannelM[i] > 8 && s.terrain.slope[i] < 0.05 && s.terrain.flowAccumulation[i] < 5 && !s.terrain.protected[i])[0]
    const cases: [PlayerAction, string][] = [
      [{ type: 'housing', cells: [channel] }, 'River channel'],
      [{ type: 'housing', cells: [steep] }, 'Too steep'],
      [{ type: 'cropland', cells: [protectedCell], intensity: 'medium', irrigated: false }, 'Protected'],
      [{ type: 'housing', cells: [farFromRoad] }, 'road'],
      [{ type: 'wetland', cells: [hill] }, 'stream'],
      [{ type: 'reservoir', cells: [hill] }, 'Reservoirs need'],
      [{ type: 'waterworks', cells: [hill] }, 'next to the river'],
      [{ type: 'road', cells: [farFromRoad] }, 'connect'],
      [{ type: 'conservation', cells: [farFromRoad] }, 'cropland'],
      [{ type: 'demolish', cells: [farFromRoad] }, 'Nothing to demolish'],
    ]
    for (const [a, reason] of cases) {
      const r = applyAction(s, a)
      expect(r.validation.ok, `${a.type} should be rejected`).toBe(false)
      expect(r.validation.reasons.join(' | ')).toContain(reason)
      expect(r.state).toBe(s)
    }
  })

  test('brushes apply to the valid subset only and charge only for it', () => {
    const s = s0
    const grass = firstValid(s, (c) => ({ type: 'reforest', cells: c }), cells(s, (i) => s.layers.cover[i] === C.grassland), 3)
    const channel = cells(s, (i) => s.terrain.channel[i] === 1)[5]
    const a: PlayerAction = { type: 'reforest', cells: [...grass, channel] }
    const v = validateAction(s, a)
    expect(v.ok).toBe(true)
    expect(v.cellOk).toEqual([true, true, true, false])
    expect(v.cost).toBe(3 * ECON.capex.value.reforest)
    const s1 = applyAction(s, a).state
    expect(s1.layers.cover[channel]).toBe(s.layers.cover[channel])
    grass.forEach((i) => expect(s1.layers.cover[i]).toBe(C.forest))
  })

  test('cannot spend more than the budget', () => {
    const s = { ...initial(), economy: { ...initial().economy, budget: 1000 } }
    const r = applyAction(s, { type: 'reservoir', cells: cells(s, (i) => s.terrain.channel[i] === 1 && s.terrain.flowAccumulation[i] > 200).slice(0, 1) })
    expect(r.validation.ok).toBe(false)
    expect(r.validation.reasons[0]).toContain('Not enough budget')
    expect(r.state.economy.budget).toBe(1000)
  })

  test('new roads must connect to the network; connected chains are accepted', () => {
    const s = s0
    const road = cells(s, (i) => s.layers.structure[i] === S.road)
    const w = s.terrain.width
    // walk west from a road cell, two cells
    const start = road.find((i) => s.layers.structure[i - 1] === S.none && s.layers.structure[i - 2] === S.none && !s.terrain.channel[i - 1] && !s.terrain.channel[i - 2])!
    const chain = [start - 2, start - 1]
    const v = validateAction(s, { type: 'road', cells: chain })
    expect(v.cellOk).toEqual([true, true])
    const isolated = cells(s, (i) => {
      if (s.layers.structure[i] !== S.none || s.terrain.channel[i] || s.terrain.protected[i] || s.terrain.slope[i] > 0.2) return false
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (s.layers.structure[i + dz * w + dx] === S.road) return false
      return s.layers.cover[i] === C.grassland
    })[0]
    const lonely = validateAction(s, { type: 'road', cells: [isolated] })
    expect(lonely.ok).toBe(false)
    expect(lonely.reasons.join()).toContain('connect')
  })

  test('irrigation needs a water source within canal reach and pump lift', () => {
    const s = s0
    const reach = HYDRO.irrigationReachCells.value
    const lift = HYDRO.irrigationMaxLiftM.value
    const sources = irrigationSources(s)
    expect(sources.length).toBeGreaterThan(0)
    const w = s.terrain.width
    const dist = (a: number, b: number) => Math.max(Math.abs((a % w) - (b % w)), Math.abs(Math.floor(a / w) - Math.floor(b / w)))
    const rainfed = cells(s, (i) => s.layers.cover[i] === C.cropland && !s.layers.irrigated[i])
    // reachable fields: within reach of a source and no more than the lift above its water level
    const ok = rainfed.filter((i) => irrigationReachable(s, i))
    expect(ok.length).toBeGreaterThan(0)
    for (const i of ok.slice(0, 5)) {
      expect(sources.some((src) => dist(src.cell, i) <= reach && s.terrain.filledElevationM[i] - s.terrain.filledElevationM[src.waterCell] <= lift)).toBe(true)
      expect(validateAction(s, { type: 'toggle-irrigation', cells: [i] }).ok).toBe(true)
    }
    // a field beyond canal reach of every source is rejected with that reason
    const far = rainfed.find((i) => sources.every((src) => dist(src.cell, i) > reach))
    expect(far).toBeDefined()
    const vFar = validateAction(s, { type: 'toggle-irrigation', cells: [far!] })
    expect(vFar.ok).toBe(false)
    expect(vFar.cellReasons![0]).toContain('Too far from an irrigation source')
    // a field within reach but above the pump lift is rejected with the lift reason
    const high = cells(s, (i) => s.layers.structure[i] === S.none && !s.terrain.channel[i] && !s.terrain.protected[i] && s.terrain.slope[i] < 0.35 && s.layers.cover[i] !== C.water && s.layers.cover[i] !== C.urban).find(
      (i) =>
        sources.some((src) => dist(src.cell, i) <= reach) &&
        sources.every((src) => dist(src.cell, i) > reach || s.terrain.filledElevationM[i] - s.terrain.filledElevationM[src.waterCell] > lift),
    )
    expect(high).toBeDefined()
    expect(irrigationReason(s, high!)).toContain(`at most ${lift} m above`)
    const vHigh = validateAction(rich(s), { type: 'cropland', cells: [high!], intensity: 'medium', irrigated: true })
    expect(vHigh.ok).toBe(false)
    expect(vHigh.cellReasons![0]).toContain('Too high above the water source')
    // the same field can still be farmed rainfed
    expect(validateAction(rich(s), { type: 'cropland', cells: [high!], intensity: 'medium', irrigated: false }).ok).toBe(true)
    // remove every water source: irrigation is no longer possible anywhere
    const works = cells(s, (i) => s.layers.structure[i] === S.waterworks)
    const dry = must(s, { type: 'demolish', cells: works })
    expect(irrigationSources(dry).length).toBe(0)
    const vDry = validateAction(dry, { type: 'toggle-irrigation', cells: [ok[0]] })
    expect(vDry.ok).toBe(false)
    expect(vDry.cellReasons![0]).toContain('No irrigation source')
  })

  test('housing upgrades raise density up to level 3', () => {
    let s = s0
    const home = cells(s, (i) => s.layers.structure[i] === S.housing && s.layers.structureLevel[i] === 1)[0]
    s = must(s, { type: 'housing', cells: [home] })
    s = must(s, { type: 'housing', cells: [home] })
    expect(s.layers.structureLevel[home]).toBe(3)
    expect(validateAction(s, { type: 'housing', cells: [home] }).reasons[0]).toContain('maximum density')
  })

  test('loans add budget and debt within the limit; repayment needs budget and debt', () => {
    const s = initial()
    const l = applyAction(s, { type: 'loan', amount: 100_000 })
    expect(l.validation.ok).toBe(true)
    expect(l.state.economy.budget).toBe(s.economy.budget + 100_000)
    expect(l.state.economy.debt).toBe(100_000)
    expect(applyAction(l.state, { type: 'loan', amount: ECON.maxDebt.value }).validation.ok).toBe(false)
    expect(applyAction(s, { type: 'repay', amount: 10 }).validation.ok).toBe(false)
    const r = applyAction(l.state, { type: 'repay', amount: 40_000 })
    expect(r.state.economy.debt).toBe(60_000)
    expect(applyAction(s, { type: 'loan', amount: -5 }).validation.ok).toBe(false)
    expect(applyAction(s, { type: 'loan', amount: Number.NaN }).validation.ok).toBe(false)
  })

  test('applyAction never mutates its input', () => {
    const s = rich(initial())
    const before = serializeState(s)
    applyAction(s, { type: 'cropland', cells: cells(s, (i) => s.layers.cover[i] === C.forest).slice(0, 30), intensity: 'low', irrigated: false })
    applyAction(s, { type: 'demolish', cells: cells(s, (i) => s.layers.structure[i] !== S.none).slice(0, 10) })
    expect(serializeState(s)).toBe(before)
  })

  test('reservoirs can dam a channel cell and add storage capacity', () => {
    const s = s0
    const site = firstValid(s, (c) => ({ type: 'reservoir', cells: c }), cells(s, (i) => s.terrain.channel[i] === 1 && s.terrain.flowAccumulation[i] > 300))
    const s1 = must(s, { type: 'reservoir', cells: site })
    expect(s1.layers.structure[site[0]]).toBe(S.reservoir)
    expect(s1.layers.cover[site[0]]).toBe(C.water)
  })
})
