import { generateDemography } from '../events/demography'
import { generateWeather } from '../events/weather'
import { CLIMATE } from '../params'
import { initial, must, rich, cells } from './helpers'
import { createInitialState, step } from '../engine'
import { C } from '../models/cells'
import { WORLD } from './helpers'

describe('exogenous weather', () => {
  test('is deterministic for a seed and differs between seeds', () => {
    expect(generateWeather(7)).toEqual(generateWeather(7))
    expect(generateWeather(7).map((w) => w.rainfallMm)).not.toEqual(generateWeather(8).map((w) => w.rainfallMm))
  })

  test('alternates wet and dry seasons, two per year', () => {
    const w = generateWeather(3, { years: 10 })
    expect(w).toHaveLength(20)
    w.forEach((s, k) => {
      expect(s.season).toBe(k % 2 === 0 ? 'wet' : 'dry')
      expect(s.year).toBe(Math.floor(k / 2) + 1)
    })
  })

  test('is prefix-stable so the sandbox can extend it without changing the guided run', () => {
    const short = generateWeather(11, { years: 30 })
    const long = generateWeather(11, { years: 100 })
    expect(long.slice(0, short.length)).toEqual(short)
  })

  test('guided design: calm start, a multi-season drought and a heavy-rain season within 20 years, for every seed', () => {
    const g = CLIMATE.guided.value
    for (let seed = 1; seed <= 60; seed++) {
      const w = generateWeather(seed).slice(0, 40)
      for (let s = 0; s < g.graceYears * 2; s++) expect(['normal', 'favorable']).toContain(w[s].kind)
      let run = 0
      let longest = 0
      for (const s of w) {
        run = s.kind === 'drought' ? run + 1 : 0
        longest = Math.max(longest, run)
      }
      expect(longest).toBeGreaterThanOrEqual(2)
      expect(w.some((s) => s.kind === 'heavy-rain')).toBe(true)
    }
  })

  test('droughts are drier and heavy-rain seasons wetter and stormier than normal', () => {
    const w = generateWeather(5)
    for (const s of w) {
      if (s.kind === 'drought') expect(s.rainfallMm).toBeLessThan(s.normalRainfallMm * 0.6)
      if (s.kind === 'heavy-rain') {
        expect(s.rainfallMm).toBeGreaterThan(s.normalRainfallMm * 1.5)
        expect(s.stormIntensity).toBeGreaterThan(1.6)
      }
    }
  })

  test('never reads player state: actions and steps leave the weather and demography untouched', () => {
    const a = initial()
    let b = rich(a)
    b = must(b, { type: 'clear', cells: cells(b, (i) => b.layers.cover[i] === C.forest && !b.terrain.protected[i]).slice(0, 200) })
    for (let k = 0; k < 6; k++) b = step(b).state
    expect(b.weather).toEqual(a.weather)
    expect(b.demography).toEqual(a.demography)
    const fresh = createInitialState(WORLD, a.seed)
    expect(fresh.weather).toEqual(a.weather)
  }, 30_000)

  test('demographic pressure is seeded, positive and peaks mid-game', () => {
    const d = generateDemography(9, 40)
    expect(d).toEqual(generateDemography(9, 40))
    const early = d.slice(0, 6).reduce((x, y) => x + y.migrationPressure, 0)
    const mid = d.slice(14, 20).reduce((x, y) => x + y.migrationPressure, 0)
    expect(mid).toBeGreaterThan(early)
    d.forEach((s) => expect(s.naturalGrowthRate).toBeGreaterThanOrEqual(0))
  })
})

test('weather past the generated sequence extends deterministically with the same prefix', async () => {
  const { weatherForStep } = await import('../events/weather')
  const w = generateWeather(4, { years: 10 })
  const extended = weatherForStep(4, w, 30, 20)
  expect(extended).toEqual(generateWeather(4)[30])
})
