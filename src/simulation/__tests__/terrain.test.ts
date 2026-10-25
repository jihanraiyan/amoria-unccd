import { computeFlowAccumulation, computeFlowOrder, computeFlowTo, deriveTerrain, fillDepressions } from '../engine/terrain'
import type { WorldInput } from '../types'
import { WORLD } from './helpers'

describe('terrain derivation', () => {
  const t = deriveTerrain(WORLD)
  const n = t.width * t.height

  test('every D8 receiver is an adjacent cell lower on the filled surface; only edge cells drain off-map', () => {
    for (let i = 0; i < n; i++) {
      const j = t.flowTo[i]
      const x = i % t.width
      const z = Math.floor(i / t.width)
      const edge = x === 0 || z === 0 || x === t.width - 1 || z === t.height - 1
      if (j < 0) {
        expect(edge).toBe(true)
        continue
      }
      expect(Math.max(Math.abs((j % t.width) - x), Math.abs(Math.floor(j / t.width) - z))).toBe(1)
      expect(t.filledElevationM[j]).toBeLessThan(t.filledElevationM[i])
    }
  })

  test('flowOrder is a topological order (upstream before downstream) containing every cell once', () => {
    const pos = new Int32Array(n).fill(-1)
    t.flowOrder.forEach((c, k) => (pos[c] = k))
    expect(new Set(Array.from(t.flowOrder)).size).toBe(n)
    for (let i = 0; i < n; i++) if (t.flowTo[i] >= 0) expect(pos[i]).toBeLessThan(pos[t.flowTo[i]])
  })

  test('flow accumulation is conserved: exits together drain every cell', () => {
    let exits = 0
    for (let i = 0; i < n; i++) if (t.flowTo[i] < 0) exits += t.flowAccumulation[i]
    expect(exits).toBe(n)
  })

  test('the river channel carries most of the basin to the southern outlet', () => {
    let best = 0
    for (let i = 0; i < n; i++) if (t.flowTo[i] < 0) best = Math.max(best, t.flowAccumulation[i])
    expect(best / n).toBeGreaterThan(0.7)
  })

  test('HAND is zero on channels and non-negative everywhere; floodplain cells exist near the river', () => {
    let floodplain = 0
    for (let i = 0; i < n; i++) {
      expect(t.heightAboveChannelM[i]).toBeGreaterThanOrEqual(0)
      if (t.channel[i]) expect(t.heightAboveChannelM[i]).toBe(0)
      if (!t.channel[i] && t.heightAboveChannelM[i] < 3 && t.channelDistance[i] <= 5) floodplain++
    }
    expect(floodplain).toBeGreaterThan(50)
  })

  test('pits are filled so no water is trapped (synthetic bowl with a hole)', () => {
    const w = 9
    const e = new Float32Array(w * w)
    for (let z = 0; z < w; z++) for (let x = 0; x < w; x++) e[z * w + x] = 100 - Math.hypot(x - 4, z - 4) * -2 // bowl, low centre
    e[4 * w + 4] = 50 // deep pit
    const filled = fillDepressions(w, w, e)
    for (let i = 0; i < w * w; i++) expect(filled[i]).toBeGreaterThanOrEqual(e[i])
    const flowTo = computeFlowTo(w, w, 10, filled)
    const order = computeFlowOrder(flowTo)
    const acc = computeFlowAccumulation(flowTo, order)
    let exits = 0
    for (let i = 0; i < w * w; i++) if (flowTo[i] < 0) exits += acc[i]
    expect(exits).toBe(w * w)
    expect(flowTo[4 * w + 4]).toBeGreaterThanOrEqual(0)
  })

  test('slope is zero on a flat plane and equals the gradient on a tilted plane', () => {
    const w = 6
    const flat: WorldInput = { ...WORLD, width: w, height: w, elevationM: new Float32Array(w * w).fill(10), cover: new Uint8Array(w * w), structure: undefined, structureLevel: undefined, channel: undefined, protected: undefined, irrigated: undefined, intensity: undefined }
    expect(Math.max(...deriveTerrain(flat).slope)).toBeCloseTo(0, 6)
    const tilt = new Float32Array(w * w)
    for (let z = 0; z < w; z++) for (let x = 0; x < w; x++) tilt[z * w + x] = 0.1 * x * 100
    const tt = deriveTerrain({ ...flat, cellSizeM: 100, elevationM: tilt })
    expect(tt.slope[2 * w + 2]).toBeCloseTo(0.1, 5)
  })
})
