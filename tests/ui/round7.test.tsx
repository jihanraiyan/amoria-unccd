// Regression tests for the round 7 fixes: household earnings everywhere, honest goal states,
// pause on critical news, metric wording, panel contrast, the Insights pin, visible status
// marks, small-screen tutorial text, unique table toggles, a navigable end report, the undo key
// on Apple platforms, plural wording, tap-reachable metric help and the Scenario A rebuild warning.
import './dom'
import '@testing-library/jest-dom/vitest'
import { readFileSync } from 'node:fs'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { coverCode, type Explanation, type SimulationState } from '../../src/simulation/types'
import { skippedDecisions } from '../../src/state/messages'
import { detailFor } from '../../src/state/objectives'
import { TUTORIAL_STEPS } from '../../src/state/tutorial'
import { PROCEDURAL_WORLD_ID } from '../../src/state/worlds'
import { LineChart } from '../../src/ui/charts/LineChart'
import { CHARTS } from '../../src/ui/charts/chartSpecs'
import { modKey } from '../../src/ui/common/platform'
import { COMPARE_METRICS, earnedSoFar, metricRows } from '../../src/ui/compare/diff'
import { parcelValue } from '../../src/ui/inspector/parcelValue'
import { METRICS, landValueOf } from '../../src/ui/metrics'
import { findValidCell, stubWebGL } from './helpers'

vi.setConfig({ testTimeout: 60_000 })

type StoreModule = typeof import('../../src/state/store')

async function freshStore(): Promise<StoreModule> {
  vi.resetModules()
  return import('../../src/state/store')
}

beforeEach(() => {
  localStorage.clear()
  stubWebGL()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** A game with agroforestry planted on a few farms, played until the trees bear. */
async function agroforestryGame(store: StoreModule, seasons = 16): Promise<SimulationState> {
  const g = () => store.useGame.getState()
  await g().newGame(PROCEDURAL_WORLD_ID, 42)
  g().updateSettings({ pauseOnEvents: false })
  g().setTool('agroforestry')
  for (let k = 0; k < 6; k++) {
    try {
      g().commitCells([findValidCell(g().sim!, 'agroforestry', ['cropland', 'grassland'])])
    } catch {
      break
    }
  }
  for (let k = 0; k < seasons && !g().reportOpen; k++) g().stepSeason()
  return g().sim!
}

describe('household earnings are visible', () => {
  test('a Household earnings chart reads crops, trees, grazing and bought food from history', () => {
    const spec = CHARTS.find((c) => c.id === 'earnings')
    expect(spec).toBeDefined()
    expect(spec!.lines.map((l) => l.id)).toEqual(['crops', 'trees', 'grazing', 'bought'])
    const p = { farmValue: 1000, treeProductValue: 300, grazingValue: 50, foodImportCost: 20 } as never
    expect(spec!.lines.map((l) => l.get(p))).toEqual([700, 300, 50, 20])
    expect(CHARTS.some((c) => c.id === 'livelihood')).toBe(true)
  })

  test('compare rows and the diff summary carry earnings and livelihoods', async () => {
    for (const id of ['landEarnings', 'treeEarnings', 'foodBought', 'livelihood'] as const) expect(COMPARE_METRICS).toContain(id)
    const store = await freshStore()
    const sim = await agroforestryGame(store, 14)
    const last = sim.history[sim.history.length - 1]
    const rows = metricRows(last, last)
    const land = rows.find((r) => r.id === 'landEarnings')!
    expect(land.a).toBeCloseTo(landValueOf(last))
    const sofar = earnedSoFar(sim, sim.step)
    const expected = sim.history.filter((p) => p.step > 0).reduce((a, p) => a + p.treeProductValue, 0)
    expect(sofar.trees).toBeCloseTo(expected)
    expect(sofar.trees).toBeGreaterThan(0)
  })

  test('parcel earnings add up to the season totals the engine recorded', async () => {
    const store = await freshStore()
    const sim = await agroforestryGame(store, 16)
    const snap = store.useGame.getState().snapshots[sim.step]
    const p = sim.history[sim.history.length - 1]
    let crop = 0
    let trees = 0
    let grazing = 0
    let forest = 0
    for (let i = 0; i < sim.terrain.width * sim.terrain.height; i++) {
      const v = parcelValue(sim.terrain, snap.layers, sim.fields, i)
      crop += v.crop
      trees += v.trees
      grazing += v.grazing
      forest += v.forest
    }
    const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b))
    expect(rel(crop, p.farmValue - p.treeProductValue)).toBeLessThan(0.01)
    expect(rel(trees, p.treeProductValue)).toBeLessThan(0.01)
    expect(rel(grazing, p.grazingValue)).toBeLessThan(0.01)
    expect(rel(forest, p.forestProductValue ?? 0)).toBeLessThan(0.01)
    expect(trees).toBeGreaterThan(0)
  })

  test('the Community panel lists last season earnings and the total so far', async () => {
    const store = await freshStore()
    const sim = await agroforestryGame(store, 14)
    const { CommunityPanel } = await import('../../src/ui/panels/CommunityPanel')
    render(<CommunityPanel />)
    const box = screen.getByTestId('household-earnings')
    const p = sim.history[sim.history.length - 1]
    expect(within(box).getByText('Tree products (agroforestry)')).toBeInTheDocument()
    expect(box).toHaveTextContent(METRICS.landEarnings.format(landValueOf(p)))
    expect(screen.getByTestId('earned-so-far')).toHaveTextContent(METRICS.landEarnings.format(earnedSoFar(sim, sim.step).land))
  })

  test('the inspector shows what an agroforestry parcel earned from its crop and its trees', async () => {
    const store = await freshStore()
    const sim = await agroforestryGame(store, 16)
    const agro = coverCode('agroforestry')
    const cell = Array.from(sim.layers.cover).findIndex((c) => c === agro)
    expect(cell).toBeGreaterThanOrEqual(0)
    act(() => store.useGame.getState().selectCell(cell))
    const { Inspector } = await import('../../src/ui/inspector/Inspector')
    render(<Inspector />)
    expect(screen.getByText('Earned here')).toBeInTheDocument()
    expect(screen.getByText('from the trees')).toBeInTheDocument()
  })
})

describe('goal states and wording', () => {
  test('floods and erosion read as comparisons with the starting village in the same weather', () => {
    expect(detailFor({ id: 'floods', value: 0, target: 0.9, direction: 'atMost', unit: 'x' })).toMatch(/^no home flooded/)
    expect(detailFor({ id: 'floods', value: 1.4, target: 0.9, direction: 'atMost', unit: 'x' })).toMatch(/1\.40 times as often as the starting village would in the same weather/)
    expect(detailFor({ id: 'erosion', value: 0.8, target: 0.95, direction: 'atMost', unit: 'x' })).toMatch(/0\.80 times what the starting landscape would lose in the same weather/)
    expect(detailFor({ id: 'floods', value: 0, target: 0.9, direction: 'atMost', unit: 'x' })).not.toMatch(/0\.00x/)
  })

  test('a drought that fell short shows Missed with its year, without a progress bar', async () => {
    const store = await freshStore()
    const g = () => store.useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 42)
    g().updateSettings({ pauseOnEvents: false })
    g().stepYear()
    const sim = g().sim!
    // the most recent played season becomes a drought in which food fell well short
    const history = sim.history.map((p, k) => (k === sim.history.length - 1 ? { ...p, weather: 'drought' as const, foodSecurity: 0.2 } : p))
    act(() => store.useGame.setState({ sim: { ...sim, history } }))
    const { ObjectivesPanel } = await import('../../src/ui/panels/ObjectivesPanel')
    render(<ObjectivesPanel />)
    const year = history[history.length - 1].year
    expect(screen.getByTestId('goal-state-drought')).toHaveTextContent(`Missed in year ${year}`)
    expect(screen.queryByRole('progressbar', { name: 'Ready for drought' })).toBeNull()
    expect(screen.getByText(new RegExp(`Missed in the year ${year} drought`))).toBeInTheDocument()
  })

  test('water security says where household water comes from', () => {
    expect(METRICS.water.measures).toBe('Whether homes get the water they need, from roof tanks, wells and piped supply.')
    expect(METRICS.water.measures).not.toMatch(/tap/)
  })
})

describe('pause on important news', () => {
  test('play stops on critical news or a drought starting, with a Paused toast that shows the place', async () => {
    const store = await freshStore()
    const g = () => store.useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 42)
    expect(g().settings.pauseOnEvents).toBe(true)
    let paused = false
    for (let k = 0; k < 40 && !paused && !g().reportOpen; k++) {
      store.useGame.setState({ playing: true })
      const before = g().sim!
      g().stepSeason()
      const fresh = g().explanations.slice(-20)
      const droughtStarts = g().sim!.history.at(-1)?.weather === 'drought' && before.history.at(-1)?.weather !== 'drought'
      const critical = fresh.some((e) => e.year === before.year && e.season === before.season && e.severity === 'critical')
      paused = !g().playing
      if (!critical && !droughtStarts) expect(g().playing).toBe(true)
    }
    expect(paused).toBe(true)
    const t = g().toasts.find((x) => x.paused)
    expect(t?.title).toMatch(/^Paused: /)
    store.stopClock()
  })

  test('with the setting off, play carries on through the same news', async () => {
    const store = await freshStore()
    const g = () => store.useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 42)
    g().updateSettings({ pauseOnEvents: false })
    store.useGame.setState({ playing: true })
    for (let k = 0; k < 12 && !g().reportOpen; k++) g().stepSeason()
    expect(g().playing).toBe(true)
    expect(g().toasts.some((t) => t.paused)).toBe(false)
    store.stopClock()
  })

  test('pauseReason prefers critical news and only names a drought when it starts', async () => {
    const { pauseReason } = await import('../../src/state/slices/time')
    const e = (over: Partial<Explanation>): Explanation => ({ id: 'x', year: 1, season: 'wet', topic: 'event', severity: 'warning', title: 'Drought: 80 mm of rain', body: '', evidence: [], ...over })
    const drought = e({ id: 'd' })
    const flood = e({ id: 'f', topic: 'flood', severity: 'critical', title: 'Flood reached 3 homes' })
    expect(pauseReason([drought, flood], true)?.id).toBe('f')
    expect(pauseReason([drought], true)?.id).toBe('d')
    expect(pauseReason([drought], false)).toBeNull()
  })
})

describe('contrast of small text on panels over the brightest sky', () => {
  const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
  const atmosphere = readFileSync(new URL('../../src/game/effects/atmosphereData.ts', import.meta.url), 'utf8')
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  const ratio = (a: number[], b: number[]) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
    return (x + 0.05) / (y + 0.05)
  }
  const token = (name: string, scope = css) => {
    const m = scope.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))
    if (!m) throw new Error(`token ${name} not found`)
    return hex(m[1])
  }
  const panel = css.match(/--panel-bg:\s*rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/)!
  const panelRgb = [Number(panel[1]), Number(panel[2]), Number(panel[3])]
  const alpha = Number(panel[4])
  // every sky, horizon and fog color the renderer can show behind a panel, plus pure white
  const backdrops = [
    ...new Set([...atmosphere.matchAll(/(?:skyTop|skyHorizon|fog): c\('(#[0-9a-fA-F]{6})'\)/g)].map((m) => m[1])),
    '#ffffff',
  ]
  const colorblind = css.slice(css.indexOf("[data-colorblind='true']"))
  const texts: [string, number[]][] = [
    ['dim', token('color-dim')],
    ['muted', token('color-muted')],
    ['ember', token('color-ember')],
    ['river', token('color-river')],
    ['marigold', token('color-marigold')],
    ['good', token('status-good')],
    ['warn', token('status-warn')],
    ['bad', token('status-bad')],
    ['colorblind good', token('status-good', colorblind)],
    ['colorblind warn', token('status-warn', colorblind)],
    ['colorblind bad', token('status-bad', colorblind)],
  ]

  test('panels are at least 90% opaque', () => {
    expect(alpha).toBeGreaterThanOrEqual(0.9)
    expect(backdrops.length).toBeGreaterThan(4)
  })

  test.each(texts)('%s text stays at or above 4.5:1', (_name, fg) => {
    for (const b of backdrops) {
      const back = hex(b)
      const bg = panelRgb.map((c, i) => c * alpha + back[i] * (1 - alpha))
      expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('Insights pin always shows the place', () => {
  test('pressing the pin on an expanded card keeps it open and sets the camera focus', async () => {
    const store = await freshStore()
    const g = () => store.useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 42)
    const e: Explanation = { id: 'pin-test', year: 1, season: 'wet', topic: 'soil', severity: 'warning', title: 'Soil washed off the slope', body: 'Body.', evidence: [{ label: 'Soil', after: 0.4 }], cells: [123] }
    act(() => store.useGame.setState({ explanations: [...g().explanations, e], focusCell: null }))
    const { InsightsPanel } = await import('../../src/ui/panels/InsightsPanel')
    render(<InsightsPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Soil washed off the slope' }))
    expect(g().activeExplanationId).toBe('pin-test')
    act(() => store.useGame.setState({ focusCell: null }))
    fireEvent.click(screen.getByRole('button', { name: 'Show "Soil washed off the slope" on the map' }))
    expect(g().activeExplanationId).toBe('pin-test')
    expect(g().focusCell).toBe(123)
    expect(screen.getByRole('button', { name: 'Soil washed off the slope' })).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('status never by color alone', () => {
  test('debt and a critical meter carry a visible mark', async () => {
    const store = await freshStore()
    const g = () => store.useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 42)
    g().dispatch({ type: 'loan', amount: 50_000 })
    const { BudgetPanel } = await import('../../src/ui/panels/BudgetPanel')
    render(<BudgetPanel />)
    expect(screen.getByText('Owed, charging interest')).toBeInTheDocument()
    expect(screen.getAllByTestId('status-mark').length).toBeGreaterThan(0)
    cleanup()
    const { Meter } = await import('../../src/ui/common/Panel')
    render(<Meter label="Food security" value={0.3} tone="bad" />)
    expect(screen.getByTestId('status-mark')).toHaveTextContent('!!')
  })
})

describe('small-screen tutorial text', () => {
  test('every step after navigating has a touch instruction, switched at md', async () => {
    for (const s of TUTORIAL_STEPS.slice(1)) {
      expect(s.smallTask, s.id).toBeTruthy()
      expect(s.smallTask).not.toMatch(/\([A-Z0-9.]\)|Shift|on the left/)
      expect(s.smallBelow ?? 'md').toBe('md')
    }
    const store = await freshStore()
    const g = () => store.useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 42)
    const build = TUTORIAL_STEPS.findIndex((s) => s.id === 'build')
    act(() => store.useGame.setState({ tutorial: { ...g().tutorial, active: true, done: false, index: build } }))
    const { TutorialCoach } = await import('../../src/ui/tutorial/TutorialCoach')
    render(<TutorialCoach />)
    expect(screen.getByTestId('tutorial-task-small')).toHaveClass('md:hidden')
    expect(screen.getByTestId('tutorial-task')).toHaveClass('md:block')
    expect(screen.getByTestId('tutorial-task-small')).toHaveTextContent(/from the bar at the bottom/)
  })
})

describe('chart table toggles have distinct names', () => {
  test('each toggle names its chart and controls its table', () => {
    render(
      <>
        <LineChart title="Forest cover" series={[{ id: 'a', label: 'A', values: [1, 2], color: '#fff' }]} xLabel={String} format={String} />
        <LineChart title="Wellbeing" series={[{ id: 'a', label: 'A', values: [1, 2], color: '#fff' }]} xLabel={String} format={String} />
      </>,
    )
    const btn = screen.getByRole('button', { name: 'Show data table for Forest cover' })
    expect(screen.getByRole('button', { name: 'Show data table for Wellbeing' })).toBeInTheDocument()
    fireEvent.click(btn)
    expect(btn).toHaveAccessibleName('Hide data table for Forest cover')
    expect(document.getElementById(btn.getAttribute('aria-controls')!)).not.toBeNull()
  })
})

describe('end report moments lead to Insights', () => {
  test('each listed moment and the Open Insights button close the report and open Insights', async () => {
    const store = await freshStore()
    const g = () => store.useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 42)
    const e: Explanation = { id: 'hard-1', year: 2, season: 'dry', topic: 'flood', severity: 'critical', title: 'Flood reached 2 homes', body: 'Body.', evidence: [], cells: [77] }
    act(() => store.useGame.setState({ explanations: [...g().explanations, e], sim: { ...g().sim!, explanations: [...(g().sim!.explanations ?? []), e] }, reportOpen: true }))
    const { EndReport } = await import('../../src/ui/report/EndReport')
    render(<EndReport />)
    fireEvent.click(screen.getByRole('button', { name: /Year 2:\s*Flood reached 2 homes/ }))
    expect(g().reportOpen).toBe(false)
    expect(g().panel).toBe('insights')
    expect(g().activeExplanationId).toBe('hard-1')
    act(() => store.useGame.setState({ reportOpen: true, panel: null }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Insights' }))
    expect(g().reportOpen).toBe(false)
    expect(g().panel).toBe('insights')
  })
})

describe('wording', () => {
  test('undo shows Cmd on Apple platforms and Ctrl elsewhere', () => {
    vi.stubGlobal('navigator', { ...navigator, platform: 'MacIntel', userAgent: 'Mac' })
    expect(modKey()).toBe('Cmd')
    vi.stubGlobal('navigator', { ...navigator, platform: 'Win32', userAgent: 'Windows' })
    expect(modKey()).toBe('Ctrl')
  })

  test('skipped decisions are pluralized in words', () => {
    expect(skippedDecisions(1)).toBe('1 saved decision is')
    expect(skippedDecisions(3)).toBe('3 saved decisions are')
  })
})

describe('metric help by tap', () => {
  test('each top-bar metric has an info toggletip that opens on click', async () => {
    const store = await freshStore()
    await store.useGame.getState().newGame(PROCEDURAL_WORLD_ID, 42)
    const { MetricsBar } = await import('../../src/ui/hud/TopBar')
    render(<MetricsBar />)
    for (const id of ['budget', 'population', 'food', 'water', 'land', 'wellbeing']) expect(screen.getByTestId(`metric-info-${id}`)).toBeInTheDocument()
    const info = screen.getByTestId('metric-info-water')
    fireEvent.click(info)
    const tip = document.getElementById(info.getAttribute('aria-describedby')!)!
    expect(tip).toHaveClass('visible')
    expect(tip).toHaveTextContent(METRICS.water.measures)
  })
})

describe('Compare warns when Scenario A loses decisions in the rebuild', () => {
  test('an entry the engine rejects is reported, not silently dropped', async () => {
    const store = await freshStore()
    const g = () => store.useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 31)
    g().updateSettings({ pauseOnEvents: false })
    g().stepYear()
    expect(g().saveScenarioA()).toBe(true)
    expect(await g().branchScenarioB()).toBe(true)
    g().stepYear()
    const sim = g().sim!
    const channel = Array.from(sim.terrain.channel).findIndex((c) => c > 0)
    expect(channel).toBeGreaterThanOrEqual(0)
    const A = g().scenarios.A!
    act(() =>
      store.useGame.setState({
        scenarios: { ...g().scenarios, A: { ...A, log: [{ step: 0, action: { type: 'housing', cells: [channel] } }, ...A.log] } },
        compare: { A: null, B: null, loading: false, error: null, step: 0 },
      }),
    )
    expect(await g().openCompare()).toBe(true)
    expect(g().feedback?.kind).toBe('warning')
    expect(g().feedback?.text).toMatch(/^Scenario A was rebuilt, but 1 of its saved decisions is no longer allowed/)
  })
})
