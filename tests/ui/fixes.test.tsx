// Regression tests for the round 3 fixes: decision records count only the parcels built, the
// preview follows tool, brush and option changes, truthful report wording on real maps, panels
// that follow the viewed past, visible in-game errors, scenario reset, safe exit, notes kept on
// close, roving focus in radio groups and tabs, and the flat-map legend.
import './dom'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { validateAction } from '../../src/simulation/engine'
import type { SimulationState } from '../../src/simulation/types'
import { STORAGE_KEYS } from '../../src/state/storage'
import { buildToolAction, DEFAULT_TOOL_OPTIONS, toolCellsAt, type ToolOptions } from '../../src/state/toolActions'
import { PROCEDURAL_WORLD_ID } from '../../src/state/worlds'
import { rovingTarget } from '../../src/ui/common/useRoving'
import { acquiredYears, observedCoverHint } from '../../src/ui/inspector/describe'
import { decisionSummary } from '../../src/ui/report/analysis'
import { mapOrigin, reportSpan } from '../../src/ui/report/EndReport'
import { describeRecord } from '../../src/ui/timeline/history'
import { stubWebGL } from './helpers'

vi.mock('../../src/app/gameModules', async () => {
  const React = await import('react')
  const { useGame } = await import('../../src/state/store')
  function GameWorld() {
    const sim = useGame((s) => s.sim)
    return React.createElement('div', { 'data-testid': 'game-world' }, `world step ${sim?.step ?? '-'}`)
  }
  function LandingScene(p: { worldId?: string }) {
    return React.createElement('div', { 'data-testid': 'landing-scene', 'data-world': p.worldId ?? '' })
  }
  const exportsValue = { GameWorld, LandingScene, SnapshotView: null, overlays: null, helpers: null }
  return {
    loadGameExports: async () => exportsValue,
    useGameExports: () => exportsValue,
  }
})

// whole-game flows replay many seasons; give them room when every team's suite runs in parallel
vi.setConfig({ testTimeout: 30_000 })

type StoreModule = typeof import('../../src/state/store')

async function freshStore(): Promise<StoreModule> {
  vi.resetModules()
  return import('../../src/state/store')
}

async function mountApp(): Promise<StoreModule> {
  const store = await freshStore()
  const { default: App } = await import('../../src/app/App')
  render(<App />)
  return store
}

beforeEach(() => {
  localStorage.clear()
  stubWebGL()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** A brush stroke where some, but not all, parcels are valid for `tool`. */
function partialStroke(sim: SimulationState, tool: 'housing' | 'cropland', brush: number) {
  const { width, height } = sim.terrain
  for (let c = 0; c < width * height; c++) {
    const cells = toolCellsAt(tool, c, brush, width, height)
    const action = buildToolAction(tool, cells, DEFAULT_TOOL_OPTIONS)!
    const v = validateAction(sim, action)
    const valid = v.cellOk.filter(Boolean).length
    if (v.ok && valid > 0 && valid < cells.length) return { center: c, cells: (action as { cells: number[] }).cells, valid, cost: v.cost }
  }
  throw new Error('no partial stroke found')
}

/** A parcel where cropland is fine rain-fed but refused when irrigated. */
function irrigationSensitiveCell(sim: SimulationState): number {
  const n = sim.terrain.width * sim.terrain.height
  const rain: ToolOptions = { intensity: 'medium', irrigated: false }
  const wet: ToolOptions = { intensity: 'medium', irrigated: true }
  for (let i = 0; i < n; i++) {
    const a = validateAction(sim, buildToolAction('cropland', [i], rain)!)
    const b = validateAction(sim, buildToolAction('cropland', [i], wet)!)
    if (a.ok && !b.ok) return i
  }
  throw new Error('no irrigation-sensitive cell')
}

describe('decision records count only the parcels built', () => {
  test('a partial brush stroke records, logs, replays and undoes exactly the valid parcels', async () => {
    const { useGame } = await freshStore()
    const g = () => useGame.getState()
    expect(await g().newGame(PROCEDURAL_WORLD_ID, 42)).toBe(true)
    const s0 = g().sim!
    const stroke = partialStroke(s0, 'housing', 1)
    act(() => {
      g().setTool('housing')
      g().commitCells(stroke.cells)
    })
    const s1 = g().sim!
    const d = s1.decisions[s1.decisions.length - 1]
    const logged = g().log[g().log.length - 1]
    expect('cells' in d.action && d.action.cells.length).toBe(stroke.valid)
    expect('cells' in logged.action && logged.action.cells.length).toBe(stroke.valid)
    expect(d.cost).toBeCloseTo(stroke.cost, 6)
    expect(s0.economy.budget - s1.economy.budget).toBeCloseTo(stroke.cost, 6)
    // the words used by the timeline markers, the past banner and the end report
    expect(describeRecord(d)).toContain(`${stroke.valid} parcel${stroke.valid === 1 ? '' : 's'}`)
    expect(decisionSummary(s1.decisions)[0].parcels).toBe(stroke.valid)
    // the feedback line still says what was skipped
    expect(g().feedback?.text).toMatch(new RegExp(`Built housing on ${stroke.valid} parcels?`))
    expect(g().feedback?.text).toContain(`Skipped ${stroke.cells.length - stroke.valid}`)
    // undo and redo move the same trimmed action
    act(() => g().undo())
    expect(g().sim).toBe(s0)
    act(() => g().redo())
    expect(g().sim!.decisions).toHaveLength(1)
    expect(Array.from(g().sim!.layers.structure)).toEqual(Array.from(s1.layers.structure))
    // replay from the log rebuilds the same state
    const { replayRun, fingerprint } = await import('../../src/state/replay')
    const r = replayRun(g().world!, g().seed, g().log, g().sim!.step)
    expect(r.rejected).toEqual([])
    expect(fingerprint(r.state)).toEqual(fingerprint(g().sim!))
  })

  test('the past banner and the end report show the number of parcels built', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await act(async () => {
      await g().newGame(PROCEDURAL_WORLD_ID, 42)
    })
    const stroke = partialStroke(g().sim!, 'housing', 1)
    const words = `built housing on ${stroke.valid} parcel${stroke.valid === 1 ? '' : 's'}`
    act(() => {
      g().setTool('housing')
      g().commitCells(stroke.cells)
      g().stepSeason()
      g().stepSeason()
      g().viewHistory(1)
    })
    const banner = screen.getByRole('region', { name: 'Viewing the past' })
    expect(banner).toBeTruthy()
    expect(within(banner).getByText(new RegExp(`^${words} for`, 'i'))).toBeInTheDocument()
    expect(within(banner).queryByText(new RegExp(`${stroke.cells.length} parcels`))).not.toBeInTheDocument()
    act(() => {
      g().viewHistory(null)
      g().openReport()
    })
    const report = screen.getByRole('dialog', { name: /years in the valley/ })
    expect(within(report).getByText(new RegExp(`${words} \\(`))).toBeInTheDocument()
  })
})

describe('the preview always matches what would be built', () => {
  test('Shift+arrows, then a bigger brush with ], keeps the preview equal to what Enter applies', async () => {
    const { useGame } = await freshStore()
    const { handleShortcut } = await import('../../src/app/useShortcuts')
    const g = () => useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 42)
    const { width, height } = g().sim!.terrain
    const stroke = partialStroke(g().sim!, 'housing', 1)
    useGame.setState({ screen: 'game', cursorCell: stroke.center, selectedCell: stroke.center })
    g().setTool('housing')
    expect(g().preview?.cells).toEqual([stroke.center])
    handleShortcut(new KeyboardEvent('keydown', { key: ']', code: 'BracketRight' }))
    expect(g().brush).toBe(1)
    const preview = g().preview!
    expect(preview.cells).toEqual(toolCellsAt('housing', stroke.center, 1, width, height))
    const willBuild = preview.cells.filter((_, i) => preview.validation.cellOk[i])
    expect(willBuild).toHaveLength(stroke.valid)
    expect(g().commitCursor()).toBe(true)
    const logged = g().log[g().log.length - 1].action
    expect('cells' in logged && logged.cells).toEqual(willBuild)
  })

  test('toggling irrigation re-validates the preview at once', async () => {
    const { useGame } = await freshStore()
    const g = () => useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 42)
    const cell = irrigationSensitiveCell(g().sim!)
    useGame.setState({ cursorCell: cell, selectedCell: cell })
    g().setTool('cropland')
    g().setToolOptions({ intensity: 'medium', irrigated: false })
    expect(g().preview?.validation.ok).toBe(true)
    g().setToolOptions({ irrigated: true })
    expect(g().preview?.cells).toEqual([cell])
    expect(g().preview?.validation.ok).toBe(false)
    expect(g().preview?.validation.reasons.join(' ')).toMatch(/irrigation/i)
  })

  test('switching tools by key while hovering shows the new preview without moving the pointer', async () => {
    const { useGame } = await freshStore()
    const g = () => useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 42)
    const { width, height } = g().sim!.terrain
    const cell = irrigationSensitiveCell(g().sim!)
    g().setHoverCell(cell)
    g().setBrush(1)
    g().setTool('cropland')
    expect(g().preview?.cells).toEqual(toolCellsAt('cropland', cell, 1, width, height))
    g().setTool('road')
    expect(g().preview?.cells).toEqual([cell])
    g().setTool('inspect')
    expect(g().preview).toBeNull()
  })
})

describe('end report wording', () => {
  test('only the fictional valley is called made up', () => {
    expect(mapOrigin({ kind: 'procedural', name: 'Amoria Valley' })).toMatch(/made up/)
    const real = mapOrigin({ kind: 'real-data-derived', name: 'Kaani, Machakos County (Kenya)' })
    expect(real).not.toMatch(/made up/)
    expect(real).toMatch(/landscape is built from real map data for Kaani, Machakos County \(Kenya\)/)
  })

  test('the heading names the real span once play goes past the horizon', () => {
    expect(reportSpan(40, 20).title).toBe('20 years in the valley')
    expect(reportSpan(50, 20)).toEqual({ eyebrow: 'Year 1 to year 25 report (guided goal: year 20, then sandbox)', title: '25 years in the valley' })
    expect(reportSpan(51, 20, 'Kaani').title).toBe('25.5 years in Kaani')
  })

  test('a real-data report does not say the map is made up', async () => {
    const { readFile } = await import('node:fs/promises')
    const { REAL_WORLDS } = await import('../../src/data/realWorlds.generated')
    if (!REAL_WORLDS.length) return
    vi.stubGlobal('fetch', async (url: string) => {
      const file = decodeURIComponent(String(url).split('/world-data/')[1] ?? '')
      const text = await readFile(new URL(`../../public/world-data/${file}`, import.meta.url), 'utf8')
      return new Response(text, { status: 200 })
    })
    const { useGame } = await mountApp()
    await act(async () => {
      expect(await useGame.getState().newGame(REAL_WORLDS[0].meta.id, 7)).toBe(true)
    })
    act(() => useGame.getState().openReport())
    const report = screen.getByRole('dialog', { name: /years in Kaani/ })
    expect(report).not.toHaveTextContent(/made up/)
    expect(within(report).getByText(/The landscape is built from real map data for Kaani/)).toBeInTheDocument()
  })

  test('reflection notes are kept when the report is closed without pressing Keep my notes', async () => {
    const { useGame } = await mountApp()
    await act(async () => {
      await useGame.getState().newGame(PROCEDURAL_WORLD_ID, 3)
    })
    act(() => useGame.getState().openReport())
    const report = screen.getByRole('dialog', { name: /years in the valley/ })
    fireEvent.change(within(report).getByLabelText('What tradeoff did you run into?'), { target: { value: 'Homes against fields' } })
    fireEvent.keyDown(report, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: /years in the valley/ })).not.toBeInTheDocument()
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.reflections) ?? '{}') as Record<string, Record<string, string>>
    expect(Object.values(stored).some((a) => a.tradeoff === 'Homes against fields')).toBe(true)
  })
})

describe('panels follow the viewed past', () => {
  test('Community and Budget show the snapshot being viewed and say so', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await act(async () => {
      await g().newGame(PROCEDURAL_WORLD_ID, 5)
    })
    act(() => {
      for (let k = 0; k < 6; k++) g().stepSeason()
      g().viewHistory(0)
      g().openPanel('community')
    })
    const community = screen.getByRole('dialog', { name: 'Community' })
    expect(within(community).getByText('People of the valley (past)')).toBeInTheDocument()
    expect(within(community).getByText(/Showing the past: the start of the game/)).toBeInTheDocument()
    expect(within(community).getByText(Math.round(g().snapshots[0].community.population).toLocaleString('en-US'))).toBeInTheDocument()
    act(() => g().openPanel('budget'))
    const budget = screen.getByRole('dialog', { name: 'Budget and economy' })
    expect(within(budget).getByText('Public finances (past)')).toBeInTheDocument()
    const { fmtMoney } = await import('../../src/ui/metrics')
    const money = fmtMoney(g().snapshots[0].economy.budget)
    expect(money).not.toBe(fmtMoney(g().sim!.economy.budget))
    expect(within(budget).getAllByText(money).length).toBeGreaterThan(0)
    expect(within(budget).getByRole('button', { name: /Borrow/ })).toBeDisabled()
  })
})

describe('errors, resets and exits are never silent', () => {
  test('a world that fails to load during a reset is reported in the game', async () => {
    const { useGame } = await freshStore()
    const g = () => useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 5)
    useGame.setState({ worldId: 'no-such-world' })
    expect(await g().resetRun()).toBe(false)
    expect(g().screen).toBe('game')
    expect(g().loadErrorKind).toBe('world')
    expect(g().feedback?.kind).toBe('error')
    expect(g().feedback?.text).toMatch(/not available/)
  })

  test('the title screen offers to delete the save only when the save itself is damaged', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await act(async () => {
      await g().newGame(PROCEDURAL_WORLD_ID, 5)
    })
    act(() => g().exitToLanding())
    expect(g().hasSave).toBe(true)
    await act(async () => {
      await g().newGame('no-such-world', 1)
    })
    expect(await screen.findByText('That did not work.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete the damaged save/i })).not.toBeInTheDocument()
    act(() => g().dismissLoadError())
    localStorage.setItem(STORAGE_KEYS.save, '{not json')
    await act(async () => {
      await g().continueGame()
    })
    expect(g().loadErrorKind).toBe('save')
    expect(screen.getByRole('button', { name: /delete the damaged save/i })).toBeInTheDocument()
  })

  test('resetting while playing Scenario A keeps A as saved and branches B from it', async () => {
    const { useGame } = await freshStore()
    const g = () => useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 9)
    g().stepSeason()
    g().stepSeason()
    g().saveScenarioA()
    const savedA = g().scenarios.A!
    expect(await g().resetRun()).toBe(true)
    expect(g().runLabel).toBeNull()
    expect(g().scenarios.A).toEqual(savedA)
    expect(g().feedback?.text).toMatch(/Scenario A is still saved/)
    g().stepSeason()
    expect(await g().branchScenarioB()).toBe(true)
    expect(g().runLabel).toBe('B')
    expect(g().scenarios.A).toEqual(savedA)
    expect(g().feedback?.text).not.toMatch(/kept/)
  })

  test('A is re-saved before branching only when the run extends the saved one', async () => {
    const { useGame } = await freshStore()
    const g = () => useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 9)
    g().stepSeason()
    g().saveScenarioA()
    g().stepSeason()
    expect(await g().branchScenarioB()).toBe(true)
    expect(g().scenarios.A!.endStep).toBe(2)
    expect(g().feedback?.text).toMatch(/seasons you played after saving are kept/)
  })

  test('exit stays in the game and warns when the browser refuses the save; a second press leaves', async () => {
    const { useGame } = await freshStore()
    const g = () => useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 9)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    g().exitToLanding()
    expect(g().screen).toBe('game')
    expect(g().feedback?.kind).toBe('error')
    expect(g().feedback?.text).toMatch(/Press Exit again to leave anyway/)
    g().exitToLanding()
    expect(g().screen).toBe('landing')
  })
})

describe('accessibility patterns', () => {
  test('rovingTarget wraps and supports Home and End', () => {
    expect(rovingTarget('ArrowRight', 2, 3)).toBe(0)
    expect(rovingTarget('ArrowLeft', 0, 3)).toBe(2)
    expect(rovingTarget('ArrowDown', 0, 3)).toBe(1)
    expect(rovingTarget('End', 0, 3)).toBe(2)
    expect(rovingTarget('Home', 2, 3)).toBe(0)
    expect(rovingTarget('a', 0, 3)).toBeNull()
  })

  test('speed radios and settings tabs move with the arrow keys and keep one tab stop', async () => {
    const { useGame } = await mountApp()
    await act(async () => {
      await useGame.getState().newGame(PROCEDURAL_WORLD_ID, 9)
    })
    const group = screen.getByRole('radiogroup', { name: 'Speed' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1])
    radios[0].focus()
    fireEvent.keyDown(radios[0], { key: 'ArrowRight' })
    expect(useGame.getState().speed).toBe(2)
    await waitFor(() => expect(document.activeElement).toBe(within(group).getAllByRole('radio')[1]))
    expect(within(group).getAllByRole('radio').map((r) => r.tabIndex)).toEqual([-1, 0, -1])

    act(() => useGame.getState().openPanel('settings'))
    const dlg = screen.getByRole('dialog', { name: 'Settings and help' })
    const tabs = within(dlg).getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('aria-controls', 'settings-tabpanel')
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    expect(within(dlg).getByRole('tab', { name: 'How to play' })).toHaveAttribute('aria-selected', 'true')
    expect(within(dlg).getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'settings-tab-controls')
  })

  test('decision markers have a 24 px hit area', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await act(async () => {
      await g().newGame(PROCEDURAL_WORLD_ID, 42)
    })
    const stroke = partialStroke(g().sim!, 'housing', 1)
    act(() => {
      g().setTool('housing')
      g().commitCells(stroke.cells)
      g().stepSeason()
    })
    const marker = within(screen.getByRole('list', { name: 'Your decisions' })).getByRole('button')
    expect(marker.className).toMatch(/\bh-6\b/)
    expect(marker.className).toMatch(/\bw-6\b/)
  })
})

describe('flat map and provenance hints', () => {
  test('the in-game flat map has a land-cover and preview legend', async () => {
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: () => null }
    proto.getContext = () => null
    const { useGame } = await mountApp()
    await act(async () => {
      await useGame.getState().newGame(PROCEDURAL_WORLD_ID, 9)
    })
    const legend = await screen.findByRole('list', { name: 'Flat map legend' })
    expect(within(legend).getByText('Buildings and roads')).toBeInTheDocument()
    expect(within(legend).getByText('Can build here')).toBeInTheDocument()
    expect(within(legend).getByText(/Cannot build here/)).toBeInTheDocument()
  })

  test('the observed-cover hint uses the map cell size and the source dates', () => {
    expect(acquiredYears('2021-01-01/2021-12-31')).toBe('2021')
    expect(acquiredYears('2010-12-26/2013-02-28')).toBe('2010 to 2013')
    expect(acquiredYears(undefined)).toBeNull()
    expect(observedCoverHint(30, { acquired: '2019-01-01/2019-12-31' })).toMatch(/this 30 m cell.*seen in 2019/)
    expect(observedCoverHint(undefined, undefined)).toMatch(/in this cell.*when the source imagery was taken/)
    expect(observedCoverHint(100, { version: 'v200 (observation period 2021)' })).toMatch(/seen in 2021/)
  })

  test('the landing scene is told which world the picker has chosen', async () => {
    await mountApp()
    const radio = await screen.findByRole('radio', { name: /Amoria Valley/ })
    fireEvent.click(radio)
    await waitFor(() => expect(screen.getByTestId('landing-scene')).toHaveAttribute('data-world', PROCEDURAL_WORLD_ID))
  })
})
