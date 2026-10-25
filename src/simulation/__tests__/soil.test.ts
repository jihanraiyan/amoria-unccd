import { createInitialState, referenceSeason, step } from '../engine'
import { contouringP, coverFactor, erodibility, landPressure, lossTaper, lsFactor, runSoil, softCapErosion } from '../models/soil'
import { AGRI, COMMUNITY, SOIL } from '../params'
import { fodderUnits, grazingCoverMult, grazingPressure, grazingSoilMult } from '../models/grazing'
import { runVegetation } from '../models/vegetation'
import { runHydrology } from '../models/hydrology'
import { reservoirCapacityM3 } from '../engine/season'
import type { SimulationState, WeatherSeason, WorldLayers } from '../types'
import { C, KAANI_WORLD, S, cells, findWeather, initial, must, rich } from './helpers'

function soilRun(s: SimulationState, w: WeatherSeason, layers: WorldLayers = s.layers) {
  const h = runHydrology({ terrain: s.terrain, layers, weather: w, reservoirM3: 0, reservoirCapacityM3: reservoirCapacityM3(layers, 0), townDemandM3: 10_000, serviceLevel: 1 })
  return runSoil({ terrain: s.terrain, layers, weather: w, rainMm: h.rainMm, waterFactor: h.waterFactor })
}

describe('erosion and sediment', () => {
  const s = rich(initial())
  const heavy = findWeather(s, 'heavy-rain', 'wet')

  test('factor directions: steeper slope, less cover, degraded soil all raise erosion pressure', () => {
    expect(lsFactor(0.3, 3, 100)).toBeGreaterThan(lsFactor(0.1, 3, 100))
    expect(coverFactor(C.bare, 0, 1, 0.05)).toBeGreaterThan(coverFactor(C.grassland, 0, 1, 0.6))
    expect(coverFactor(C.grassland, 0, 1, 0.6)).toBeGreaterThan(coverFactor(C.forest, 0, 1, 0.9))
    expect(coverFactor(C.cropland, 0, 2, 0.5)).toBeGreaterThan(coverFactor(C.cropland, 0, 0, 0.5))
    expect(erodibility(0.2)).toBeGreaterThan(erodibility(0.8))
  })

  test('forest to bare on a susceptible slope increases erosion under identical conditions', () => {
    const steepForest = cells(s, (i) => s.layers.cover[i] === C.forest && s.terrain.slope[i] > 0.2 && !s.terrain.protected[i]).slice(0, 25)
    const bare = { ...s.layers, cover: s.layers.cover.slice(), vegetation: s.layers.vegetation.slice() }
    steepForest.forEach((i) => {
      bare.cover[i] = C.bare
      bare.vegetation[i] = 0.05
    })
    const a = soilRun(s, heavy)
    const b = soilRun(s, heavy, bare)
    for (const i of steepForest) expect(b.erosion[i]).toBeGreaterThan(5 * a.erosion[i])
    expect(b.outletSedimentT).toBeGreaterThan(a.outletSedimentT)
  })

  test('conservation practice scales erosion on a field by the contouring P for its slope', () => {
    const fields = cells(s, (i) => s.layers.cover[i] === C.cropland && s.terrain.slope[i] > 0.03 && s.terrain.slope[i] < 0.35).slice(0, 20)
    expect(fields.length).toBeGreaterThan(5)
    const t = must(s, { type: 'conservation', cells: fields })
    const a = soilRun(s, heavy)
    const b = soilRun(t, heavy)
    for (const i of fields) {
      expect(a.erosion[i]).toBeGreaterThan(0)
      expect(b.erosion[i] / a.erosion[i]).toBeCloseTo(contouringP(s.terrain.slope[i]), 4)
      expect(b.erosion[i]).toBeLessThan(a.erosion[i])
    }
  })

  test('contouring P follows the AH-537 table: best on moderate slopes, weaker on gentle and steep ones', () => {
    const table = SOIL.pContouring.value
    for (const [slope, p] of table) expect(contouringP(slope)).toBeCloseTo(p, 9)
    // 3 to 8% is the most effective class; P rises monotonically from there to the steep limit
    expect(contouringP(0.05)).toBe(0.5)
    expect(contouringP(0.015)).toBeGreaterThan(contouringP(0.05))
    let prev = contouringP(0.07)
    for (let sl = 0.08; sl <= 0.4; sl += 0.01) {
      const p = contouringP(sl)
      expect(p).toBeGreaterThanOrEqual(prev - 1e-12)
      expect(p).toBeLessThanOrEqual(1)
      prev = p
    }
    expect(contouringP(SOIL.pSteepLimit.value.slope)).toBe(SOIL.pSteepLimit.value.p)
    expect(contouringP(0.6)).toBe(1)
  })

  test('sediment mass balance: eroded = deposited + leaving the map', () => {
    for (const w of [heavy, findWeather(s, 'normal', 'wet'), findWeather(s, 'normal', 'dry')]) {
      const r = soilRun(s, w)
      expect(r.depositedT + r.outletSedimentT).toBeCloseTo(r.totalErosionT, 3)
    }
  })

  test('erosion upstream is deposited downstream: sediment arriving at the village rises after upstream clearing', () => {
    const upstream = cells(s, (i) => s.layers.cover[i] === C.forest && !s.terrain.protected[i] && Math.floor(i / 64) < 26)
    const cleared = { ...s.layers, cover: s.layers.cover.slice(), vegetation: s.layers.vegetation.slice() }
    upstream.forEach((i) => {
      cleared.cover[i] = C.bare
      cleared.vegetation[i] = 0.05
    })
    const a = soilRun(s, heavy)
    const b = soilRun(s, heavy, cleared)
    const village = cells(s, (i) => Math.floor(i / 64) >= 30 && Math.floor(i / 64) <= 38 && s.terrain.channel[i] === 1)
    const flux = (r: ReturnType<typeof soilRun>) => village.reduce((x, i) => x + r.sedimentFlux[i], 0)
    expect(flux(b)).toBeGreaterThan(1.2 * flux(a))
  })

  test('restoration reduces degradation pressure over time where conditions support it', () => {
    const steepBare = cells(s, (i) => s.terrain.slope[i] > 0.12 && (s.layers.cover[i] === C.grassland || s.layers.cover[i] === C.bare) && !s.terrain.protected[i]).slice(0, 30)
    let bare = must(s, { type: 'clear', cells: steepBare.filter((i) => s.layers.cover[i] === C.grassland) })
    let restored = must(bare, { type: 'reforest', cells: steepBare })
    const sumE = (st: SimulationState) => steepBare.reduce((x, i) => x + st.fields.erosion[i], 0)
    const sumSH = (st: SimulationState) => steepBare.reduce((x, i) => x + st.layers.soilHealth[i], 0)
    const early: number[] = []
    const late: number[] = []
    for (let k = 0; k < 30; k++) {
      bare = step(bare).state
      restored = step(restored).state
      const w = restored.history.at(-1)!
      if (w.season !== 'wet' || w.weather !== 'normal') continue
      const ratio = sumE(restored) / Math.max(1e-9, sumE(bare))
      if (k < 8) early.push(ratio)
      else if (k > 20) late.push(ratio)
    }
    expect(early.length).toBeGreaterThan(0)
    expect(late.length).toBeGreaterThan(0)
    expect(Math.max(...late)).toBeLessThan(Math.min(...early))
    expect(sumSH(restored)).toBeGreaterThan(sumSH(bare))
  }, 30_000)

  test('soil health stays within bounds even under extreme abuse', () => {
    let t = s
    const all = cells(t, (i) => t.layers.cover[i] === C.forest && !t.terrain.protected[i])
    t = must(t, { type: 'clear', cells: all })
    for (let k = 0; k < 20; k++) t = step(t).state
    expect(Math.min(...t.layers.soilHealth)).toBeGreaterThanOrEqual(0.05)
    expect(Math.max(...t.layers.soilHealth)).toBeLessThanOrEqual(1)
  }, 30_000)
})

describe('erosion keeps responding on the real-data Kaani map (no hard cap, no soil floor)', () => {
  const k = rich(createInitialState(KAANI_WORLD, 42))
  const normal = referenceSeason('wet')
  const heavy = findWeather(k, 'heavy-rain', 'wet')
  const erodible = cells(k, (i) => !k.terrain.channel[i] && k.layers.cover[i] !== C.water && coverFactor(k.layers.cover[i], k.layers.structure[i], k.layers.intensity[i], k.layers.vegetation[i], k.layers.structureLevel[i]) > 0)
  // a cell is saturated where the soft ceiling has halved its response to more erosive force
  const knee = SOIL.maxErosion.value
  const saturatedAt = knee + Math.LN2 * (SOIL.erosionCeiling.value - knee)

  test('the soft ceiling is continuous, strictly rising, and never reached', () => {
    expect(softCapErosion(100)).toBe(100)
    expect(softCapErosion(knee)).toBe(knee)
    let prev = 0
    for (const a of [10, 149, 150, 151, 300, 1000, 3000, 10_000, 50_000]) {
      const e = softCapErosion(a)
      expect(e).toBeGreaterThan(prev)
      expect(e).toBeLessThan(SOIL.erosionCeiling.value)
      prev = e
    }
    expect(softCapErosion(knee + 1e-3) - knee).toBeCloseTo(1e-3, 6)
  })

  test('under 1% of erodible land saturates in a normal wet season, and heavy rain erodes every cell more', () => {
    const n = soilRun(k, normal)
    const h = soilRun(k, heavy)
    const sat = erodible.filter((i) => n.erosion[i] >= saturatedAt).length
    expect(sat / erodible.length).toBeLessThan(0.01)
    for (const i of erodible) expect(h.erosion[i], `cell ${i}`).toBeGreaterThan(n.erosion[i])
  })

  test('no cell starts on the soil-health floor, and losses taper off toward it', () => {
    const land = cells(k, (i) => !k.terrain.channel[i] && k.layers.cover[i] !== C.water && k.layers.structure[i] === S.none)
    expect(land.filter((i) => k.layers.soilHealth[i] <= SOIL.bounds.value.min + 1e-4).length).toBe(0)
    expect(lossTaper(SOIL.bounds.value.min)).toBe(0)
    expect(lossTaper(0.1)).toBeLessThan(lossTaper(0.2))
    expect(lossTaper(0.6)).toBeGreaterThan(0.99)
  })

  test('clearing the 60 steepest forest cells: the storm signal is not clipped', () => {
    const forest = cells(k, (i) => k.layers.cover[i] === C.forest && !k.terrain.protected[i]).sort((a, b) => k.terrain.slope[b] - k.terrain.slope[a]).slice(0, 60)
    expect(forest.length).toBe(60)
    const ratio = (layers: WorldLayers) => {
      const n = soilRun(k, normal, layers)
      const h = soilRun(k, heavy, layers)
      return forest.reduce((a, i) => a + h.erosion[i], 0) / forest.reduce((a, i) => a + n.erosion[i], 0)
    }
    const cleared = must(k, { type: 'clear', cells: forest }).layers
    const n0 = soilRun(k, normal)
    const n1 = soilRun(k, normal, cleared)
    expect(forest.reduce((a, i) => a + n1.erosion[i], 0)).toBeGreaterThan(5 * forest.reduce((a, i) => a + n0.erosion[i], 0))
    const rForest = ratio(k.layers)
    const rCleared = ratio(cleared)
    expect(rCleared).toBeGreaterThan(1.5)
    expect(rCleared).toBeGreaterThan(0.5 * rForest)
  })
})

describe('grazing pressure on pasture', () => {
  test('pressure is the herd over the fodder land, against the starting homes full', () => {
    const s = initial()
    const ref = s.baseline.housingCapacity * COMMUNITY.overcrowding.value
    const f0 = s.baseline.fodderUnits!
    expect(f0).toBeCloseTo(fodderUnits(s.layers), 6)
    // the starting town and land: no overgrazing
    expect(grazingPressure(s.layers, s.community.population, ref, f0)).toBeLessThanOrEqual(1)
    expect(grazingPressure(s.layers, ref, ref, f0)).toBeCloseTo(1, 9)
    // twice the town on the same land: herd grows with the square root of the population
    expect(grazingPressure(s.layers, 2 * ref, ref, f0)).toBeCloseTo(Math.pow(2, AGRI.livestock.value.herdElasticity), 9)
    // fodder trees on pasture add fodder and relieve the pressure
    const grass = cells(s, (i) => s.layers.cover[i] === C.grassland && s.layers.structure[i] === S.none).slice(0, 100)
    const cover = s.layers.cover.slice()
    for (const i of grass) cover[i] = C.agroforestry
    const L = { ...s.layers, cover }
    expect(grazingPressure(L, 2 * ref, ref, f0)).toBeLessThan(grazingPressure(s.layers, 2 * ref, ref, f0))
    // older saves without a fodder baseline see no pressure
    expect(grazingPressure(s.layers, 2 * ref, ref, undefined)).toBe(1)
  })

  test('overgrazed pasture loses soil faster and holds less grass', () => {
    const s = initial()
    const w = s.weather[0]
    const h = runHydrology({ terrain: s.terrain, layers: s.layers, weather: w, reservoirM3: 0, reservoirCapacityM3: reservoirCapacityM3(s.layers, 0), townDemandM3: 0, serviceLevel: 1 })
    const base = { terrain: s.terrain, layers: s.layers, weather: w, rainMm: h.rainMm, waterFactor: h.waterFactor }
    const calm = runSoil(base)
    const over = runSoil({ ...base, grazingPressure: 1.5 })
    const vCalm = runVegetation(s.layers, h.waterFactor, w.season, s.terrain.channel)
    const vOver = runVegetation(s.layers, h.waterFactor, w.season, s.terrain.channel, 1.5)
    const pasture = cells(s, (i) => s.layers.cover[i] === C.grassland && s.layers.structure[i] === S.none && !s.terrain.channel[i])
    expect(pasture.length).toBeGreaterThan(50)
    let lower = 0
    for (const i of pasture) {
      expect(over.soilHealth[i]).toBeLessThanOrEqual(calm.soilHealth[i] + 1e-7)
      if (over.soilHealth[i] < calm.soilHealth[i] - 1e-7) lower++
      expect(vOver.vegetation[i]).toBeLessThanOrEqual(vCalm.vegetation[i] + 1e-7)
    }
    expect(lower).toBeGreaterThan(0.5 * pasture.length)
    expect(landPressure(C.grassland, 0, 1, 0, 'wet', 1.5)).toBeCloseTo(landPressure(C.grassland, 0, 1, 0, 'wet') * grazingSoilMult(1.5), 12)
    expect(grazingCoverMult(1.5)).toBeLessThan(1)
    // other covers are not grazed
    for (const i of cells(s, (j) => s.layers.cover[j] === C.forest).slice(0, 50)) expect(over.soilHealth[i]).toBe(calm.soilHealth[i])
  })
})
