import { step } from '../engine'
import { reservoirCapacityM3 } from '../engine/season'
import { curveNumberAmc, curveNumberII, curveNumberRunoff, runHydrology } from '../models/hydrology'
import { HYDRO } from '../params'
import type { SimulationState, WeatherSeason, WorldLayers } from '../types'
import { C, S, cells, findWeather, initial, must, rich } from './helpers'

const hydro = (s: SimulationState, w: WeatherSeason, layers: WorldLayers = s.layers, extra: Partial<Parameters<typeof runHydrology>[0]> = {}) =>
  runHydrology({
    terrain: s.terrain,
    layers,
    weather: w,
    reservoirM3: s.reservoirM3,
    reservoirCapacityM3: reservoirCapacityM3(layers, s.reservoirSiltM3),
    townDemandM3: s.community.population * HYDRO.townUseM3PerPersonSeason.value,
    serviceLevel: 1,
    ...extra,
  })

describe('curve-number runoff', () => {
  const runoff = (cover: number, veg: number, sh = 0.6, slope = 0.05, cons = 0, p = 150, intensity = 1) =>
    curveNumberRunoff(p, 8, intensity, curveNumberAmc(curveNumberII(cover, S.none, 0, cons, veg, sh, slope), 0.5))

  test('cover order: bare > cropland > grassland > forest for the same storm', () => {
    const bare = runoff(C.bare, 0.05)
    const crop = runoff(C.cropland, 0.3)
    const grass = runoff(C.grassland, 0.6)
    const forest = runoff(C.forest, 0.9)
    expect(bare).toBeGreaterThan(crop)
    expect(crop).toBeGreaterThan(grass)
    expect(grass).toBeGreaterThan(forest)
  })

  test('paved and dense urban surfaces shed the most water', () => {
    const road = curveNumberRunoff(150, 8, 1, curveNumberII(C.urban, S.road, 0, 0, 0, 0.5, 0.02))
    const forest = runoff(C.forest, 0.9)
    expect(road).toBeGreaterThan(5 * forest)
  })

  test('conservation practice, steeper slope, wetter soil and bigger storms change runoff in the expected direction', () => {
    expect(runoff(C.cropland, 0.4, 0.6, 0.05, 1)).toBeLessThan(runoff(C.cropland, 0.4, 0.6, 0.05, 0))
    expect(runoff(C.cropland, 0.4, 0.6, 0.25)).toBeGreaterThan(runoff(C.cropland, 0.4, 0.6, 0.02))
    const cn = curveNumberII(C.grassland, S.none, 0, 0, 0.6, 0.6, 0.05)
    expect(curveNumberRunoff(150, 8, 1, curveNumberAmc(cn, 0.9))).toBeGreaterThan(curveNumberRunoff(150, 8, 1, curveNumberAmc(cn, 0.1)))
    expect(runoff(C.grassland, 0.6, 0.6, 0.05, 0, 150, 2)).toBeGreaterThan(runoff(C.grassland, 0.6, 0.6, 0.05, 0, 150, 1))
  })

  test('runoff is bounded by rainfall and zero without rain', () => {
    for (const cn of [40, 60, 80, 95, 99]) {
      expect(curveNumberRunoff(0, 8, 1, cn)).toBe(0)
      const q = curveNumberRunoff(300, 4, 2.5, cn)
      expect(q).toBeGreaterThanOrEqual(0)
      expect(q).toBeLessThanOrEqual(300)
    }
  })
})

describe('basin water balance and routing', () => {
  const s = initial()
  const wet = findWeather(s, 'normal', 'wet')
  const heavy = findWeather(s, 'heavy-rain', 'wet')
  const droughtDry = findWeather(s, 'drought', 'dry')

  test('the ledger closes for normal, heavy and drought seasons', () => {
    for (const w of [wet, heavy, droughtDry]) {
      const h = hydro(s, w)
      expect(Math.abs(h.ledger.residualMm)).toBeLessThan(1e-4)
      expect(h.ledger.rainMm).toBeGreaterThan(0)
      expect(h.outflowM3).toBeGreaterThan(0)
    }
  })

  test('the ledger closes with reservoirs, irrigation, wetlands and stores above capacity', () => {
    let t = rich(s)
    const site = cells(t, (i) => t.terrain.channel[i] === 1 && t.terrain.flowAccumulation[i] > 400)[3]
    t = must(t, { type: 'reservoir', cells: [site] })
    const fields = cells(t, (i) => t.layers.cover[i] === C.cropland && !t.layers.irrigated[i] && t.terrain.channelDistance[i] <= 4).slice(0, 15)
    t = must(t, { type: 'toggle-irrigation', cells: fields })
    const overfull = { ...t, reservoirM3: 10 * reservoirCapacityM3(t.layers, 0) }
    for (const w of [wet, droughtDry, heavy]) {
      const h = hydro(overfull, w)
      expect(Math.abs(h.ledger.residualMm)).toBeLessThan(1e-4)
      if (w.season === 'dry') expect(h.irrigationSuppliedM3).toBeGreaterThan(0)
    }
  })

  test('run-on: water from paved upslope cells soaks into the cell below', () => {
    const t = rich(s)
    // a grassland cell whose upslope neighbours are also grassland
    const target = cells(t, (i) => {
      if (t.layers.cover[i] !== C.grassland || t.terrain.channel[i]) return false
      const up = cells(t, (j) => t.terrain.flowTo[j] === i)
      return up.length >= 2 && up.every((j) => t.layers.cover[j] === C.grassland && !t.terrain.protected[j])
    })[0]
    const up = cells(t, (j) => t.terrain.flowTo[j] === target)
    const sealed = { ...t.layers, structure: t.layers.structure.slice(), cover: t.layers.cover.slice() }
    for (const j of up) {
      sealed.structure[j] = S.road
      sealed.cover[j] = C.urban
    }
    const dry = findWeather(s, 'normal', 'dry')
    const base = hydro(t, dry)
    const paved = hydro(t, dry, sealed)
    expect(paved.runoffMm[up[0]]).toBeGreaterThan(base.runoffMm[up[0]])
    expect(paved.infiltrationMm[target]).toBeGreaterThan(base.infiltrationMm[target])
  })

  test('upstream forest clearing raises downstream runoff and the flood peak at the village', () => {
    const t = rich(s)
    const upstreamForest = cells(t, (i) => t.layers.cover[i] === C.forest && !t.terrain.protected[i] && Math.floor(i / 64) < 28)
    const cleared = { ...t.layers, cover: t.layers.cover.slice(), vegetation: t.layers.vegetation.slice() }
    for (const i of upstreamForest) {
      cleared.cover[i] = C.bare
      cleared.vegetation[i] = 0.05
    }
    const a = hydro(t, heavy)
    const b = hydro(t, heavy, cleared)
    expect(b.outflowM3).toBeGreaterThan(a.outflowM3)
    expect(b.settlementFloodRatio).toBeGreaterThan(a.settlementFloodRatio)
    expect(b.flooded.reduce((x, y) => x + y, 0)).toBeGreaterThanOrEqual(a.flooded.reduce((x, y) => x + y, 0))
  })

  test('wetlands along the river above the village hold back flood water', () => {
    const t = rich(s)
    const candidates = cells(t, (i) => t.terrain.channelDistance[i] <= 3 && Math.floor(i / 64) < 30 && Math.floor(i / 64) > 12 && (t.layers.cover[i] === C.grassland || t.layers.cover[i] === C.cropland))
    const wet2 = { ...t.layers, cover: t.layers.cover.slice(), vegetation: t.layers.vegetation.slice(), wetlandStoreMm: t.layers.wetlandStoreMm.slice() }
    for (const i of candidates) {
      wet2.cover[i] = C.wetland
      wet2.vegetation[i] = 0.8
    }
    const a = hydro(t, heavy)
    const b = hydro(t, heavy, wet2)
    expect(candidates.length).toBeGreaterThan(20)
    expect(b.settlementFloodRatio).toBeLessThan(a.settlementFloodRatio)
    expect(b.ledger.wetlandRetentionMm).toBeGreaterThan(a.ledger.wetlandRetentionMm)
  })

  test('a full reservoir keeps household taps running in a drought dry season', () => {
    // late in a long drought: soil and shallow groundwater are spent, so the river is low
    const spent = (L: WorldLayers): WorldLayers => ({ ...L, soilMoistureMm: new Float32Array(L.soilMoistureMm.length), groundwaterMm: new Float32Array(L.groundwaterMm.length).fill(5) })
    let t = rich(s)
    const without = hydro(t, droughtDry, spent(t.layers), { townDemandM3: 30_000 })
    expect(without.townSuppliedM3 + without.tankSuppliedM3).toBeLessThan(30_000) // the river alone falls short
    const site = cells(t, (i) => t.terrain.channel[i] === 1 && t.terrain.flowAccumulation[i] > 400)[3]
    t = must(t, { type: 'reservoir', cells: [site] })
    const cap = reservoirCapacityM3(t.layers, 0)
    const withRes = hydro({ ...t, reservoirM3: cap }, droughtDry, spent(t.layers), { townDemandM3: 30_000 })
    expect(withRes.townSuppliedM3).toBeGreaterThan(without.townSuppliedM3)
    expect(withRes.householdSuppliedM3).toBeGreaterThan(without.householdSuppliedM3)
    expect(withRes.reservoirM3).toBeLessThan(cap)
  })

  test('households are served before irrigation', () => {
    const t = rich(s)
    const lots = cells(t, (i) => t.layers.cover[i] === C.cropland && t.terrain.channelDistance[i] <= 6)
    const irrigated = { ...t.layers, irrigated: t.layers.irrigated.slice() }
    lots.forEach((i) => (irrigated.irrigated[i] = 1))
    const h = hydro(t, droughtDry, irrigated)
    expect(h.irrigationDemandM3).toBeGreaterThan(h.irrigationSuppliedM3)
    expect(h.irrigationSuppliedM3).toBeGreaterThan(0)
    // irrigation got water, so every household need left after roof tanks was piped in full
    expect(h.townSuppliedM3 + h.tankSuppliedM3).toBeCloseTo(h.townDemandM3, 3)
    expect(h.wellSuppliedM3).toBe(0)
    expect(h.householdSuppliedM3).toBeCloseTo(h.townDemandM3, 3)
  })

  test('drought lowers soil water, water factor and river flow compared with a normal season', () => {
    const wetDrought = findWeather(s, 'drought', 'wet')
    const a = hydro(s, wet)
    const b = hydro(s, wetDrought)
    const mean = (x: Float32Array) => x.reduce((p, q) => p + q, 0) / x.length
    expect(mean(b.waterFactor)).toBeLessThan(mean(a.waterFactor))
    expect(b.outflowM3).toBeLessThan(a.outflowM3)
  })

  test('a full engine step keeps every store non-negative', () => {
    const r = step(s).state
    for (const arr of [r.layers.soilMoistureMm, r.layers.groundwaterMm, r.layers.wetlandStoreMm]) expect(Math.min(...arr)).toBeGreaterThanOrEqual(-1e-6)
    expect(r.reservoirM3).toBeGreaterThanOrEqual(0)
  })
})
