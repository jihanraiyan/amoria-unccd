import { step } from '../engine'
import { eventFactor, managementFactor, runAgriculture, soilFactor, treeProductRamp, waterYieldFactor } from '../models/agriculture'
import { cropActive } from '../models/hydrology'
import { maturity } from '../models/vegetation'
import { AGRI } from '../params'
import type { SimulationState } from '../types'
import { C, cells, initial, must, rich, withWeather } from './helpers'

describe('agriculture production function', () => {
  const s = initial()

  test('every cropped cell yields area x potential x soil x water x management x event', () => {
    let t = s
    for (let k = 0; k < 3; k++) t = step(t).state // last simulated season is a wet one
    const season = t.history.at(-1)!.season
    let checked = 0
    for (let i = 0; i < t.layers.cover.length; i++) {
      if (t.layers.cover[i] !== C.cropland || !cropActive(C.cropland, t.layers.irrigated[i], season)) continue
      const expected =
        AGRI.potentialT.value[season] *
        soilFactor(t.layers.soilHealth[i]) *
        waterYieldFactor(t.fields.waterFactor[i], AGRI.ky.value) *
        managementFactor(t.layers.intensity[i], t.layers.conservation[i], t.history.at(-2)!.serviceLevel) *
        eventFactor(t.fields.flooded[i], t.fields.sedimentIn[i])
      expect(t.fields.yieldT[i]).toBeCloseTo(expected, 4)
      checked++
    }
    expect(checked).toBeGreaterThan(100)
  })

  test('farm inputs are billed in proportion to the share delivered (service level)', () => {
    const crop = cells(s, (i) => s.layers.cover[i] === C.cropland)
    const intensity = new Uint8Array(s.layers.intensity)
    for (const i of crop) intensity[i] = 2 // high
    const layers = { ...s.layers, intensity }
    const base = { terrain: s.terrain, layers, season: 'wet' as const, flooded: new Uint8Array(4096), sedimentIn: new Float32Array(4096), waterFactor: new Float32Array(4096).fill(0.9) }
    const full = runAgriculture({ ...base, serviceLevel: 1 })
    const half = runAgriculture({ ...base, serviceLevel: 0.5 })
    expect(full.inputCost).toBeGreaterThan(0)
    expect(half.inputCost).toBeCloseTo(0.5 * full.inputCost, 6)
    const m = AGRI.management.value
    expect(managementFactor(2, 0, 0.5)).toBeCloseTo((m.low + managementFactor(2, 0, 1)) / 2, 9)
    expect(runAgriculture({ ...base, serviceLevel: 0 }).inputCost).toBe(0)
  })

  test('yield responds to water exactly through the FAO-33 water factor', () => {
    const base = { terrain: s.terrain, layers: s.layers, season: 'wet' as const, flooded: new Uint8Array(4096), sedimentIn: new Float32Array(4096), serviceLevel: 1 }
    const wet = runAgriculture({ ...base, waterFactor: new Float32Array(4096).fill(0.95) })
    const dry = runAgriculture({ ...base, waterFactor: new Float32Array(4096).fill(0.5) })
    const crop = cells(s, (i) => s.layers.cover[i] === C.cropland)
    for (const i of crop.slice(0, 50)) {
      expect(dry.yieldT[i] / wet.yieldT[i]).toBeCloseTo(waterYieldFactor(0.5, AGRI.ky.value) / waterYieldFactor(0.95, AGRI.ky.value), 5)
    }
    expect(dry.foodT).toBeLessThan(wet.foodT)
  })

  test('drought lowers harvest through environmental conditions, the same way for every land state', () => {
    const drought = s.weather.find((w) => w.kind === 'drought' && w.season === 'wet')!
    const normal = s.weather.find((w) => w.kind === 'normal' && w.season === 'wet')!
    // two different land states face the identical drought
    const cleared = must(rich(s), { type: 'cropland', cells: cells(s, (i) => s.layers.cover[i] === C.forest && s.terrain.slope[i] < 0.2 && !s.terrain.protected[i]).slice(0, 60), intensity: 'medium', irrigated: false })
    for (const st of [s, cleared]) {
      const d = step(withWeather(st, drought)).state
      const n = step(withWeather(st, normal)).state
      expect(d.history.at(-1)!.rainfallMm).toBe(drought.rainfallMm)
      expect(d.totals.foodProducedT).toBeLessThan(0.7 * n.totals.foodProducedT)
      // the loss is carried by the water factor, not by an extra drought penalty
      expect(d.diagnostics.meanWaterFactor).toBeLessThan(n.diagnostics.meanWaterFactor)
      expect(d.diagnostics.meanEventFactor).toBeCloseTo(1, 1)
      expect(d.diagnostics.meanManagementFactor).toBeCloseTo(n.diagnostics.meanManagementFactor, 6)
    }
  })

  test('more irrigation water raises yields of irrigated dry-season fields', () => {
    const dryStep = (st: SimulationState) => step(step(st).state).state // wet then dry
    let t = rich(s)
    const site = cells(t, (i) => t.terrain.channel[i] === 1 && t.terrain.flowAccumulation[i] > 400)[3]
    const withRes = must(t, { type: 'reservoir', cells: [site] })
    const a = dryStep(t)
    const b = dryStep({ ...withRes, reservoirM3: 120_000 })
    expect(b.totals.irrigationSuppliedM3).toBeGreaterThan(a.totals.irrigationSuppliedM3)
    expect(b.totals.foodProducedT).toBeGreaterThan(a.totals.foodProducedT)
    t = a
  })

  test('intensification and expansion are different strategies', () => {
    const base = rich(s)
    const crop = cells(base, (i) => base.layers.cover[i] === C.cropland && !base.layers.irrigated[i]).slice(0, 60)
    const grass = cells(base, (i) => base.layers.cover[i] === C.grassland && base.terrain.slope[i] < 0.08 && !base.terrain.protected[i]).slice(0, 60)
    const intensify = must(base, { type: 'set-intensity', cells: crop, intensity: 'high' })
    const expand = must(base, { type: 'cropland', cells: grass, intensity: 'medium', irrigated: false })
    let ref = base
    let i1 = intensify
    let e1 = expand
    for (let k = 0; k < 13; k++) {
      ref = step(ref).state
      i1 = step(i1).state
      e1 = step(e1).state
    }
    const sumFood = (st: SimulationState) => st.history.slice(1).reduce((x, p) => x + p.foodProducedT, 0)
    // both raise food, by different means
    expect(sumFood(i1)).toBeGreaterThan(sumFood(ref))
    expect(sumFood(e1)).toBeGreaterThan(sumFood(ref))
    expect(e1.totals.cropAreaHa).toBeGreaterThan(i1.totals.cropAreaHa)
    expect(i1.totals.cropAreaHa).toBe(ref.totals.cropAreaHa)
    // intensification: more input cost per season and faster soil decline on the same fields
    expect(i1.economy.expenses.farmInputs).toBeGreaterThan(ref.economy.expenses.farmInputs)
    const meanSoil = (st: SimulationState) => crop.reduce((x, c) => x + st.layers.soilHealth[c], 0) / crop.length
    expect(meanSoil(i1)).toBeLessThan(meanSoil(ref) - 0.01)
    // expansion: more land under the plough, less grassland
    expect(e1.totals.forestCoverFrac).toBeCloseTo(ref.totals.forestCoverFrac, 6)
  }, 30_000)

  test('high intensity uses more water than medium on the same field', () => {
    const t = rich(s)
    const crop = cells(t, (i) => t.layers.cover[i] === C.cropland && t.layers.irrigated[i] === 1)
    const hi = must(t, { type: 'set-intensity', cells: crop, intensity: 'high' })
    const dry = s.weather.find((w) => w.season === 'dry' && w.kind === 'normal')!
    const a = step(withWeather(step(t).state, dry)).state
    const b = step(withWeather(step(hi).state, dry)).state
    expect(b.totals.irrigationDemandM3).toBeGreaterThan(a.totals.irrigationDemandM3)
  })

  test('agroforestry trades staple yield for tree products after maturity', () => {
    const t = rich(s)
    const crop = cells(t, (i) => t.layers.cover[i] === C.cropland && !t.layers.irrigated[i]).slice(0, 40)
    let agro = must(t, { type: 'agroforestry', cells: crop })
    let ref = t
    const treeValue: number[] = []
    for (let k = 0; k < 20; k++) {
      agro = step(agro).state
      ref = step(ref).state
      treeValue.push(agro.diagnostics.treeProductValue)
    }
    expect(treeValue[0]).toBe(0)
    expect(treeValue.at(-1)!).toBeGreaterThan(0)
    expect(treeProductRamp(4)).toBe(0)
    expect(treeProductRamp(20)).toBe(1)
    const wetPoints = (st: SimulationState) => st.history.filter((p) => p.season === 'wet' && p.step > 0)
    const agroFood = wetPoints(agro).reduce((x, p) => x + p.foodProducedT, 0)
    const refFood = wetPoints(ref).reduce((x, p) => x + p.foodProducedT, 0)
    expect(agroFood).toBeLessThan(refFood)
    const meanSoil = (st: SimulationState) => crop.reduce((x, c) => x + st.layers.soilHealth[c], 0) / crop.length
    expect(meanSoil(agro)).toBeGreaterThan(meanSoil(ref))
  }, 30_000)
})

describe('vegetation and restoration', () => {
  const s = rich(initial())

  test('restoration takes years: planted forest is not instant forest', () => {
    const grass = cells(s, (i) => s.layers.cover[i] === C.grassland && !s.terrain.protected[i] && s.terrain.slope[i] < 0.15).slice(0, 30)
    let t = must(s, { type: 'reforest', cells: grass })
    const mean = (st: SimulationState) => grass.reduce((x, i) => x + st.layers.vegetation[i], 0) / grass.length
    const series: number[] = []
    for (let k = 0; k < 24; k++) {
      t = step(t).state
      series.push(mean(t))
    }
    expect(series[1]).toBeLessThan(0.6)
    expect(series[23]).toBeGreaterThan(series[3])
    expect(maturity(C.forest, 4)).toBeLessThan(0.5)
    expect(maturity(C.forest, 20)).toBe(1)
    expect(maturity(C.agroforestry, 6)).toBeLessThan(1)
  }, 30_000)

  test('drought causes dieback, more for crops and grass than for mature trees', () => {
    const drought = s.weather.find((w) => w.kind === 'drought' && w.season === 'wet')!
    const normal = s.weather.find((w) => w.kind === 'normal' && w.season === 'wet')!
    const d = step(withWeather(s, drought)).state
    const n = step(withWeather(s, normal)).state
    const loss = (cover: number) => {
      const cs = cells(s, (i) => s.layers.cover[i] === cover)
      return cs.reduce((x, i) => x + (n.layers.vegetation[i] - d.layers.vegetation[i]), 0) / cs.length
    }
    expect(loss(C.grassland)).toBeGreaterThan(0)
    expect(loss(C.grassland)).toBeGreaterThan(loss(C.forest))
  })
})
