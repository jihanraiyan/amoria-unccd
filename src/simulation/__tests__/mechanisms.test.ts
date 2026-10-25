// Focused tests of the mechanisms added in the calibration round: household self-supply,
// grazing and forest livelihoods, the business-as-usual twin and run-on erosion, per-map
// calibration, the reservoir trap curve, sealed built cells, timber prices, compaction of
// bare land and the understory under young plantings. They test general behaviour, not fixed
// outputs.
import { createInitialState, step, validateAction } from '../engine'
import { reservoirCapacityM3, simulateSeason } from '../engine/season'
import { runAgriculture, soilFactor } from '../models/agriculture'
import { cellHa } from '../models/cells'
import { compaction, curveNumberII, rootFactor, runHydrology } from '../models/hydrology'
import { baseTarget } from '../models/vegetation'
import { timberSale } from '../models/landUse'
import { coverFactor, reservoirTrapShare, runOnFactor, sealedShare } from '../models/soil'
import { AGRI, CALIBRATION, ECON, HYDRO, SOIL, VEG } from '../params'
import type { SimulationState, WeatherSeason, WorldLayers } from '../types'
import { generateProceduralWorld } from '../world/procedural'
import { cellsWhere, play, STRATEGIES } from './bots/strategies'
import { C, KAANI_WORLD, S, SEED, WORLD, cells, findWeather, initial, must, rich } from './helpers'

const hydro = (s: SimulationState, w: WeatherSeason, layers: WorldLayers = s.layers, ref: Float32Array | undefined = s.baseline.groundwaterRefMm) =>
  runHydrology({
    terrain: s.terrain,
    layers,
    weather: w,
    reservoirM3: s.reservoirM3,
    reservoirCapacityM3: reservoirCapacityM3(layers, s.reservoirSiltM3),
    townDemandM3: s.community.population * HYDRO.townUseM3PerPersonSeason.value,
    serviceLevel: 1,
    groundwaterRefMm: ref,
  })

const sumOver = (xs: number[], f: (i: number) => number) => xs.reduce((a, i) => a + f(i), 0)

describe('household self-supply: roof tanks and shallow wells', () => {
  const s = rich(initial())
  const droughtDry = findWeather(s, 'drought', 'dry')
  const noWorks = must(s, { type: 'demolish', cells: cells(s, (i) => s.layers.structure[i] === S.waterworks) })

  test('with no waterworks, household water is exactly roof tanks plus wells, and the ledger still closes', () => {
    for (const w of [droughtDry, findWeather(s, 'normal', 'wet'), findWeather(s, 'normal', 'dry')]) {
      const h = hydro(noWorks, w, noWorks.layers)
      expect(h.townSuppliedM3).toBe(0)
      expect(h.tankSuppliedM3).toBeGreaterThan(0)
      expect(h.wellSuppliedM3).toBeGreaterThan(0)
      expect(h.selfSuppliedM3).toBeCloseTo(h.tankSuppliedM3 + h.wellSuppliedM3, 6)
      expect(h.householdSuppliedM3).toBeCloseTo(h.tankSuppliedM3 + h.wellSuppliedM3, 6)
      expect(h.householdSuppliedM3).toBeLessThanOrEqual(h.townDemandM3 + 1e-6)
      expect(Math.abs(h.ledger.residualMm)).toBeLessThan(1e-3)
      expect(h.ledger.withdrawalsMm * s.terrain.width * s.terrain.height * 10).toBeCloseTo(h.householdSuppliedM3, 0)
    }
  })

  test('wells yield less as local groundwater falls below its normal level', () => {
    const ref = s.baseline.groundwaterRefMm
    const at = (frac: number) => ({ ...noWorks.layers, groundwaterMm: ref.map((v) => v * frac) })
    const yields = [1, 0.6, 0.3, 0.1].map((f) => hydro(noWorks, droughtDry, at(f), ref).wellSuppliedM3)
    for (let k = 1; k < yields.length; k++) expect(yields[k]).toBeLessThan(yields[k - 1])
    // same groundwater, a higher normal level to compare with: wells are judged less reliable
    const sameWater = at(0.6)
    const higherRef = ref.map((v) => v * 2)
    expect(hydro(noWorks, droughtDry, sameWater, higherRef).wellSuppliedM3).toBeLessThan(hydro(noWorks, droughtDry, sameWater, ref).wellSuppliedM3)
  })

  test('wells never cover more than their share of household need', () => {
    const h = hydro(noWorks, droughtDry, { ...noWorks.layers, groundwaterMm: noWorks.layers.groundwaterMm.map((v) => v * 10) })
    expect(h.wellSuppliedM3).toBeLessThanOrEqual(HYDRO.selfSupply.value.wellShareMax * h.townDemandM3 + 1e-6)
  })

  test('piped water comes first: with a working waterworks in a normal season, wells are not needed', () => {
    const h = hydro(s, findWeather(s, 'normal', 'wet'))
    expect(h.townSuppliedM3).toBeGreaterThan(0)
    expect(h.wellSuppliedM3).toBe(0)
    expect(h.householdSuppliedM3).toBeCloseTo(h.townDemandM3, 3)
  })
})

describe('grazing and forest livelihoods', () => {
  const s = rich(initial())
  const n = s.layers.cover.length
  const agri = (layers: WorldLayers) =>
    runAgriculture({ terrain: s.terrain, layers, season: 'wet', waterFactor: new Float32Array(n).fill(1), flooded: new Uint8Array(n), sedimentIn: new Float32Array(n), serviceLevel: 1 })
  const ha = cellHa(s.terrain)
  const gz = AGRI.grazing.value
  const grazingOf = (L: WorldLayers, i: number) => gz.valuePerHa * ha * Math.min(1, L.vegetation[i] / gz.fullVegetation) * soilFactor(L.soilHealth[i])

  test('grazing value rises with grass cover', () => {
    const grass = cells(s, (i) => s.layers.cover[i] === C.grassland && s.layers.structure[i] === S.none)
    const thin = { ...s.layers, vegetation: s.layers.vegetation.slice() }
    for (const i of grass) thin.vegetation[i] *= 0.5
    expect(agri(thin).grazingValue).toBeLessThan(agri(s.layers).grazingValue)
    expect(agri(s.layers).grazingValue).toBeCloseTo(sumOver(grass, (i) => grazingOf(s.layers, i)), 3)
  })

  test('converting pasture to cropland removes exactly that pasture value', () => {
    const candidates = cells(s, (i) => s.layers.cover[i] === C.grassland && s.layers.structure[i] === S.none && s.terrain.slope[i] < 0.1)
    const ok = validateAction(s, { type: 'cropland', cells: candidates, intensity: 'medium', irrigated: false }).cellOk
    const pasture = candidates.filter((_, k) => ok[k]).slice(0, 20)
    const t = must(s, { type: 'cropland', cells: pasture, intensity: 'medium', irrigated: false })
    const lost = agri(s.layers).grazingValue - agri(t.layers).grazingValue
    expect(lost).toBeGreaterThan(0)
    expect(lost).toBeCloseTo(sumOver(pasture, (i) => grazingOf(s.layers, i)), 3)
  })

  test('standing forest gives households a livelihood that stops when it is cleared', () => {
    const forest = cells(s, (i) => s.layers.cover[i] === C.forest && !s.terrain.protected[i]).slice(0, 25)
    const t = must(s, { type: 'clear', cells: forest })
    const fp = AGRI.forestProducts.value
    const lost = agri(s.layers).forestProductValue - agri(t.layers).forestProductValue
    expect(lost).toBeCloseTo(sumOver(forest, (i) => fp.valuePerHa * ha * Math.min(1, s.layers.vegetation[i] / fp.fullVegetation)), 3)
  })
})

describe('business-as-usual twin and run-on erosion', () => {
  test('the twin never reads player state: identical across different action logs', () => {
    const runs = ['idle', 'clearCut', 'balanced', 'sprawl'].map((name) => play(name, STRATEGIES[name], { years: 4 }).final)
    const [a, ...rest] = runs
    expect(a.decisions.length).toBe(0)
    for (const b of rest) {
      expect(b.decisions.length).toBeGreaterThan(0)
      expect(b.reference.layers).toEqual(a.reference.layers)
      expect(b.reference.last).toEqual(a.reference.last)
      expect(b.reference.erosion).toEqual(a.reference.erosion)
      const refFields = (s: SimulationState) => s.history.map((p) => [p.refTotalErosionT, p.refOutletSedimentT, p.refFloodedHousingCells, p.refSettlementFloodRatio, p.refMeanSoilHealth])
      expect(refFields(b)).toEqual(refFields(a))
    }
  }, 60_000)

  test('run-on factor is 1 with no upslope change, above 1 with extra water from upslope, and bounded', () => {
    expect(runOnFactor(12, 40, 40)).toBe(1)
    expect(runOnFactor(0, 0, 0)).toBe(1)
    expect(runOnFactor(12, 80, 40)).toBeGreaterThan(1)
    expect(runOnFactor(12, 20, 40)).toBeLessThan(1)
    const r = SOIL.runoffErosion.value
    expect(runOnFactor(0, 1e6, 0)).toBe(r.max)
    expect(runOnFactor(0, 0, 1e6)).toBe(r.min)
  })

  test('in the engine, an unchanged valley has run-on factor 1 everywhere; clearing upslope raises it downslope', () => {
    const s = rich(initial())
    const heavy = findWeather(s, 'heavy-rain', 'wet')
    const d = s.demography[0]
    const same = simulateSeason(s, heavy, d, false)
    for (let i = 0; i < s.layers.cover.length; i++) {
      expect(runOnFactor(same.refHydro.runoffMm[i], same.hydro.surfaceInMm[i], same.refHydro.surfaceInMm[i])).toBe(1)
    }
    expect(Array.from(same.soil.erosion)).toEqual(Array.from(same.reference.erosion))
    const upslope = cells(s, (i) => s.layers.cover[i] === C.forest && !s.terrain.protected[i] && Math.floor(i / s.terrain.width) < 28)
    const t = must(s, { type: 'clear', cells: upslope })
    const out = simulateSeason(t, heavy, d, false)
    const cleared = new Set(upslope)
    const downslope = cells(t, (i) => !cleared.has(i) && !t.terrain.channel[i] && t.layers.cover[i] !== C.water && runOnFactor(out.refHydro.runoffMm[i], out.hydro.surfaceInMm[i], out.refHydro.surfaceInMm[i]) > 1.01)
    expect(downslope.length).toBeGreaterThan(20)
    // the same land, the same weather: these cells erode more only because more water arrives from above
    let higher = 0
    for (const i of downslope) if (out.soil.erosion[i] > out.reference.erosion[i]) higher++
    expect(higher).toBe(downslope.filter((i) => out.reference.erosion[i] > 0).length)
    expect(higher).toBeGreaterThan(10)
  })
})

describe('per-map calibration', () => {
  const cb = CALIBRATION.value

  test('is deterministic and stays inside its bounds on several maps', () => {
    const a = createInitialState(WORLD, SEED)
    const b = createInitialState(WORLD, SEED)
    expect(b.calibration).toEqual(a.calibration)
    for (const world of [WORLD, generateProceduralWorld(2), generateProceduralWorld(3), KAANI_WORLD]) {
      const s = createInitialState(world, SEED)
      const c = s.calibration
      expect(c.householdScale).toBeGreaterThanOrEqual(1)
      expect(c.householdScale).toBeLessThanOrEqual(cb.maxHouseholdScale)
      expect(c.levy).toBeGreaterThanOrEqual(cb.levyRange[0] - 1e-12)
      expect(c.levy).toBeLessThanOrEqual(cb.levyRange[1] + 1e-12)
      expect(c.residentsPerHome).toEqual([0, 25, 55, 90].map((v) => Math.round(v * c.householdScale)))
      // food: homes are scaled so a normal year feeds foodBalance x the residents, unless the
      // worst two seasons of a long drought would then fall below droughtFoodBalance (rounding aside)
      const drought = c.droughtFoodBalance ?? 1
      if (c.householdScaleBy === 'normal-year') {
        expect(Math.abs(c.foodBalance - cb.foodBalance)).toBeLessThan(0.05)
        expect(drought).toBeGreaterThan(cb.droughtFoodBalance - 0.01)
      } else if (c.householdScaleBy === 'drought') {
        expect(Math.abs(drought - cb.droughtFoodBalance)).toBeLessThan(0.01)
        expect(c.foodBalance).toBeGreaterThan(cb.foodBalance - 0.05)
      } else if (c.householdScale === 1) expect(Math.min(c.foodBalance - cb.foodBalance, drought - cb.droughtFoodBalance)).toBeLessThanOrEqual(0.05)
      else expect(c.foodBalance).toBeGreaterThan(cb.foodBalance - 0.05)
      // budget: the levy is set so a normal year saves the target share of the starting fund
      const target = cb.surplusShareOfStartBudget * ECON.startBudget.value
      if (c.levy > cb.levyRange[0] && c.levy < cb.levyRange[1]) expect(c.normalYearSurplus).toBeCloseTo(target, 3)
      else if (c.levy === cb.levyRange[1]) expect(c.normalYearSurplus).toBeLessThanOrEqual(target + 1e-6)
      else expect(c.normalYearSurplus).toBeGreaterThanOrEqual(target - 1e-6)
    }
  }, 30_000)

  test('the starting population fills the calibrated homes', () => {
    const s = initial()
    expect(s.community.housingCapacity).toBe(s.baseline.housingCapacity)
    expect(s.community.population).toBe(s.baseline.population)
    expect(s.community.population).toBeLessThanOrEqual(s.community.housingCapacity)
  })
})

describe('reservoir sediment trap and sealed built cells', () => {
  test('trap share rises with the capacity-to-inflow ratio and never exceeds its maximum', () => {
    const t = SOIL.reservoirTrap.value
    const ratios = [0, 0.005, 0.02, 0.05, 0.2, 1, 5]
    const shares = ratios.map((r) => reservoirTrapShare({ capacityM3: r * 1e6, inflowM3: 1e6 }))
    expect(shares[0]).toBe(0)
    for (let k = 1; k < shares.length; k++) expect(shares[k]).toBeGreaterThan(shares[k - 1])
    for (const x of shares) expect(x).toBeLessThan(t.max)
    expect(reservoirTrapShare({ capacityM3: t.halfRatio * 1e6, inflowM3: 1e6 })).toBeCloseTo(t.max / 2, 9)
    // a reservoir with no inflow keeps whatever little arrives
    expect(reservoirTrapShare({ capacityM3: 1e5, inflowM3: 0 })).toBeGreaterThan(0.85)
  })

  test('a built cell erodes only on its open share', () => {
    for (const veg of [0.05, 0.3, 0.6]) {
      const open = coverFactor(C.grassland, S.none, 1, veg)
      for (const level of [1, 2, 3]) {
        const sealed = sealedShare(C.urban, S.housing, level)
        expect(sealed).toBeGreaterThan(0)
        expect(coverFactor(C.urban, S.housing, 1, veg, level)).toBeCloseTo((1 - sealed) * open, 12)
      }
      expect(coverFactor(C.urban, S.road, 1, veg)).toBeCloseTo((1 - SOIL.sealedShare.value.road) * open, 12)
      expect(coverFactor(C.urban, S.housing, 1, veg, 3)).toBeLessThan(coverFactor(C.urban, S.housing, 1, veg, 1))
    }
  })
})

describe('timber prices fall as more is sold in a season', () => {
  const s = rich(initial())
  const forest = cells(s, (i) => s.layers.cover[i] === C.forest && !s.terrain.protected[i]).slice(0, 40)
  const ha = cellHa(s.terrain)
  const full = (i: number) => ECON.timberPerCell.value.forest * s.layers.vegetation[i]

  test('each hectare fetches less than the one before', () => {
    const one = timberSale(1000, 0, 1)
    expect(timberSale(1000, 10, 1)).toBeLessThan(one)
    // the marginal price at halfPriceHa already sold is half the first-hectare price
    const tiny = 1e-6
    expect(timberSale(1000 * tiny, ECON.timberMarket.value.halfPriceHa, tiny) / tiny).toBeCloseTo(500, 3)
    expect(timberSale(1000, 0, 1) + timberSale(1000, 1, 1)).toBeCloseTo(timberSale(2000, 0, 2), 9)
    expect(timberSale(0, 0, 1)).toBe(0)
  })

  test('an action is priced against what was already sold this season, and the count resets next season', () => {
    const first = forest.slice(0, 20)
    const second = forest.slice(20, 40)
    const v1 = validateAction(s, { type: 'clear', cells: first })
    let sold = 0
    const expected1 = sumOver(first, (i) => {
      const r = timberSale(full(i), sold, ha)
      sold += ha
      return r
    })
    expect(v1.revenue).toBe(Math.round(expected1))
    expect(v1.timberHa).toBeCloseTo(20 * ha, 9)
    const t = must(s, { type: 'clear', cells: first })
    expect(t.economy.timberSoldHa).toBeCloseTo(20 * ha, 9)
    const sameSeason = validateAction(t, { type: 'clear', cells: second }).revenue!
    const freshSeason = validateAction({ ...step(t).state, layers: t.layers }, { type: 'clear', cells: second }).revenue!
    expect(step(t).state.economy.timberSoldHa ?? 0).toBe(0)
    expect(sameSeason).toBeLessThan(freshSeason)
    expect(freshSeason).toBeLessThan(sumOver(second, full))
  })
})

describe('compaction of bare land', () => {
  const s = rich(initial())
  const wet = findWeather(s, 'normal', 'wet')

  test('compaction is 1 on freshly cleared bare land, 0 once it regrows cover, and 0 on other covers', () => {
    const rv = HYDRO.compaction.value.recoveredVegetation
    expect(compaction(C.bare, S.none, 0)).toBe(1)
    expect(compaction(C.bare, S.none, rv / 2)).toBeCloseTo(0.5, 9)
    expect(compaction(C.bare, S.none, rv)).toBe(0)
    expect(compaction(C.grassland, S.none, 0)).toBe(0)
    expect(compaction(C.cropland, S.none, 0)).toBe(0)
    expect(curveNumberII(C.bare, S.none, 0, 0, 0, 0.6, 0.1)).toBeGreaterThan(curveNumberII(C.bare, S.none, 0, 0, rv, 0.6, 0.1))
  })

  test('compacted bare land sheds more storm runoff and recharges less groundwater than regrown bare land', () => {
    const plots = cells(s, (i) => s.layers.cover[i] === C.grassland && s.layers.structure[i] === S.none && !s.terrain.protected[i]).slice(0, 60)
    const asBare = (veg: number): WorldLayers => {
      const L = { ...s.layers, cover: s.layers.cover.slice(), vegetation: s.layers.vegetation.slice() }
      for (const i of plots) {
        L.cover[i] = C.bare
        L.vegetation[i] = veg
      }
      return L
    }
    const crusted = asBare(0)
    const regrown = asBare(HYDRO.compaction.value.recoveredVegetation)
    const a = hydro(s, wet, crusted)
    const b = hydro(s, wet, regrown)
    expect(sumOver(plots, (i) => a.runoffMm[i])).toBeGreaterThan(sumOver(plots, (i) => b.runoffMm[i]))
    expect(sumOver(plots, (i) => a.groundwaterMm[i] - crusted.groundwaterMm[i])).toBeLessThan(sumOver(plots, (i) => b.groundwaterMm[i] - regrown.groundwaterMm[i]))
    expect(Math.abs(a.ledger.residualMm)).toBeLessThan(1e-3)
  })
})

describe('young plantings keep the ground cover of the grass they are planted into', () => {
  test('restoring steep grassland does not raise erosion above leaving the grass by more than a small amount', () => {
    const s0 = rich(initial())
    const steepGrass = cellsWhere(s0, (i) => s0.layers.cover[i] === C.grassland && s0.layers.structure[i] === S.none && !s0.terrain.protected[i] && s0.terrain.slope[i] > 0.12).slice(0, 20)
    expect(steepGrass.length).toBe(20)
    // documented establishment allowance (MODEL_ASSUMPTIONS): planted forest never erodes more than
    // the grass it replaced; young agroforestry may erode up to a few percent more in its first dry
    // seasons, but every year as a whole erodes less
    const seasonAllowance = { reforest: 1, agroforestry: 1.08 }
    for (const type of ['reforest', 'agroforestry'] as const) {
      let grass = s0
      let planted = must(s0, { type, cells: steepGrass })
      let cumGrass = 0
      let cumPlanted = 0
      let yearGrass = 0
      let yearPlanted = 0
      for (let k = 0; k < 20; k++) {
        grass = step(grass).state
        planted = step(planted).state
        const eg = sumOver(steepGrass, (i) => grass.fields.erosion[i])
        const ep = sumOver(steepGrass, (i) => planted.fields.erosion[i])
        expect(ep, `${type} season ${k + 1}`).toBeLessThanOrEqual(seasonAllowance[type] * eg + 1e-6)
        yearGrass += eg
        yearPlanted += ep
        if (k % 2 === 1) {
          expect(yearPlanted, `${type} year ${(k + 1) / 2}`).toBeLessThan(yearGrass)
          yearGrass = 0
          yearPlanted = 0
        }
        cumGrass += eg
        cumPlanted += ep
        // ground cover is not stripped at planting
        expect(sumOver(steepGrass, (i) => planted.layers.vegetation[i])).toBeGreaterThan(0.9 * sumOver(steepGrass, (i) => grass.layers.vegetation[i]))
      }
      expect(cumPlanted).toBeLessThan(0.8 * cumGrass)
    }
  }, 60_000)

  test('a new planting starts with the understory target of grass and closes its canopy over the years', () => {
    for (const cover of [C.forest, C.agroforestry]) {
      for (const season of ['wet', 'dry'] as const) {
        const young = baseTarget(cover, S.none, 0, 0, 0, season)
        expect(young).toBeGreaterThanOrEqual(VEG.target.value.grassland[season] - 1e-9)
        let prev = young
        for (let age = 1; age <= 30; age++) {
          const t = baseTarget(cover, S.none, 0, 0, age, season)
          expect(t).toBeGreaterThanOrEqual(prev - 1e-12)
          prev = t
        }
        expect(baseTarget(cover, S.none, 0, 0, 1000, season)).toBeCloseTo(VEG.target.value[cover === C.forest ? 'forest' : 'agroforestry'][season], 9)
      }
    }
    // rooting deepens with maturity, from the grass value to the tree value
    expect(rootFactor(C.forest, 0)).toBe(HYDRO.rootDepthFactor.value.grassland)
    expect(rootFactor(C.forest, VEG.matureSeasons.value.forest)).toBe(HYDRO.rootDepthFactor.value.forest)
    expect(rootFactor(C.grassland, 0)).toBe(HYDRO.rootDepthFactor.value.grassland)
  })
})
