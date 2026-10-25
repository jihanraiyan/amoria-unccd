// Regression tests for the round 5 fixes: Escape on the end report, the reservoir brush, the
// inspector's sensitivity matching the overlay, the overlay ids and source labels, autosave
// failures, the start-of-game inspector, the camera buttons in the tutorial, undo after a
// reload, quieter live regions, per-run reflection notes and the Compare slider's text.
import './dom'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { environmentalSensitivity, erosionSusceptibility, floodExposure, sensitivityParts } from '../../src/simulation/derived/overlays'
import { coverCode, structureCode, type SimulationState } from '../../src/simulation/types'
import { STORAGE_KEYS } from '../../src/state/storage'
import { toolCellsAt, type ToolId } from '../../src/state/toolActions'
import { PROCEDURAL_WORLD_ID } from '../../src/state/worlds'
import { cellSensitivity } from '../../src/ui/inspector/sensitivity'
import { OVERLAY_FALLBACK, sourceLabel } from '../../src/ui/panels/OverlaysPanel'
import { TOOLS } from '../../src/ui/toolbar/tools'
import { findValidCell, stubWebGL } from './helpers'

vi.mock('../../src/app/gameModules', async () => {
  const React = await import('react')
  const { useGame } = await import('../../src/state/store')
  function GameWorld() {
    const sim = useGame((s) => s.sim)
    return React.createElement('div', { 'data-testid': 'game-world' }, `world step ${sim?.step ?? '-'}`)
  }
  function LandingScene() {
    return React.createElement('div', { 'data-testid': 'landing-scene' })
  }
  const exportsValue = { GameWorld, LandingScene, SnapshotView: null, overlays: null, helpers: null }
  return {
    loadGameExports: async () => exportsValue,
    useGameExports: () => exportsValue,
  }
})

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

const isWater = (s: SimulationState, i: number) =>
  s.terrain.channel[i] === 1 || s.layers.cover[i] === coverCode('water') || s.layers.structure[i] === structureCode('reservoir')

describe('Escape on the end report', () => {
  test('closes only the report: the open panel and the tool stay', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await act(async () => {
      await g().newGame(PROCEDURAL_WORLD_ID, 42)
    })
    act(() => {
      g().setTool('cropland')
      g().openPanel('charts')
      g().openReport()
    })
    const report = screen.getByRole('dialog', { name: /years in the valley/ })
    fireEvent.keyDown(report, { key: 'Escape' })
    expect(g().reportOpen).toBe(false)
    expect(g().panel).toBe('charts')
    expect(g().tool).toBe('cropland')
  })
})

describe('what the toolbar shows matches what a tool paints', () => {
  test('every tool that hides the brush paints a single parcel, whatever brush is stored', async () => {
    const { useGame } = await freshStore()
    await useGame.getState().newGame(PROCEDURAL_WORLD_ID, 42)
    const { width, height } = useGame.getState().sim!.terrain
    const centre = Math.floor(height / 2) * width + Math.floor(width / 2)
    for (const def of TOOLS) {
      if (def.id === 'inspect') continue
      const cells = toolCellsAt(def.id as ToolId, centre, 3, width, height)
      if (def.brush) expect(cells.length, def.id).toBeGreaterThan(1)
      else expect(cells.length, def.id).toBe(1)
    }
  })

  test('picking Reservoir after a big reforestation brush shows the brush control', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await act(async () => {
      await g().newGame(PROCEDURAL_WORLD_ID, 42)
    })
    act(() => {
      g().setTool('reforest')
      g().setBrush(3)
      g().setTool('reservoir')
    })
    expect(screen.getByText('radius 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Smaller brush ([)' })).toBeEnabled()
  })
})

describe('inspector sensitivity is the overlay value', () => {
  test('the meter shows environmentalSensitivity for the selected parcel', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await act(async () => {
      await g().newGame(PROCEDURAL_WORLD_ID, 42)
    })
    const sim = g().sim!
    const sens = environmentalSensitivity(sim)
    let cell = -1
    for (let i = 0; i < sens.length; i++) if (!isWater(sim, i) && sens[i] > 0.5) cell = i
    expect(cell).toBeGreaterThanOrEqual(0)
    act(() => g().selectCell(cell))
    const inspector = screen.getByRole('complementary', { name: 'Parcel inspector' })
    const meter = within(inspector).getByText('Sensitivity').parentElement as HTMLElement
    expect(meter).toHaveTextContent(sens[cell].toFixed(2))
    expect(within(inspector).getByText(`${erosionSusceptibility(sim)[cell].toFixed(1)} game t/ha`)).toBeInTheDocument()
    expect(within(inspector).getByText('Compared with the rest of the valley')).toBeInTheDocument()
    expect(within(inspector).getByRole('button', { name: /^Derived indicator: Derived indicator computed by the simulation/ })).toBeInTheDocument()
  })

  test('the named part is the highest one on every land parcel', async () => {
    const { useGame } = await freshStore()
    await useGame.getState().newGame(PROCEDURAL_WORLD_ID, 42)
    const sim = useGame.getState().sim!
    const sens = environmentalSensitivity(sim)
    const flood = floodExposure(sim)
    const bare = sensitivityParts(sim).erosion
    for (let i = 0; i < sens.length; i++) {
      const c = cellSensitivity(sim, null, i)
      if (isWater(sim, i)) {
        expect(c.index).toBeNull()
        continue
      }
      expect(c.index).toBeCloseTo(sens[i], 6)
      if (c.driver === 'flood') expect(flood[i]).toBeCloseTo(sens[i], 4)
      if (c.driver === 'erosion') expect(bare[i]).toBeCloseTo(sens[i], 4)
      if (c.driver === 'wetland') expect(sim.layers.cover[i]).toBe(coverCode('wetland'))
      if (c.driver === 'stream-bank') expect(sim.terrain.channelDistance[i]).toBeLessThanOrEqual(1)
    }
  })

  test('a past snapshot is read from that snapshot', async () => {
    const { useGame } = await freshStore()
    const g = () => useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 42)
    g().stepSeason()
    g().stepSeason()
    const snap = g().snapshots[1]
    const expected = environmentalSensitivity({ ...g().sim!, layers: snap.layers, fields: snap.fields })
    const cell = expected.findIndex((v) => v > 0)
    expect(cellSensitivity(g().sim!, snap, cell).index).toBeCloseTo(expected[cell], 6)
  })
})

describe('overlays', () => {
  test('the fallback lists erosion risk and urban development', () => {
    const ids = OVERLAY_FALLBACK.map((o) => o.id)
    expect(ids).toContain('susceptibility')
    expect(ids).toContain('urban')
    expect(OVERLAY_FALLBACK.find((o) => o.id === 'susceptibility')?.label).toBe('Erosion risk')
    expect(OVERLAY_FALLBACK.find((o) => o.id === 'urban')?.label).toBe('Urban development')
  })

  test('every source has a label, and terrain depends on the map', () => {
    expect(sourceLabel('derived-indicator', 'procedural')).toBe('Derived indicator computed by the simulation')
    expect(sourceLabel('terrain', 'real-data-derived', 'elevation')).toBe('Observed baseline data (elevation, depression-filled)')
    expect(sourceLabel('terrain', 'real-data-derived', 'slope')).toBe('Derived from observed elevation')
    expect(sourceLabel('terrain', 'procedural')).toBe('Fictional map terrain')
    expect(sourceLabel('model-output', 'procedural')).toMatch(/Illustrative model output/)
    expect(sourceLabel('state', 'procedural')).toBeTruthy()
    expect(sourceLabel('display-index', 'procedural')).toBeNull()
  })

  test('the store accepts the new overlay ids', async () => {
    const { useGame } = await freshStore()
    useGame.getState().setOverlay('susceptibility')
    expect(useGame.getState().overlay).toBe('susceptibility')
    useGame.getState().setOverlay('urban')
    expect(useGame.getState().overlay).toBe('urban')
  })
})

describe('autosave failures are visible', () => {
  test('the first failed autosave warns once, sets the flag, and the next good save clears it', async () => {
    const { useGame } = await freshStore()
    const g = () => useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 42)
    expect(g().autosaveFailed).toBe(false)
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    g().stepSeason()
    expect(g().autosaveFailed).toBe(true)
    expect(g().feedback?.kind).toBe('warning')
    expect(g().feedback?.text).toMatch(/could not be saved/)
    const warnId = g().feedback!.id
    g().stepSeason()
    // still failing: no second warning
    expect(g().feedback?.id).toBe(warnId)
    spy.mockRestore()
    g().stepSeason()
    expect(g().autosaveFailed).toBe(false)
  })

  test('Settings and the exit tip stop promising a save while it fails', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await act(async () => {
      await g().newGame(PROCEDURAL_WORLD_ID, 42)
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    act(() => {
      g().stepSeason()
      g().openPanel('settings')
    })
    expect(screen.queryByText(/saves automatically in this browser after every change/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/the last change could not be saved/).length).toBeGreaterThan(0)
  })
})

describe('the start of the game in the inspector', () => {
  test('viewing the start snapshot later says no season has been simulated', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await act(async () => {
      await g().newGame(PROCEDURAL_WORLD_ID, 42)
    })
    const cell = findValidCell(g().sim!, 'cropland')
    act(() => g().selectCell(cell))
    expect(screen.getByText(/No season has been simulated yet/)).toBeInTheDocument()
    act(() => {
      g().stepSeason()
      g().stepSeason()
      g().viewHistory(0)
      g().selectCell(cell)
    })
    expect(screen.getByText(/No season has been simulated yet/)).toBeInTheDocument()
    expect(screen.queryByText('Ran off')).not.toBeInTheDocument()
    act(() => g().viewHistory(1))
    expect(screen.getByText('Ran off')).toBeInTheDocument()
  })
})

describe('camera buttons count for the tutorial', () => {
  test('clicking Zoom in moves the tutorial to step 2', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await act(async () => {
      await g().newGame(PROCEDURAL_WORLD_ID, 42)
    })
    expect(g().tutorial.index).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(g().tutorial.index).toBe(1)
  })
})

describe('undo after a reload', () => {
  test('edits made earlier in the current season can still be undone, one at a time', async () => {
    let store = await freshStore()
    let g = () => store.useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 42)
    g().stepSeason()
    const before = g().sim!.economy.budget
    g().setTool('cropland')
    g().commitCells([findValidCell(g().sim!, 'cropland')])
    const mid = g().sim!.economy.budget
    g().setTool('reforest')
    g().commitCells([findValidCell(g().sim!, 'reforest', ['grassland', 'bare', 'shrubland'])])
    const after = g().sim!.economy.budget
    expect(after).toBeLessThan(mid)
    expect(mid).toBeLessThan(before)

    store = await freshStore()
    g = () => store.useGame.getState()
    expect(await g().continueGame()).toBe(true)
    expect(g().sim!.economy.budget).toBeCloseTo(after, 2)
    expect(g().undoStack).toHaveLength(2)
    g().undo()
    expect(g().sim!.economy.budget).toBeCloseTo(mid, 2)
    expect(g().log).toHaveLength(1)
    g().undo()
    expect(g().sim!.economy.budget).toBeCloseTo(before, 2)
    expect(g().log).toHaveLength(0)
    g().undo()
    expect(g().feedback?.text).toMatch(/^Nothing to undo this season/)
    // redo rebuilds them in order
    g().redo()
    g().redo()
    expect(g().sim!.economy.budget).toBeCloseTo(after, 2)
  })

  test('edits from seasons already played are not undoable after a reload', async () => {
    let store = await freshStore()
    let g = () => store.useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 42)
    g().setTool('cropland')
    g().commitCells([findValidCell(g().sim!, 'cropland')])
    g().stepSeason()
    store = await freshStore()
    g = () => store.useGame.getState()
    await g().continueGame()
    expect(g().undoStack).toHaveLength(0)
  })
})

describe('live regions stay quiet during play', () => {
  test('the top-bar date is not a live region', async () => {
    const { useGame } = await mountApp()
    await act(async () => {
      await useGame.getState().newGame(PROCEDURAL_WORLD_ID, 42)
    })
    const dates = screen.getAllByText(/^Year 1/)
    expect(dates.length).toBeGreaterThan(0)
    for (const d of dates) expect(d.closest('[aria-live]')).toBeNull()
  })

  test('toasts are not a live region; one summary line is announced per season', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await act(async () => {
      await g().newGame(PROCEDURAL_WORLD_ID, 42)
    })
    const list = screen.getByRole('list', { name: 'Notifications' })
    expect(list).not.toHaveAttribute('aria-live')
    // step by hand until a season brings toasts: every new one is read, in one line
    let fresh: { id: number; title: string }[] = []
    for (let k = 0; k < 40 && !fresh.length; k++) {
      const before = g().toasts.map((t) => t.id)
      act(() => g().stepSeason())
      fresh = g().toasts.filter((t) => !before.includes(t.id))
    }
    expect(fresh.length).toBeGreaterThan(0)
    const a = g().toastAnnouncement!
    for (const t of fresh) expect(a.text).toContain(t.title.replace(/[.!]$/, ''))
    expect(screen.getByTestId('toast-announcer')).toHaveTextContent(a.text)
  })

  test('while playing, only warnings and critical toasts are announced', async () => {
    const { useGame, stopClock } = await freshStore()
    const g = () => useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 42)
    for (let k = 0; k < 30; k++) {
      // critical news pauses play (round 7), so press play again before each season
      useGame.setState({ playing: true })
      const before = g().toasts.map((t) => t.id)
      g().stepSeason()
      const fresh = g().toasts.filter((t) => !before.includes(t.id))
      const loud = fresh.filter((t) => t.severity === 'warning' || t.severity === 'critical')
      if (!loud.length) expect(g().toastAnnouncement).toBeNull()
      else for (const t of loud) expect(g().toastAnnouncement!.text).toContain(t.title.replace(/[.!]$/, ''))
      for (const t of fresh.filter((x) => !loud.includes(x))) expect(g().toastAnnouncement?.text ?? '').not.toContain(`${t.title.replace(/[.!]$/, '')}.`)
      if (g().reportOpen) break
    }
    stopClock()
  })
})

describe('reflection notes belong to one run', () => {
  test('a reset with the same seed starts with empty notes; the old run keeps its own after a reload', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await act(async () => {
      await g().newGame(PROCEDURAL_WORLD_ID, 42)
    })
    const firstRun = g().runId
    expect(firstRun).toBeTruthy()
    act(() => g().openReport())
    const box = screen.getAllByRole('textbox')[0]
    fireEvent.change(box, { target: { value: 'Terraces helped' } })
    act(() => g().closeReport())
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.reflections) ?? '{}') as Record<string, Record<string, string>>
    expect(Object.values(stored[firstRun!] ?? {})).toContain('Terraces helped')

    await act(async () => {
      await g().resetRun()
    })
    expect(g().runId).not.toBe(firstRun)
    act(() => g().openReport())
    expect(screen.getAllByRole('textbox')[0]).toHaveValue('')
  })

  test('the run id survives a reload', async () => {
    let store = await freshStore()
    await store.useGame.getState().newGame(PROCEDURAL_WORLD_ID, 42)
    const id = store.useGame.getState().runId
    store = await freshStore()
    await store.useGame.getState().continueGame()
    expect(store.useGame.getState().runId).toBe(id)
  })
})

describe('the Compare season slider', () => {
  test('announces the season, with the weather when it was unusual', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await act(async () => {
      await g().newGame(PROCEDURAL_WORLD_ID, 42)
    })
    act(() => {
      for (let k = 0; k < 6; k++) g().stepSeason()
      g().closeReport()
      g().saveScenarioA()
    })
    await act(async () => {
      await g().branchScenarioB()
    })
    act(() => {
      for (let k = 0; k < 6; k++) g().stepSeason()
      g().closeReport()
    })
    await act(async () => {
      await g().openCompare()
    })
    const slider = screen.getByRole('slider', { name: 'Season shown in both landscapes' })
    const step = g().compare.step
    const kind = g().compare.A!.state.weather[step - 1]?.kind
    expect(slider.getAttribute('aria-valuetext')).toMatch(/^After year \d+, (wet|dry) season/)
    if (kind && kind !== 'normal') expect(slider.getAttribute('aria-valuetext')).toMatch(/\(.+\)$/)
  })
})
