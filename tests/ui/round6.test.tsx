// Regression tests for the round 6 fixes: running costs in the preview and the toolbar, the
// generic-climate disclosure on real-data maps, data credits on the title and Compare screens,
// the WorldCover row and pooled-vote note in the inspector, terrain and erosion labels, the
// fairness sentence on Compare, the toolbar grouping and the small-screen tutorial text.
import './dom'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { validateAction } from '../../src/simulation/engine'
import { AGRI, ECON } from '../../src/simulation/params'
import { coverCode, type PlayerAction } from '../../src/simulation/types'
import { genericClimateNote } from '../../src/state/climateNote'
import { TUTORIAL_STEPS } from '../../src/state/tutorial'
import { actionUpkeep, toolUpkeepText, upkeepPhrase } from '../../src/state/upkeep'
import { pooledVoteNote } from '../../src/ui/inspector/describe'
import { displayUnit, sourceLabel } from '../../src/ui/panels/OverlaysPanel'
import { GROUP_LABEL, TOOLS } from '../../src/ui/toolbar/tools'
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
  function SnapshotView(p: { label?: string }) {
    return React.createElement('div', { 'data-testid': `snapshot-${p.label}` })
  }
  const exportsValue = { GameWorld, LandingScene, SnapshotView, overlays: null, helpers: null }
  return {
    loadGameExports: async () => exportsValue,
    useGameExports: () => exportsValue,
  }
})

vi.setConfig({ testTimeout: 30_000 })

type StoreModule = typeof import('../../src/state/store')

async function mountApp(): Promise<StoreModule> {
  vi.resetModules()
  const store = await import('../../src/state/store')
  const { default: App } = await import('../../src/app/App')
  render(<App />)
  return store
}

/** Serves public/world-data from disk, as the static host would. */
async function serveWorldData(): Promise<void> {
  const { readFile } = await import('node:fs/promises')
  vi.stubGlobal('fetch', async (url: string) => {
    const file = decodeURIComponent(String(url).split('/world-data/')[1] ?? '')
    const text = await readFile(new URL(`../../public/world-data/${file}`, import.meta.url), 'utf8')
    return new Response(text, { status: 200 })
  })
}

async function realWorld() {
  const { REAL_WORLDS } = await import('../../src/data/realWorlds.generated')
  return REAL_WORLDS[0]?.meta ?? null
}

const CREDIT_PATTERNS = [/Copernicus/, /ESA WorldCover/, /OpenStreetMap/]

beforeEach(() => {
  localStorage.clear()
  stubWebGL()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('running costs', () => {
  test('a high-intensity cropland preview shows the per-season input bill', async () => {
    const { useGame } = await mountApp()
    fireEvent.click(await screen.findByRole('radio', { name: /Amoria Valley/ }))
    fireEvent.click(screen.getByRole('button', { name: /start building/i }))
    await screen.findByTestId('game-world', {}, { timeout: 10_000 })
    const g = () => useGame.getState()
    act(() => {
      g().setTool('cropland')
      g().setToolOptions({ intensity: 'high', irrigated: false })
    })
    const sim = g().sim!
    const n = sim.terrain.width * sim.terrain.height
    let cell = -1
    for (let i = 0; i < n && cell < 0; i++) {
      if (validateAction(sim, { type: 'cropland', cells: [i], intensity: 'high', irrigated: false }).cellOk[0]) cell = i
    }
    expect(cell).toBeGreaterThanOrEqual(0)
    act(() => g().setPreviewCells([cell]))
    const ha = (sim.terrain.cellSizeM * sim.terrain.cellSizeM) / 10_000
    const bill = Math.round(AGRI.inputCost.value.high * ha * sim.economy.serviceLevel)
    const line = await screen.findByTestId('preview-upkeep')
    expect(line).toHaveTextContent(`then about $${bill.toLocaleString('en-US')} a season`)
  })

  test('raising a field from medium to high adds the input difference every season', async () => {
    const { loadWorld, PROCEDURAL_WORLD_ID } = await import('../../src/state/worlds')
    const { createInitialState } = await import('../../src/simulation/engine')
    const sim = createInitialState(await loadWorld(PROCEDURAL_WORLD_ID), 3)
    const crop = coverCode('cropland')
    const field = Array.from(sim.layers.cover).findIndex((c, i) => c === crop && sim.layers.intensity[i] === 1)
    expect(field).toBeGreaterThanOrEqual(0)
    const action: PlayerAction = { type: 'set-intensity', cells: [field], intensity: 'high' }
    const u = actionUpkeep(sim, action, validateAction(sim, action))!
    const ha = (sim.terrain.cellSizeM * sim.terrain.cellSizeM) / 10_000
    expect(u.perSeason).toBeCloseTo((AGRI.inputCost.value.high - AGRI.inputCost.value.medium) * ha * sim.economy.serviceLevel, 6)
    expect(upkeepPhrase(u)).toMatch(/^then about \$\d+ a season$/)
    // a road adds its maintenance
    const roadCell = Array.from({ length: sim.terrain.width * sim.terrain.height }, (_, i) => i).find(
      (i) => validateAction(sim, { type: 'road', cells: [i] }).cellOk[0],
    )!
    const road: PlayerAction = { type: 'road', cells: [roadCell] }
    expect(actionUpkeep(sim, road, validateAction(sim, road))!.perSeason).toBeCloseTo(ECON.maintenance.value.road, 6)
  })

  test('the toolbar tooltip and the intensity wording name the input bill', () => {
    const text = toolUpkeepText('set-intensity', { intensity: 'high', irrigated: false }, 100)!
    expect(text).toContain(`high $${AGRI.inputCost.value.high}`)
    expect(toolUpkeepText('cropland', { intensity: 'high', irrigated: false }, 100)).toContain(`$${AGRI.inputCost.value.high} a season in farm inputs`)
    const def = TOOLS.find((t) => t.id === 'set-intensity')!
    expect(def.tradeoffs.gain).not.toMatch(/income now/)
    expect(def.tradeoffs.gain).toMatch(/more food now/)
    expect(def.tradeoffs.cost).toMatch(/paid from the town fund every season/)
  })
})

describe('real-data map disclosures and credits', () => {
  test('the title screen card is short, names the radio by the world, discloses the generic climate and shows the credits', async () => {
    const real = await realWorld()
    if (!real) return
    await serveWorldData()
    await mountApp()
    const radio = await screen.findByRole('radio', { name: real.name })
    expect(radio).toBeChecked()
    expect(radio).toHaveAccessibleName(real.name)
    const description = radio.getAttribute('aria-describedby')!
    const line = document.getElementById(description)!
    expect(line.textContent!.length).toBeLessThan(600)
    expect(line).not.toHaveTextContent(/EPSG/)
    expect(screen.getByTestId('world-climate-note')).toHaveTextContent(/one wet and one dry, about 530 mm a year/)
    expect(screen.getByTestId('world-climate-note')).toHaveTextContent(/two rainy seasons/)
    // the long provenance sits behind a disclosure, outside the radio's label
    expect(screen.getByText(`Map details: ${real.name}`)).toBeInTheDocument()
    const credits = await screen.findByTestId('map-credits', {}, { timeout: 10_000 })
    for (const p of CREDIT_PATTERNS) expect(credits).toHaveTextContent(p)
  })

  test('the generic-climate note shows in Settings and in the Rainfall tooltip on the real map', async () => {
    const real = await realWorld()
    if (!real) return
    expect(genericClimateNote({ kind: 'procedural', name: 'Amoria Valley', id: 'amoria-valley' })).toBeNull()
    await serveWorldData()
    const { useGame } = await mountApp()
    await screen.findByRole('radio', { name: real.name })
    fireEvent.click(screen.getByRole('button', { name: /start building/i }))
    await screen.findByTestId('game-world', {}, { timeout: 10_000 })
    expect(useGame.getState().sim!.meta.kind).toBe('real-data-derived')
    act(() => useGame.getState().openPanel('settings'))
    const dlg = screen.getByRole('dialog', { name: 'Settings and help' })
    const tabs = within(dlg).getAllByRole('tab')
    const modelTab = tabs.find((t) => /model|about/i.test(t.textContent ?? ''))
    if (modelTab) fireEvent.click(modelTab)
    expect(within(dlg).getByTestId('settings-climate-note')).toHaveTextContent(/generic game values/)
    expect(within(dlg).getByText(/clearing forest raises the river's low flow/)).toBeInTheDocument()
    const { MetricHelp } = await import('../../src/ui/common/MetricHelp')
    const { METRICS } = await import('../../src/ui/metrics')
    render(<MetricHelp def={METRICS.rainfall} />)
    expect(screen.getByTestId('metric-real-data-note')).toHaveTextContent(/Only the terrain, land cover, streams and roads come from real data/)
  })

  test('Compare Futures on the real map shows the credits and the fairness sentence matches the checks', async () => {
    const real = await realWorld()
    if (!real) return
    await serveWorldData()
    const { useGame } = await mountApp()
    await screen.findByRole('radio', { name: real.name })
    fireEvent.click(screen.getByRole('button', { name: /start building/i }))
    await screen.findByTestId('game-world', {}, { timeout: 10_000 })
    const g = () => useGame.getState()
    act(() => g().stepSeason())
    act(() => {
      g().saveScenarioA()
    })
    await act(async () => {
      await g().branchScenarioB()
    })
    act(() => g().stepSeason())
    await act(async () => {
      await g().openCompare()
    })
    await waitFor(() => expect(g().compare.A && g().compare.B).toBeTruthy())
    const credits = await screen.findByTestId('map-credits')
    for (const p of CREDIT_PATTERNS) expect(credits).toHaveTextContent(p)
    expect(screen.getByTestId('fairness-note')).toHaveTextContent(/exactly the same weather/)
    // an old save with a different seed: the page must not claim the same weather
    const c = g().compare
    act(() => useGame.setState({ compare: { ...c, B: { ...c.B!, state: { ...c.B!.state, seed: c.B!.state.seed + 1 } } } }))
    expect(screen.getByTestId('fairness-note')).toHaveTextContent(/did not start from the same conditions/)
    expect(screen.queryByText(/exactly the same weather/)).not.toBeInTheDocument()
  })

  test('the inspector shows the native WorldCover class and explains a pooled vote', async () => {
    const real = await realWorld()
    if (!real) return
    await serveWorldData()
    const { useGame } = await mountApp()
    await screen.findByRole('radio', { name: real.name })
    fireEvent.click(screen.getByRole('button', { name: /start building/i }))
    await screen.findByTestId('game-world', {}, { timeout: 10_000 })
    const { worldCellData } = await import('../../src/state/worlds')
    const data = worldCellData(useGame.getState().world)
    expect(data.worldCoverClass).not.toBeNull()
    expect(data.worldCoverLegend?.[40]).toBe('Cropland')
    const grass = coverCode('grassland')
    const cell = Array.from(data.worldCoverClass!).findIndex((code, i) => code === 40 && data.observedCover![i] === grass)
    expect(cell).toBeGreaterThanOrEqual(0)
    act(() => useGame.getState().selectCell(cell))
    const inspector = screen.getByRole('complementary', { name: 'Parcel inspector' })
    expect(within(inspector).getByText('WorldCover 2021')).toBeInTheDocument()
    expect(within(inspector).getByText(`Cropland (${data.worldCoverSharePct![cell]}% of pixels)`)).toBeInTheDocument()
    expect(within(inspector).getByTestId('pooled-vote-note')).toHaveTextContent(/Shrubland and grassland pixels count together/)
    expect(within(inspector).getByRole('button', { name: /^Observed elevation, derived slope:.*97 cells were raised \(by up to 7 m\)/ })).toBeInTheDocument()
  })
})

describe('labels', () => {
  test('pooled-vote note only when the classes really differ', () => {
    expect(pooledVoteNote('Shrubland', 60, 'Grassland')).toBeNull()
    expect(pooledVoteNote('Tree cover', 70, 'Forest')).toBeNull()
    expect(pooledVoteNote('Cropland', 41, 'Grassland')).toMatch(/covers only 41% of the pixels/)
  })

  test('slope is derived, elevation is observed, and erosion units are game tonnes', () => {
    expect(sourceLabel('terrain', 'real-data-derived', 'slope')).toBe('Derived from observed elevation')
    expect(sourceLabel('terrain', 'real-data-derived', 'elevation')).toMatch(/^Observed baseline data/)
    expect(displayUnit('t/ha')).toBe('game t/ha')
    expect(displayUnit('12 t/ha')).toBe('12 game t/ha')
    expect(displayUnit('game t/ha')).toBe('game t/ha')
    expect(displayUnit('mm')).toBe('mm')
  })

  test('Clear land is not filed under Restore', () => {
    const clear = TOOLS.find((t) => t.id === 'clear')!
    expect(GROUP_LABEL[clear.group]).not.toBe('Restore')
  })

  test('the first tutorial step has a phone variant that does not mention camera buttons', () => {
    const nav = TUTORIAL_STEPS[0]
    expect(nav.smallTask).toBeDefined()
    expect(nav.smallTask).not.toMatch(/button/i)
    expect(nav.task).toMatch(/camera buttons/)
  })

  test('the harvest chart calls the event factor flood and mud, not weather', async () => {
    const { CHARTS } = await import('../../src/ui/charts/chartSpecs')
    const spec = CHARTS.find((c) => c.id === 'harvest-factors')!
    expect(spec.lines.map((l) => l.label)).toContain('Flood and mud factor')
    expect(spec.lines.map((l) => l.label)).not.toContain('Weather factor')
    expect(spec.note).toMatch(/Drought shows up in the water factor/)
  })
})
