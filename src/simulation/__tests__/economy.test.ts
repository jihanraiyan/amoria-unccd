import { applyAction, step, validateAction } from '../engine'
import { runCommunity } from '../models/community'
import { applyFinance, arrivalRateFactor, levyRateOf, runEconomy, taxPerResidentAt } from '../models/economy'
import { AGRI, COMMUNITY, ECON, OBJECTIVES, WELLBEING_WEIGHTS } from '../params'
import { cells, initial, must, rich, S } from './helpers'
import type { SimulationState } from '../types'

describe('economy', () => {
  test('obligations beyond the budget become a recorded shortage, never a negative budget', () => {
    const s = initial()
    const broke = { ...s, economy: { ...s.economy, budget: 0, debt: 390_000 } }
    const r = step(broke).state
    expect(r.economy.budget).toBeGreaterThanOrEqual(0)
    const exp = Object.values(r.economy.expenses).reduce((a, b) => a + b, 0)
    const inc = Object.values(r.economy.income).reduce((a, b) => a + b, 0)
    if (exp > inc) {
      expect(r.economy.serviceLevel).toBeLessThan(1)
      expect(r.economy.unpaid).toBeCloseTo(exp - inc, 1)
      // nothing is forgiven: every unpaid bill is carried as arrears on the debt
      expect(r.economy.debt).toBeCloseTo(390_000 + r.economy.unpaid, 1)
    }
  })

  test('a shortfall is still owed afterwards: arrears join the debt and accrue interest', () => {
    const s = initial()
    const base = {
      terrain: s.terrain,
      layers: s.layers,
      population: s.community.population,
      cropValue: 0,
      treeProductValue: 0,
      inputCost: 50_000,
      marketCount: 0,
      townSuppliedM3: 0,
      irrigationSuppliedM3: 0,
      intakeTurbidity: 1,
      flooded: new Uint8Array(s.layers.cover.length),
    }
    const short = runEconomy({ ...base, economy: { ...s.economy, budget: 1_000, debt: 0 } })
    const owed = short.totalExpenses - (1_000 + short.totalIncome)
    expect(owed).toBeGreaterThan(40_000)
    expect(short.economy.budget).toBe(0)
    expect(short.economy.unpaid).toBeCloseTo(owed, 6)
    expect(short.economy.debt).toBeCloseTo(owed, 6)
    // a later season with plenty of money still owes the arrears and pays interest on them
    const later = runEconomy({ ...base, inputCost: 0, economy: { ...short.economy, budget: 500_000 } })
    expect(later.economy.serviceLevel).toBe(1)
    expect(later.economy.debt).toBeCloseTo(owed, 6)
    expect(later.economy.expenses.interest).toBeCloseTo(owed * ECON.interestPerSeason.value, 1)
    // only an explicit repayment clears them
    const repaid = applyFinance(later.economy, 'repay', owed)
    expect(repaid.debt).toBeCloseTo(0, 6)
  })

  test('shortages cut the next season of services: waterworks capacity and farm programs', () => {
    const s = initial()
    const short = { ...s, economy: { ...s.economy, serviceLevel: 0.3 } }
    const a = step(s).state
    const b = step(short).state
    expect(b.diagnostics.meanManagementFactor).toBeLessThan(a.diagnostics.meanManagementFactor)
  })

  test('loans carry interest every season', () => {
    const s = must(initial(), { type: 'loan', amount: 200_000 })
    const r = step(s).state
    expect(r.economy.expenses.interest).toBeCloseTo(200_000 * 0.015, 2)
  })

  test('there is no free money: income comes only from modelled activity', () => {
    const s = initial()
    const r = step(s).state
    const keys = Object.keys(r.economy.income).sort()
    expect(keys).toEqual(['farmLevy', 'localTax', 'markets', 'treeProducts', 'waterTariff'])
    expect(r.economy.income.markets).toBe(0) // no market built yet
  })

  test('structures cost maintenance every season', () => {
    let s = rich(initial())
    const before = step(s).state.economy.expenses
    const site = cells(s, (i) => s.terrain.channel[i] === 1 && s.terrain.flowAccumulation[i] > 400)[3]
    s = must(s, { type: 'reservoir', cells: [site] })
    const after = step(s).state.economy.expenses
    expect(after.reservoirs).toBeGreaterThan(before.reservoirs)
    void S
  })
})

describe('community', () => {
  const s = initial()

  test('wellbeing is exactly the documented weighted sum of its parts', () => {
    const r = step(s).state
    const p = r.community.wellbeingParts
    const W = WELLBEING_WEIGHTS.value
    expect(W.housing + W.food + W.water + W.livelihood + W.safety).toBeCloseTo(1, 9)
    expect(r.community.wellbeing).toBeCloseTo(W.housing * p.housing + W.food * p.food + W.water * p.water + W.livelihood * p.livelihood + W.safety * p.safety, 9)
    expect(p.housing).toBe(r.community.housingAdequacy)
    expect(p.food).toBe(r.community.foodSecurity)
    expect(p.water).toBe(r.community.waterSecurity)
    expect(p.safety).toBeCloseTo(1 - r.community.hazardExposure, 9)
  })

  test('population cannot outgrow housing; unmet demand shows up as low housing adequacy', () => {
    let t = s
    for (let k = 0; k < 24; k++) t = step(t).state
    expect(t.community.population).toBeLessThanOrEqual(t.community.housingCapacity * 1.05 + 1e-6)
    expect(t.community.housingDemand).toBeGreaterThan(t.community.population)
    expect(t.community.housingAdequacy).toBeLessThan(1)
  }, 30_000)

  test('food security follows local production over a two-season window plus limited imports', () => {
    const base = { prev: s.community, layers: s.layers, demography: { naturalGrowthRate: 0, migrationPressure: 0 }, townDemandM3: 1, townSuppliedM3: 1, farmHouseholdIncome: 0, floodedHousingShare: 0, floodedCropShare: 0, droughtStress: 0, sedimentHazard: 0, irrigationSupplyRatio: 1, downstream: { waterAccess: 1, hazard: 0, income: 1 }, foodPerPersonT: 0.19 }
    const need = 2 * s.community.population * 0.19
    const plenty = runCommunity({ ...base, foodNowT: need, foodPrevT: 0 })
    const none = runCommunity({ ...base, foodNowT: 0, foodPrevT: 0 })
    expect(plenty.community.foodSecurity).toBe(1)
    expect(none.community.foodSecurity).toBeLessThan(0.5)
    expect(none.foodImportedT).toBeGreaterThan(0)
  })

  test('bought food is a real cost: households pay for it out of income, so livelihood falls', () => {
    const base = { prev: s.community, layers: s.layers, demography: { naturalGrowthRate: 0, migrationPressure: 0 }, townDemandM3: 1, townSuppliedM3: 1, farmHouseholdIncome: 100 * s.community.population, floodedHousingShare: 0, floodedCropShare: 0, droughtStress: 0, sedimentHazard: 0, irrigationSupplyRatio: 1, downstream: { waterAccess: 1, hazard: 0, income: 1 }, foodPerPersonT: 0.19 }
    const need = 2 * s.community.population * 0.19
    const grown = runCommunity({ ...base, foodNowT: need, foodPrevT: 0 }).community
    const short = runCommunity({ ...base, foodNowT: 0.75 * need, foodPrevT: 0 })
    expect(grown.foodImportCost).toBe(0)
    expect(grown.foodSelfSufficiency).toBeCloseTo(1, 9)
    expect(short.community.foodSelfSufficiency).toBeCloseTo(0.75, 9)
    // imports are capped at maxShare x livelihood of need, and cost half the window's purchase per season
    expect(short.foodImportedT).toBeCloseTo(Math.min(0.25 * need, AGRI.imports.value.maxShare * s.community.livelihood * need), 6)
    expect(short.community.foodImportCost).toBeCloseTo(0.5 * short.foodImportedT * AGRI.imports.value.pricePerT, 6)
    expect(short.community.livelihood).toBeLessThan(grown.livelihood)
  })

  test('doubling the town with no new farms drops normal-season food below the goals', () => {
    // a normal season with the starting farms feeding twice the people
    const doubled: SimulationState = { ...s, community: { ...s.community, population: 2 * s.community.population } }
    expect(s.weather[0].kind).toBe('normal')
    const r = step(doubled).state
    expect(r.community.foodSelfSufficiency!).toBeLessThan(OBJECTIVES.value.foodSelfSufficiency)
    // bought food covers part of the gap, at a price, but not all of it
    expect(r.community.foodSecurity).toBeLessThan(1)
    expect(r.community.foodSecurity).toBeGreaterThan(r.community.foodSelfSufficiency!)
    expect(r.community.foodImportCost!).toBeGreaterThan(0)
    // the same season with the starting town is fully fed from its own farms
    const r0 = step(s).state
    expect(r0.community.foodSelfSufficiency!).toBeGreaterThanOrEqual(OBJECTIVES.value.foodSelfSufficiency)
    expect(r0.community.foodSecurity).toBe(1)
  })

  test('a flood keeps weighing on safety while homes are repaired, fading by COMMUNITY.floodRecovery each season', () => {
    const base = { prev: s.community, layers: s.layers, demography: { naturalGrowthRate: 0, migrationPressure: 0 }, townDemandM3: 1, townSuppliedM3: 1, farmHouseholdIncome: 0, floodedHousingShare: 0, floodedCropShare: 0, droughtStress: 0, sedimentHazard: 0, irrigationSupplyRatio: 1, downstream: { waterAccess: 1, hazard: 0, income: 1 }, foodPerPersonT: 0.19, foodNowT: 1000, foodPrevT: 1000 }
    const calm = runCommunity(base).community
    const flooded = runCommunity({ ...base, floodedHousingShare: 0.4 }).community
    expect(flooded.floodRecovery).toBeCloseTo(0.4, 9)
    const after1 = runCommunity({ ...base, prev: flooded }).community
    const after2 = runCommunity({ ...base, prev: after1 }).community
    const k = COMMUNITY.floodRecovery.value
    expect(after1.floodRecovery).toBeCloseTo(0.4 * k, 9)
    expect(after2.floodRecovery).toBeCloseTo(0.4 * k * k, 9)
    const hw = COMMUNITY.hazardWeights.value.floodHousing
    expect(after1.hazardExposure - calm.hazardExposure).toBeCloseTo(hw * 0.4 * k, 9)
    expect(calm.wellbeing).toBeGreaterThan(after2.wellbeing)
    expect(after2.wellbeing).toBeGreaterThan(after1.wellbeing)
    expect(after1.wellbeing).toBeGreaterThan(flooded.wellbeing)
    // a new, smaller flood does not erase the memory of a bigger one
    expect(runCommunity({ ...base, prev: flooded, floodedHousingShare: 0.1 }).community.floodRecovery).toBeCloseTo(0.4 * k, 9)
  })

  test('people leave when wellbeing is low', () => {
    const sad = { ...s, community: { ...s.community, wellbeing: 0.2 } }
    const r = step(sad).state
    expect(r.community.departures).toBeGreaterThan(0)
  })

  test('stakeholders see different sides of the same valley', () => {
    let t = s
    for (let k = 0; k < 6; k++) t = step(t).state
    const st = t.community.stakeholders
    for (const v of Object.values(st)) {
      expect(v.note.length).toBeGreaterThan(10)
      expect(Number.isFinite(v.income) && Number.isFinite(v.waterAccess) && Number.isFinite(v.hazardExposure)).toBe(true)
    }
    expect(st.downstream.note).toContain('Downstream')
  })

  describe('the levy lever (set-levy)', () => {
    test('the rate must be a number inside the allowed range; changing it costs nothing', () => {
      const s = initial()
      const rp = ECON.ratePolicy.value
      for (const rate of [rp.min - 0.01, rp.max + 0.01, Number.NaN, Number.POSITIVE_INFINITY]) expect(validateAction(s, { type: 'set-levy', rate }).ok).toBe(false)
      const v = validateAction(s, { type: 'set-levy', rate: rp.max })
      expect(v.ok).toBe(true)
      expect(v.cost).toBe(0)
      const r = applyAction(s, { type: 'set-levy', rate: rp.max }).state
      expect(r.economy.budget).toBe(s.economy.budget)
      expect(levyRateOf(r.economy, r.calibration.levy)).toBe(rp.max)
      expect(r.decisions.at(-1)!.action).toEqual({ type: 'set-levy', rate: rp.max })
      // the starting rate is the map's calibrated levy
      expect(levyRateOf(s.economy, s.calibration.levy)).toBe(s.calibration.levy)
    })

    test('the local tax and the newcomer factor follow the rate, and are neutral at the starting rate', () => {
      const cal = 0.1
      expect(taxPerResidentAt(cal, cal)).toBeCloseTo(ECON.housingTaxPerResident.value, 12)
      expect(taxPerResidentAt(2 * cal, cal)).toBeCloseTo(2 * ECON.housingTaxPerResident.value, 12)
      expect(arrivalRateFactor(cal, cal)).toBe(1)
      expect(arrivalRateFactor(2 * cal, cal)).toBeLessThan(1)
      expect(arrivalRateFactor(0.5 * cal, cal)).toBeGreaterThan(1)
      expect(arrivalRateFactor(100 * cal, cal)).toBe(ECON.ratePolicy.value.arrivalFactorMin)
    })

    test('a higher levy fills the fund but costs households: lower livelihood and fewer arrivals', () => {
      const s = rich(initial())
      const high = Math.min(ECON.ratePolicy.value.max, 2.5 * s.calibration.levy)
      let a = s
      let b = applyAction(s, { type: 'set-levy', rate: high }).state
      for (let k = 0; k < 4; k++) {
        a = step(a).state
        b = step(b).state
      }
      const income = (x: SimulationState) => x.history.slice(1).reduce((t, p) => t + p.income, 0)
      expect(income(b)).toBeGreaterThan(income(a) * 1.2)
      // the local tax is billed on the residents at the start of the season
      expect(step(b).state.economy.income.localTax).toBeCloseTo(b.community.population * taxPerResidentAt(high, s.calibration.levy), 1)
      expect(b.community.livelihood).toBeLessThan(a.community.livelihood)
      const arrivals = (x: SimulationState) => x.history.slice(1).reduce((t, p) => t + p.arrivals, 0)
      expect(arrivals(b)).toBeLessThan(arrivals(a))
      // the rate stays in force across steps
      expect(b.economy.levyRate).toBe(high)
    })
  })
})

