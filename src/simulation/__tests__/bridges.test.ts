// Roads over a river channel or open water are bridges: they join the road network but leave
// the water below untouched.
import { applyAction, step, validateAction } from '../engine'
import { ECON } from '../params'
import { isBridge } from '../models/cells'
import type { SimulationState } from '../types'
import { C, S, cells, initial, must, rich } from './helpers'

/** A state with a road laid right next to a river cell, and that river cell. */
function besideRiver(): { s: SimulationState; river: number; bank: number } {
  const s0 = rich(initial())
  const { width, height } = s0.terrain
  const road = cells(s0, (i) => s0.layers.structure[i] === S.road)
  // the river cell closest to the existing network, with a dry, free bank cell on the road side
  for (const r of road) {
    for (const d of [1, -1, width, -width]) {
      const bank = r + d
      const river = bank + d
      if (river < 0 || river >= width * height) continue
      if (s0.terrain.channel[river] !== 1 || s0.terrain.protected[river]) continue
      if (s0.terrain.channel[bank] || s0.layers.structure[bank] !== S.none) continue
      const s = must(s0, { type: 'road', cells: [bank] })
      return { s, river, bank }
    }
  }
  // no river two cells from a road: walk the road toward the nearest channel cell
  const river = cells(s0, (i) => s0.terrain.channel[i] === 1 && !s0.terrain.protected[i])[0]
  const structure = s0.layers.structure.slice()
  const bank = river - 1
  structure[bank] = S.road
  return { s: { ...s0, layers: { ...s0.layers, structure } }, river, bank }
}

describe('bridges', () => {
  test('a road onto a river cell is accepted as a bridge at the bridge price', () => {
    const { s, river } = besideRiver()
    const v = validateAction(s, { type: 'road', cells: [river] })
    expect(v.ok).toBe(true)
    expect(v.cost).toBe(ECON.capex.value.bridge)
    const s1 = must(s, { type: 'road', cells: [river] })
    expect(s1.layers.structure[river]).toBe(S.road)
    expect(s1.terrain.channel[river]).toBe(1)
    // the river keeps its water cover: the bridge spans it
    expect(s1.layers.cover[river]).toBe(s.layers.cover[river])
    expect(isBridge(s1.terrain, s1.layers, river)).toBe(true)
  })

  test('other building on a river is still refused', () => {
    const { s, river } = besideRiver()
    expect(validateAction(s, { type: 'housing', cells: [river] }).ok).toBe(false)
    expect(validateAction(s, { type: 'market', cells: [river] }).ok).toBe(false)
  })

  test('a bridge leaves the water, soil and floods exactly as they were', () => {
    const { s, river } = besideRiver()
    const withBridge = must(s, { type: 'road', cells: [river] })
    const a = step(s).state
    const b = step(withBridge).state
    expect(Array.from(b.fields.flowMm)).toEqual(Array.from(a.fields.flowMm))
    expect(Array.from(b.fields.runoffMm)).toEqual(Array.from(a.fields.runoffMm))
    expect(Array.from(b.fields.flooded)).toEqual(Array.from(a.fields.flooded))
    expect(Array.from(b.fields.sedimentFlux)).toEqual(Array.from(a.fields.sedimentFlux))
  })

  test('demolishing a bridge leaves the river, not bare ground', () => {
    const { s, river } = besideRiver()
    const s1 = must(s, { type: 'road', cells: [river] })
    const s2 = must(s1, { type: 'demolish', cells: [river] })
    expect(s2.layers.structure[river]).toBe(S.none)
    expect(s2.layers.cover[river]).toBe(C.water)
    expect(applyAction(s2, { type: 'road', cells: [river] }).validation.ok).toBe(true)
  })
})
