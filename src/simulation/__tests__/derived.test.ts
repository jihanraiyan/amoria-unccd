import { SENSITIVITY_DRIVERS, environmentalSensitivity, erosionSusceptibility, floodExposure, productivity, sensitivityParts, urbanIntensity } from '../derived/overlays'
import { inspectCell } from '../derived/inspect'
import { C, S, cells, initial, must, rich } from './helpers'

describe('derived overlays and inspector', () => {
  const s = initial()

  test('overlays are finite, sized to the grid and zero on water', () => {
    for (const f of [erosionSusceptibility, floodExposure, environmentalSensitivity, productivity, urbanIntensity]) {
      const a = f(s)
      expect(a).toHaveLength(4096)
      expect(a.every(Number.isFinite)).toBe(true)
      const ch = cells(s, (i) => s.terrain.channel[i] === 1)[0]
      expect(a[ch]).toBe(0)
    }
  })

  test('sensitivity parts: the index is the largest part, and the driver names it', () => {
    const p = sensitivityParts(s)
    const idx = environmentalSensitivity(s)
    const flood = floodExposure(s)
    const seen = new Set<string>()
    for (let i = 0; i < idx.length; i++) {
      const parts = [p.erosion[i], p.flood[i], p.streamBank[i], p.wetland[i]]
      expect(p.max[i]).toBe(idx[i])
      expect(p.max[i]).toBe(Math.max(...parts))
      expect(p.flood[i]).toBe(flood[i])
      for (const v of parts) expect(v >= 0 && v <= 1).toBe(true)
      if (p.max[i] === 0) expect(p.driver[i]).toBe(0)
      else expect(parts[p.driver[i] - 1]).toBe(p.max[i])
      seen.add(SENSITIVITY_DRIVERS[p.driver[i]])
    }
    // every kind of driver occurs on the valley
    for (const d of ['erosion', 'flood', 'stream-bank', 'wetland']) expect(seen.has(d), d).toBe(true)
  })

  test('erosion susceptibility rises when steep forest is cleared', () => {
    const t = rich(s)
    const steep = cells(t, (i) => t.layers.cover[i] === C.forest && t.terrain.slope[i] > 0.2 && !t.terrain.protected[i]).slice(0, 5)
    const cleared = must(t, { type: 'clear', cells: steep })
    const a = erosionSusceptibility(t)
    const b = erosionSusceptibility(cleared)
    for (const i of steep) expect(b[i]).toBeGreaterThan(a[i])
  })

  test('floodplain homes are more flood exposed than hillside cells', () => {
    const f = floodExposure(s)
    const low = cells(s, (i) => s.terrain.heightAboveChannelM[i] < 1.5 && s.terrain.channel[i] === 0)
    const high = cells(s, (i) => s.terrain.heightAboveChannelM[i] > 20)
    expect(Math.min(...low.map((i) => f[i]))).toBeGreaterThan(Math.max(...high.map((i) => f[i])))
  })

  test('the inspector reports cell values and which interventions are possible', () => {
    const home = cells(s, (i) => s.layers.structure[i] === S.housing)[0]
    const r = inspectCell(s, home)
    expect(r.structure).toBe('housing')
    expect(r.soil.health).toBe(s.layers.soilHealth[home])
    expect(r.interventions.find((o) => o.type === 'demolish')!.ok).toBe(true)
    expect(r.interventions.find((o) => o.type === 'reforest')!.reason).toContain('structure')
    const grass = cells(s, (i) => s.layers.cover[i] === C.grassland && !s.terrain.protected[i])[0]
    const g = inspectCell(s, grass)
    expect(g.interventions.find((o) => o.type === 'reforest')!.ok).toBe(true)
    expect(g.interventions.find((o) => o.type === 'reforest')!.cost).toBeGreaterThan(0)
  })
})
