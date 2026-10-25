import { applyAction, createInitialState, step } from '../engine'
import { AGRI, TIME, VEG } from '../params'
import type { Explanation, SimulationState } from '../types'
import { initial, must, rich, cells, C, KAANI_WORLD, S } from './helpers'

const countStructure = (s: SimulationState, code: number) => s.layers.structure.reduce((a, v) => a + (v === code ? 1 : 0), 0)
import { play, STRATEGIES, tryAction } from './bots/strategies'

const runFor = (s: SimulationState, steps: number) => {
  const out: Explanation[] = []
  for (let k = 0; k < steps; k++) {
    const r = step(s)
    out.push(...r.explanations)
    s = r.state
  }
  return { s, out }
}

describe('grounded explanations', () => {
  const { out } = runFor(initial(), 40)
  const bal = play('balanced', STRATEGIES.balanced).final.explanations

  test('every explanation cites finite evidence values and uses no em dashes', () => {
    for (const e of [...out, ...bal, ...initial().explanations]) {
      expect(e.evidence.length).toBeGreaterThan(0)
      for (const v of e.evidence) {
        expect(Number.isFinite(v.after)).toBe(true)
        if (v.before !== undefined) expect(Number.isFinite(v.before)).toBe(true)
      }
      expect(`${e.title} ${e.body}`).not.toMatch(/\u2014|NaN|undefined|Infinity/)
      expect(e.id).toMatch(/^s\d+-/)
    }
  })

  test('drought explanations name the weather as exogenous and cite the rainfall shortfall', () => {
    const d = out.filter((e) => e.topic === 'event' && e.title.startsWith('Drought'))
    expect(d.length).toBeGreaterThan(0)
    for (const e of d) {
      expect(e.body).toContain('(weather)')
      expect(e.body).toContain('not whether it comes')
      const rain = e.evidence.find((v) => v.label === 'Rainfall')!
      expect(rain.after).toBeLessThan(rain.before!)
    }
  })

  test('harvest drops in a drought are traced to the water factor and the rainfall', () => {
    const falls = out.filter((e) => e.topic === 'food' && e.title.startsWith('Harvest fell'))
    expect(falls.length).toBeGreaterThan(0)
    const drought = falls.find((e) => e.body.includes('drought cut rainfall'))
    expect(drought).toBeDefined()
    expect(drought!.evidence.some((v) => v.label === 'Crop water factor')).toBe(true)
  })

  test('player-caused changes are attributed to decisions, separately from weather', () => {
    let s = rich(initial())
    s = step(step(s).state).state // reach year 2 wet with a history point for the same season
    const grass = cells(s, (i) => s.layers.cover[i] === C.grassland && s.terrain.slope[i] < 0.08 && !s.terrain.protected[i]).slice(0, 120)
    s = must(s, { type: 'cropland', cells: grass, intensity: 'high', irrigated: false })
    const r = step(s)
    const food = r.explanations.find((e) => e.topic === 'food' && e.title.startsWith('Harvest rose'))
    expect(food).toBeDefined()
    expect(food!.body).toContain('your land-use decisions')
    expect(r.explanations.some((e) => e.title === 'Your decisions this season')).toBe(true)
  })

  test('good outcomes are explained too', () => {
    const good = [...out, ...bal].filter((e) => e.severity === 'good')
    expect(good.length).toBeGreaterThan(3)
    expect(bal.some((e) => e.topic === 'vegetation' && e.severity === 'good')).toBe(true)
  })

  test('floods are explained with the upstream land state', () => {
    const f = [...out, ...bal].filter((e) => e.topic === 'flood')
    expect(f.length).toBeGreaterThan(0)
    for (const e of f) {
      expect(e.body).toContain('forest now covers')
      expect(e.evidence.some((v) => v.label === 'Forest share of land')).toBe(true)
    }
  })

  test('the start-of-game briefing describes real starting values', () => {
    const s = initial()
    const [e] = s.explanations
    expect(e.body).toContain(String(Math.round(s.community.population).toLocaleString('en-US')))
    expect(e.evidence.find((v) => v.label === 'Floodplain homes')!.after).toBeGreaterThan(0)
  })

  test('numbers in the prose come from parameters and state, and nothing claims an unsimulated effect', () => {
    // play a strategy that plants trees and one that strips the hills, collecting every explanation
    const collect = (bot: (typeof STRATEGIES)[string]) => {
      let s = initial()
      const all: Explanation[] = []
      for (let k = 0; k < 40; k++) {
        for (const a of bot(s)) {
          const r = applyAction(s, a)
          if (r.validation.ok) s = r.state
        }
        const r = step(s)
        all.push(...r.explanations)
        s = r.state
      }
      return all
    }
    const all = [...collect(STRATEGIES.agroforestry), ...collect(STRATEGIES.clearCut)]
    const years = (seasons: number) => String(seasons / TIME.seasonsPerYear.value)
    const mature = all.filter((e) => e.title.includes('reached maturity'))
    expect(mature.length).toBeGreaterThan(0)
    for (const e of mature) {
      expect(e.body).toContain(`Planted forest takes about ${years(VEG.matureSeasons.value.forest)} years, agroforestry ${years(VEG.matureSeasons.value.agroforestry)} and wetlands ${years(VEG.matureSeasons.value.wetland)}`)
    }
    const trees = all.filter((e) => e.title === 'Agroforestry trees started paying')
    expect(trees.length).toBeGreaterThan(0)
    for (const e of trees) expect(e.body).toContain(`about ${years(AGRI.treeProduct.value.fullAge)} years old`)
    const mud = all.filter((e) => e.title === 'Muddy water reached downstream households')
    expect(mud.length).toBeGreaterThan(0)
    for (const e of mud) {
      const h = e.evidence.find((v) => v.label === 'Downstream hazard index')!
      expect(h).toBeDefined()
      expect(e.body).toContain(String(h.after))
      expect(e.body).not.toMatch(/silted channels/)
    }
    for (const e of all) expect(e.body).not.toMatch(/\u2014/)
  }, 60_000)
})


describe('household water in a drought without a waterworks (Kaani map)', () => {
  // the real-data map starts with no waterworks, so homes rely on roof tanks and shallow wells
  let s = createInitialState(KAANI_WORLD, 42)
  const water: Explanation[] = []
  const withWorks: Explanation[] = []
  for (let k = 0; k < 16; k++) {
    const r = step(s)
    if (s.weather[s.step].kind === 'drought') water.push(...r.explanations.filter((e) => e.topic === 'water' && e.severity !== 'good'))
    s = r.state
  }
  let works = createInitialState(KAANI_WORLD, 42)
  for (let k = 0; k < 16; k++) {
    for (const a of STRATEGIES.clearAndFarm(works)) works = tryAction(works, a)
    const r = step(works)
    if (works.weather[works.step].kind === 'drought') withWorks.push(...r.explanations.filter((e) => e.topic === 'water' && e.severity !== 'good'))
    works = r.state
  }

  test('the sentence reads correctly and blames tanks and wells, not stream flow', () => {
    expect(countStructure(s, S.waterworks)).toBe(0)
    expect(water.length).toBeGreaterThan(0)
    for (const e of water) {
      expect(e.body).toContain('there is no waterworks to treat and pump water')
      expect(e.body).toMatch(/the drought \(\d+ mm, \d+% below the \d+ mm normal; weather\) filled roof tanks less and lowered well levels/)
      expect(e.body).not.toContain('stream flow')
      expect(e.body).not.toContain('(weather) lowered')
      expect(e.body).not.toContain('baseflow')
    }
  })

  test('with a waterworks, a drought shortfall does cite lower stream flow', () => {
    expect(countStructure(works, S.waterworks)).toBeGreaterThan(0)
    expect(withWorks.length).toBeGreaterThan(0)
    for (const e of withWorks) expect(e.body).toContain('lowered stream flow, filled roof tanks less and lowered well levels')
  })
})

describe('housing shortage explanation', () => {
  test('the title count can be rebuilt from the numbers in the body', () => {
    let s = createInitialState(KAANI_WORLD, 42)
    const found: Explanation[] = []
    for (let k = 0; k < 24 && found.length === 0; k++) {
      for (const a of STRATEGIES.clearAndFarm(s)) s = tryAction(s, a)
      const r = step(s)
      found.push(...r.explanations.filter((e) => e.title.endsWith('could not find a home')))
      s = r.state
    }
    expect(found.length).toBeGreaterThan(0)
    const n = (t: string) => Number(t.replace(/,/g, ''))
    for (const e of found) {
      const turned = n(e.title.match(/About ([\d,]+) people/)![1])
      const m = e.body.match(/^([\d,]+) people want to live here .*?only ([\d,]+) do now: [\d,]+ minus [\d,]+ leaves ([\d,]+) turned away\. Homes hold ([\d,]+) people, so ([\d,]+) residents live in overcrowded homes/)!
      expect(m).not.toBeNull()
      const [demand, pop, away, cap, crowded] = m.slice(1, 6).map(n)
      expect(demand - pop).toBe(turned)
      expect(away).toBe(turned)
      expect(Math.max(0, pop - cap)).toBe(crowded)
      expect(e.evidence.some((v) => v.label === 'Population')).toBe(true)
    }
  })
})

describe('insight text is written for players, not programmers', () => {
  /** Every explanation a bot run produces, season by season. */
  function explanationsOf(name: keyof typeof STRATEGIES, world?: Parameters<typeof createInitialState>[0]): Explanation[] {
    let s = world ? createInitialState(world, 42) : initial()
    const out: Explanation[] = []
    while (s.step < 40) {
      for (const a of STRATEGIES[name](s)) s = tryAction(s, a)
      const r = step(s)
      out.push(...r.explanations)
      s = r.state
    }
    return out
  }

  let all: Explanation[] = []
  beforeAll(() => {
    all = [...explanationsOf('intensify', KAANI_WORLD), ...explanationsOf('sprawl'), ...explanationsOf('clearCut'), ...explanationsOf('clearAndFarm', KAANI_WORLD)]
  }, 120_000)

  test('the budget shortfall names its largest costs in plain words', () => {
    const short = all.filter((e) => e.title.startsWith('Budget shortfall'))
    expect(short.length).toBeGreaterThan(0)
    for (const e of short) {
      expect(e.body).not.toMatch(/[a-z][A-Z]/)
      expect(e.body).toMatch(/Largest costs: /)
      expect(e.body).not.toMatch(/arrears|accrue/)
    }
    // high-input farming on Kaani: the farm program bill shows up as seed and fertiliser
    expect(short.some((e) => e.body.includes('seed and fertiliser'))).toBe(true)
  })

  test('no explanation uses code identifiers or engineering shorthand', () => {
    expect(all.some((e) => e.topic === 'flood')).toBe(true)
    for (const e of all) {
      for (const text of [e.title, e.body]) {
        expect(text, text).not.toMatch(/[a-z][A-Z]/)
        expect(text, text).not.toMatch(/bankfull|P = |arrears|accrue/)
        expect(text, text).not.toMatch(/\bm3\b/)
        expect(text, text).not.toMatch(/\u2014/)
      }
    }
  })

  test('erosion and sediment are never presented as plain tonnes (they are game units)', () => {
    // (harvests are food tonnes, which are real units, so food notes are left out)
    const soil = all.filter((e) => e.topic !== 'food' && /erosion|sediment/i.test(e.title + e.body))
    expect(soil.some((e) => /sediment left the valley/.test(e.body))).toBe(true)
    for (const e of soil) {
      // a number followed by a bare " t " (or "t." / "t,") would read as real tonnes
      expect(e.body, e.body).not.toMatch(/\d t\b/)
      for (const ev of e.evidence) if (/erosion|sediment|silt/i.test(ev.label)) expect(ev.unit ?? 'game t', ev.label).not.toBe('t')
    }
  })
})
