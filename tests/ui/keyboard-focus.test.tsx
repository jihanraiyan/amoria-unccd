// Regression tests for the round 4 fixes: Enter builds at the keyboard cursor even when a button
// had focus, shortcuts survive sliders and checkboxes, the pointer preview is not announced,
// unavailable tools stay focusable, panels give focus back, the phone panel menu, the end report
// never silently replaces Scenario A, the terrain hint reads the map grid, and forgetting scenarios.
import './dom'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PROCEDURAL_WORLD_ID } from '../../src/state/worlds'
import { observedTerrainHint } from '../../src/ui/inspector/describe'
import { findValidCell, stubWebGL } from './helpers'

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

async function startGame(useGame: StoreModule['useGame'], seed = 9) {
  await act(async () => {
    expect(await useGame.getState().newGame(PROCEDURAL_WORLD_ID, seed)).toBe(true)
  })
  await screen.findByTestId('game-world', {}, { timeout: 10_000 })
}

const shiftArrow = (target: Element, code: string) => fireEvent.keyDown(target, { key: code, code, shiftKey: true })
const press = (target: Element, key: string, code = key) => fireEvent.keyDown(target, { key, code })

describe('Enter at the keyboard parcel cursor', () => {
  test('after clicking Season, Shift+arrow then Enter builds and no season runs', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await startGame(useGame)
    act(() => g().setTool('housing'))
    const season = screen.getByRole('button', { name: 'Advance one season' })
    season.focus()
    fireEvent.click(season)
    expect(g().sim!.step).toBe(1)
    const target = findValidCell(g().sim!, 'housing')
    const w = g().sim!.terrain.width
    // put the cursor one parcel left of a valid spot, then step onto it from the focused button
    act(() => useGame.setState({ cursorCell: target - 1 >= 0 && target % w > 0 ? target - 1 : target }))
    shiftArrow(document.activeElement ?? season, target % w > 0 ? 'ArrowRight' : 'ArrowLeft')
    if (g().cursorCell !== target) act(() => useGame.setState({ cursorCell: target }))
    expect(document.activeElement?.id).toBe('parcel-cursor')
    const budget = g().sim!.economy.budget
    const logLength = g().log.length
    press(document.activeElement!, 'Enter')
    expect(g().sim!.step).toBe(1)
    expect(g().log).toHaveLength(logLength + 1)
    expect(g().log.at(-1)?.action.type).toBe('housing')
    expect(g().sim!.economy.budget).toBeLessThan(budget)
  })

  test('a tool picked with Tab and Enter on its button can then build with Enter', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await startGame(useGame)
    const tools = screen.getByRole('navigation', { name: 'Land tools' })
    const housing = within(tools).getByRole('button', { name: /^Housing,/ })
    housing.focus()
    fireEvent.click(housing)
    expect(g().tool).toBe('housing')
    const target = findValidCell(g().sim!, 'housing')
    shiftArrow(housing, 'ArrowRight')
    act(() => useGame.setState({ cursorCell: target }))
    // the cursor move takes focus off the tool button, so the next Enter builds
    expect(document.activeElement).not.toBe(housing)
    expect(document.activeElement?.id).toBe('parcel-cursor')
    press(document.activeElement!, 'Enter')
    expect(g().tool).toBe('housing')
    expect(g().log.at(-1)?.action.type).toBe('housing')
  })

  test('without a cursor move first, Enter on a focused button still presses it', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await startGame(useGame)
    act(() => g().setTool('housing'))
    shiftArrow(document.body, 'ArrowRight')
    const season = screen.getByRole('button', { name: 'Advance one season' })
    fireEvent.pointerDown(season)
    season.focus()
    const logLength = g().log.length
    press(season, 'Enter')
    expect(g().log).toHaveLength(logLength)
  })
})

describe('shortcuts work while a slider or checkbox has focus', () => {
  test('Escape on the history scrubber returns to the present', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await startGame(useGame)
    act(() => {
      g().stepSeason()
      g().stepSeason()
    })
    const scrubber = document.getElementById('history-scrubber') as HTMLInputElement
    scrubber.focus()
    act(() => g().viewHistory(0))
    expect(g().viewStep).toBe(0)
    press(scrubber, 'Escape')
    expect(g().viewStep).toBeNull()
  })

  test('letters and numbers act on a slider, while arrows stay with the slider', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await startGame(useGame)
    act(() => g().stepSeason())
    const scrubber = document.getElementById('history-scrubber') as HTMLInputElement
    scrubber.focus()
    press(scrubber, 'y', 'KeyY')
    expect(g().sim!.step).toBe(3)
    press(scrubber, '1', 'Digit1')
    expect(g().panel).toBe('overlays')
    act(() => g().openPanel(null))
    const tool = g().tool
    shiftArrow(scrubber, 'ArrowRight')
    expect(g().cursorCell).toBeNull()
    expect(g().tool).toBe(tool)
  })

  test('the Reduce motion checkbox keeps Space but passes on the time keys', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await startGame(useGame)
    act(() => g().openPanel('settings'))
    const box = screen.getByRole('checkbox', { name: /Reduce motion/ })
    box.focus()
    const step = g().sim!.step
    press(box, '.', 'Period')
    expect(g().sim!.step).toBe(step + 1)
    expect(fireEvent.keyDown(box, { key: ' ', code: 'Space' })).toBe(true)
  })
})

describe('the hover preview is not announced', () => {
  test('a pointer preview sits outside the live region; the keyboard cursor read-out is inside it', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await startGame(useGame)
    act(() => g().setTool('housing'))
    const cell = findValidCell(g().sim!, 'housing')
    act(() => g().setPreviewCells([cell]))
    expect(g().cursorCell).toBeNull()
    expect(screen.getByText('Can build')).toBeInTheDocument()
    const live = document.getElementById('parcel-cursor')!
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live.textContent).not.toMatch(/Can build/)
    shiftArrow(document.body, 'ArrowRight')
    act(() => useGame.setState({ cursorCell: cell }))
    act(() => g().setPreviewCells([cell]))
    expect(live.textContent).toMatch(/Parcel \d+, \d+/)
    expect(live.textContent).toMatch(/Can build/)
  })
})

describe('unavailable tools stay reachable by keyboard', () => {
  test('they are aria-disabled, focusable, give their reason, and do nothing when pressed', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await startGame(useGame)
    act(() => g().stepSeason())
    act(() => g().viewHistory(0))
    const tools = screen.getByRole('navigation', { name: 'Land tools' })
    const housing = within(tools).getByRole('button', { name: /^Housing,/ })
    expect(housing).not.toBeDisabled()
    expect(housing).toHaveAttribute('aria-disabled', 'true')
    expect(housing.getAttribute('aria-label')).toMatch(/unavailable: You are viewing the past/)
    housing.focus()
    expect(document.activeElement).toBe(housing)
    fireEvent.click(housing)
    expect(g().tool).toBe('inspect')
  })
})

describe('panels give focus back when they close', () => {
  test('Escape returns focus to the button that opened the panel', async () => {
    const { useGame } = await mountApp()
    await startGame(useGame)
    const opener = screen.getAllByRole('button', { name: 'Overlays' }).find((b) => b.hasAttribute('data-panel-button'))!
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Overlays' })
    expect(document.activeElement).toBe(dialog)
    press(dialog, 'Escape')
    expect(screen.queryByRole('dialog', { name: 'Overlays' })).not.toBeInTheDocument()
    expect(document.activeElement).toBe(opener)
  })

  test('a panel opened by shortcut hands focus to its top-bar button on close', async () => {
    const { useGame } = await mountApp()
    await startGame(useGame)
    ;(document.activeElement as HTMLElement | null)?.blur()
    press(document.body, '2', 'Digit2')
    const dialog = screen.getByRole('dialog', { name: 'Budget and economy' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Budget and economy' }))
    expect(document.activeElement?.getAttribute('data-panel-button')).toBe('budget')
  })
})

describe('the panel rail', () => {
  test('has a button for every panel, and opening one inverts it', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await startGame(useGame)
    const rail = screen.getByRole('navigation', { name: 'Panels' })
    expect(within(rail).getAllByRole('button')).toHaveLength(7)
    const budget = within(rail).getByRole('button', { name: 'Budget' })
    fireEvent.click(budget)
    expect(g().panel).toBe('budget')
    expect(budget).toHaveAttribute('aria-pressed', 'true')
    // Save and Exit sit in the game menu, so they stay on screen
    expect(screen.getByRole('button', { name: 'Save game' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Exit to title screen' })).toBeInTheDocument()
  })
})

describe('the end report never silently replaces a saved Scenario A', () => {
  test('after a reset it offers B from the saved A, or replacing A, and says when A was saved', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await startGame(useGame)
    act(() => {
      g().stepSeason()
      g().stepSeason()
      g().saveScenarioA()
    })
    const savedA = g().scenarios.A!
    await act(async () => {
      expect(await g().resetRun()).toBe(true)
    })
    expect(g().runLabel).toBeNull()
    act(() => {
      g().stepSeason()
      g().openReport()
    })
    const report = screen.getByRole('dialog', { name: /years in the valley/ })
    expect(within(report).queryByRole('button', { name: /Try another strategy/ })).not.toBeInTheDocument()
    expect(within(report).getByText(/A Scenario A from an earlier run is saved \(at /)).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(within(report).getByRole('button', { name: 'Play Scenario B from saved A' }))
    })
    await vi.waitFor(() => expect(g().runLabel).toBe('B'))
    expect(g().scenarios.A).toEqual(savedA)
  })

  test('replacing A from the report is an explicit choice', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await startGame(useGame)
    act(() => {
      g().stepSeason()
      g().saveScenarioA()
    })
    await act(async () => {
      await g().resetRun()
    })
    act(() => {
      g().stepSeason()
      g().stepSeason()
      g().stepSeason()
      g().openReport()
    })
    const report = screen.getByRole('dialog', { name: /years in the valley/ })
    await act(async () => {
      fireEvent.click(within(report).getByRole('button', { name: 'Replace A with this run, then try another' }))
    })
    await vi.waitFor(() => expect(g().runLabel).toBe('B'))
    expect(g().scenarios.A!.endStep).toBe(3)
  })
})

describe('terrain provenance and saved scenarios', () => {
  test('the terrain hint is built from the map cell size', () => {
    expect(observedTerrainHint('Copernicus DEM', 30)).toMatch(/^Elevation from Copernicus DEM, averaged to 30 m cells and depression-filled/)
    expect(observedTerrainHint('Copernicus DEM', 250)).toMatch(/averaged to 250 m cells/)
    expect(observedTerrainHint('Copernicus DEM', undefined)).toMatch(/averaged onto the game grid/)
    expect(observedTerrainHint('Copernicus DEM', 0)).not.toMatch(/\d+ m cells/)
  })

  test('Settings can forget saved scenarios after a confirm', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await startGame(useGame)
    act(() => {
      g().stepSeason()
      g().saveScenarioA()
      g().openPanel('settings')
    })
    const dialog = screen.getByRole('dialog', { name: 'Settings and help' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Forget saved scenarios' }))
    expect(g().scenarios.A).not.toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep them' }))
    expect(g().scenarios.A).not.toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Forget saved scenarios' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, forget them' }))
    expect(g().scenarios.A).toBeNull()
    expect(g().runLabel).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Forget saved scenarios' })).not.toBeInTheDocument()
    // the stored save no longer carries a Scenario A
    const { STORAGE_KEYS } = await import('../../src/state/storage')
    const raw = localStorage.getItem(STORAGE_KEYS.save)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!).scenarios?.A ?? null).toBeNull()
  })
})
