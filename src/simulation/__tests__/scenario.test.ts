import { step } from '../engine'
import { droughtEpisodes, endReport, evaluateObjectives, goalWindow, landGain, resilienceMeasures } from '../scenarios/guided'
import { OBJECTIVES, listParameters } from '../params'
import { initial } from './helpers'
import { play, STRATEGIES } from './bots/strategies'

/** Multi-season tests play many seasons; give them room under parallel load (vitest default is 5 s). */
const LONG = 60_000

describe('guided scenario objectives and report', () => {
  test('objectives are computed from state, with targets, direction and progress', () => {
    const o = evaluateObjectives(initial())
    expect(o.map((x) => x.id)).toEqual(['housing', 'growth', 'food', 'water', 'land', 'cover', 'solvency', 'wellbeing', 'drought', 'floods', 'erosion'])
    for (const x of o) {
      expect(Number.isFinite(x.value)).toBe(true)
      expect(x.progress).toBeGreaterThanOrEqual(0)
      expect(x.progress).toBeLessThanOrEqual(1)
      const onTarget = x.direction === 'atLeast' ? x.value >= x.target - 1e-9 : x.value <= x.target + 1e-9
      // wellbeing also needs its weakest part above OBJECTIVES.wellbeingWeakestPart
      if (x.id === 'wellbeing') expect(x.met).toBe(onTarget && Math.min(...Object.values(initial().community.wellbeingParts)) >= OBJECTIVES.value.wellbeingWeakestPart - 1e-9)
      else expect(x.met).toBe(onTarget)
      expect(x.description).not.toMatch(/\u2014/)
    }
    expect(o.find((x) => x.id === 'growth')!.met).toBe(false) // nobody has grown yet
    // before any season is played the whole-game goals have nothing to judge yet
    const r0 = resilienceMeasures(initial())
    expect(r0.droughtSeasons).toBe(0)
    expect(r0.worstDroughtSecurity).toBe(1)
    expect(r0.droughtSecurity).toBe(1)
    expect(r0.floodedHomesRatio).toBe(0) // no home has flooded yet
    expect(r0.erosionRatio).toBe(1)
  }, LONG)

  test('the resilience goals report exactly their history-derived definitions', () => {
    const o0 = OBJECTIVES.value
    for (const name of ['idle', 'clearAndFarm', 'balanced'] as const) {
      const s = play(name, STRATEGIES[name]).final
      const o = Object.fromEntries(evaluateObjectives(s).map((x) => [x.id, x]))
      const r = resilienceMeasures(s)
      const played = s.history.filter((p) => p.step > 0)
      const drought = played.filter((p) => p.weather === 'drought')
      const sec = (p: (typeof played)[number]) => Math.min(p.foodSecurity, p.waterSecurity)
      // drought: the worst of food and household water security over the seasons of the most
      // recent drought episode (a run of consecutive drought seasons)
      expect(drought.length).toBeGreaterThanOrEqual(3)
      expect(r.droughtSeasons).toBe(drought.length)
      const episodes = droughtEpisodes(played)
      expect(episodes.flat().length).toBe(drought.length)
      for (const e of episodes) for (let j = 1; j < e.length; j++) expect(e[j].step).toBe(e[j - 1].step + 1)
      const last = episodes[episodes.length - 1]
      expect(r.lastEpisodeSeasons).toBe(last.length)
      expect(r.droughtSecurity).toBeCloseTo(Math.min(...last.map(sec)), 12)
      expect(r.worstDroughtSecurity).toBeCloseTo(Math.min(...drought.map(sec)), 12)
      expect(r.droughtSecurity).toBeGreaterThanOrEqual(r.worstDroughtSecurity)
      expect(o.drought.value).toBe(r.droughtSecurity)
      expect(o.drought.met).toBe(r.droughtSecurity >= o0.droughtSecurity - 1e-9)
      // floods: the whole game against the twin; erosion: the last resilienceWindowSeasons seasons
      const recent = played.slice(-o0.resilienceWindowSeasons)
      const sum = (f: (p: (typeof played)[number]) => number) => recent.reduce((a, p) => a + f(p), 0)
      expect(r.windowSeasons).toBe(o0.resilienceWindowSeasons)
      const whole = (f: (p: (typeof played)[number]) => number) => played.reduce((a, p) => a + f(p), 0)
      expect(r.floodedHomeSeasons).toBe(whole((p) => p.floodedHousingCells))
      expect(r.refFloodedHomeSeasons).toBe(whole((p) => p.refFloodedHousingCells))
      expect(o.floods.value).toBeCloseTo(r.floodedHomeSeasons === 0 ? 0 : (r.floodedHomeSeasons + 1) / (r.refFloodedHomeSeasons + 1), 12)
      expect(o.floods.direction).toBe('atMost')
      expect(o.floods.met).toBe(o.floods.value <= o0.floodedHomesVsReference + 1e-9)
      expect(o.erosion.value).toBeCloseTo(sum((p) => p.totalErosionT) / sum((p) => p.refTotalErosionT), 9)
      expect(o.erosion.met).toBe(o.erosion.value <= o0.erosionVsReference + 1e-9)
      // the averaged goals use the non-drought seasons of the last windowSeasons seasons
      const win = goalWindow(s)
      expect(win.length).toBeGreaterThan(0)
      expect(win.every((p) => p.weather !== 'drought')).toBe(true)
      expect(win.every((p) => p.step > s.step - o0.windowSeasons)).toBe(true)
      const mean = (f: (p: (typeof played)[number]) => number) => win.reduce((a, p) => a + f(p), 0) / win.length
      expect(o.water.value).toBeCloseTo(mean((p) => p.waterSecurity), 12)
      expect(o.wellbeing.value).toBeCloseTo(mean((p) => p.wellbeing), 12)
      // land: soil against the twin on the land that was changed plus the hillside farms
      expect(o.land.value).toBe(landGain(s).gain)
    }
    // the do-nothing valley is its own twin: both ratios are exactly 1 and the land gain is 0
    const idle = play('idle', STRATEGIES.idle).final
    const ri = resilienceMeasures(idle)
    expect(ri.floodedHomeSeasons).toBe(ri.refFloodedHomeSeasons)
    expect(ri.erosionRatio).toBeCloseTo(1, 4)
    expect(Math.abs(landGain(idle).gain)).toBeLessThan(1e-9)
  }, 60_000)

  test('a drought shortfall does not cost the averaged goals or solvency, and a later drought can redeem an early one', () => {
    const s = play('idle', STRATEGIES.idle).final
    // make the last two seasons a drought with an unpaid bill: the windowed goals ignore them
    const h = s.history.slice()
    const n = h.length
    const before = Object.fromEntries(evaluateObjectives(s).map((x) => [x.id, x]))
    h[n - 1] = { ...h[n - 1], weather: 'drought', serviceLevel: 0.5, waterSecurity: 0, wellbeing: 0 }
    const t = { ...s, history: h }
    const after = Object.fromEntries(evaluateObjectives(t).map((x) => [x.id, x]))
    // the drought season (and its zero water and wellbeing) is simply not in the window
    const calm = s.history.filter((p) => p.step > 0).slice(-OBJECTIVES.value.windowSeasons).filter((p) => p.weather !== 'drought' && p.step !== h[n - 1].step)
    const avg = (f: (p: (typeof calm)[number]) => number) => calm.reduce((a, p) => a + f(p), 0) / calm.length
    expect(goalWindow(t).map((p) => p.step)).toEqual(calm.map((p) => p.step))
    expect(after.water.value).toBeCloseTo(avg((p) => p.waterSecurity), 12)
    expect(after.wellbeing.value).toBeCloseTo(avg((p) => p.wellbeing), 12)
    // the unpaid drought-season bill does not fail solvency (it also reads the current debt, unchanged)
    expect(after.solvency.met).toBe(before.solvency.met)
    // a bad first drought followed by a good last one: the goal judges the last one
    const d = droughtEpisodes(s.history.filter((p) => p.step > 0))
    expect(d.length).toBeGreaterThanOrEqual(2)
    const firstSteps = new Set(d[0].map((p) => p.step))
    const lastSteps = new Set(d[d.length - 1].map((p) => p.step))
    const u = { ...s, history: s.history.map((p) => (firstSteps.has(p.step) ? { ...p, foodSecurity: 0.1 } : lastSteps.has(p.step) ? { ...p, foodSecurity: 1, waterSecurity: 1 } : p)) }
    const du = evaluateObjectives(u).find((x) => x.id === 'drought')!
    expect(du.value).toBe(1)
    expect(du.met).toBe(true)
    expect(resilienceMeasures(u).worstDroughtSecurity).toBeCloseTo(0.1, 12)
  }, 60_000)

  test('the end report summarises a full playthrough', () => {
    const s = play('idle', STRATEGIES.idle).final
    const r = endReport(s)
    expect(r.complete).toBe(true)
    expect(r.yearsPlayed).toBe(20)
    expect(r.weather.drought).toBeGreaterThanOrEqual(2)
    expect(r.weather['heavy-rain']).toBeGreaterThanOrEqual(1)
    expect(r.weather.longestDrought).toBeGreaterThanOrEqual(2)
    expect(r.metrics.population.start).toBe(s.baseline.population)
    expect(r.metrics.population.end).toBe(s.community.population)
    expect(r.cumulative.foodProducedT).toBeCloseTo(s.history.slice(1).reduce((a, p) => a + p.foodProducedT, 0), 6)
    expect(r.objectivesMet).toBe(r.objectives.filter((o) => o.met).length)
    expect(r.keyMoments.length).toBeGreaterThan(0)
  }, LONG)

  test('mid-game report is marked incomplete', () => {
    const r = endReport(step(initial()).state)
    expect(r.complete).toBe(false)
  }, LONG)

  test('every parameter is tagged evidence-informed or game-balance with a note', () => {
    const ps = listParameters()
    expect(ps.length).toBeGreaterThan(60)
    for (const p of ps) {
      expect(['evidence-informed', 'game-balance']).toContain(p.evidence)
      expect(p.note.length).toBeGreaterThan(10)
      expect(p.note).not.toMatch(/\u2014/)
    }
    expect(ps.filter((p) => p.evidence === 'evidence-informed').length).toBeGreaterThan(10)
  }, LONG)
})
