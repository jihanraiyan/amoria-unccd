// End-to-end user flow through the real interface, with the 3D canvas replaced by stubs
// (jsdom has no WebGL). The simulation, store and every UI component are the real ones.
import './dom'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { STORAGE_KEYS } from '../../src/state/storage'
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
  function SnapshotView(p: { label?: string; syncGroup?: string; snapshot: { year: number; season: string } }) {
    return React.createElement('div', { 'data-testid': `snapshot-${p.label}`, 'data-sync': p.syncGroup }, `${p.label} Y${p.snapshot.year} ${p.snapshot.season}`)
  }
  const overlays = [
    { id: 'none', label: 'No overlay', legend: [] },
    { id: 'erosion', label: 'Erosion pressure', description: 'Erosion index from last season.', legend: [{ color: '#000', label: 'Low' }, { color: '#fff', label: 'High' }], cue: { description: 'Denser hatching means more erosion.' } },
    { id: 'soil', label: 'Soil health', legend: [] },
  ]
  const exportsValue = { GameWorld, LandingScene, SnapshotView, overlays, helpers: null }
  return {
    loadGameExports: async () => exportsValue,
    useGameExports: () => exportsValue,
  }
})

// whole-game flows replay many seasons; give them room when every team's suite runs in parallel
vi.setConfig({ testTimeout: 30_000 })

type StoreModule = typeof import('../../src/state/store')

async function mountApp(): Promise<StoreModule> {
  vi.resetModules()
  const store = await import('../../src/state/store')
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
  vi.unstubAllGlobals()
})

/** Picks the fictional Amoria Valley (no download needed) once the world list has loaded. */
async function chooseValley() {
  const radio = await screen.findByRole('radio', { name: /Amoria Valley/ })
  fireEvent.click(radio)
}

describe('Amoria in the browser', () => {
  test('full flow: start, build, advance, overlay, insight, save, reload, compare', async () => {
    let { useGame } = await mountApp()
    const g = () => useGame.getState()

    // landing
    expect(screen.getByRole('heading', { name: 'Amoria' })).toBeInTheDocument()
    expect(screen.getByText('Build a city. Shape an ecosystem.')).toBeInTheDocument()
    expect(screen.getByTestId('landing-scene')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /continue/i })).not.toBeInTheDocument()
    await chooseValley()
    fireEvent.change(screen.getByLabelText('Weather seed'), { target: { value: '4242' } })
    fireEvent.click(screen.getByRole('button', { name: /start building/i }))

    // the world mounts with the HUD around it
    expect(await screen.findByTestId('game-world', {}, { timeout: 10_000 })).toHaveTextContent('world step 0')
    expect(g().seed).toBe(4242)
    expect(screen.getByRole('navigation', { name: 'Land tools' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Timeline' })).toBeInTheDocument()
    expect(screen.getByLabelText('Tutorial')).toHaveTextContent('Look around the valley')
    fireEvent.wheel(screen.getByTestId('world-layer'))
    expect(screen.getByLabelText('Tutorial')).toHaveTextContent('Inspect a parcel')

    // select a parcel through the store (the renderer would do this on click)
    const sim0 = g().sim!
    const cell = findValidCell(sim0, 'cropland', ['grassland'])
    act(() => g().selectCell(cell))
    const inspector = screen.getByRole('complementary', { name: 'Parcel inspector' })
    expect(within(inspector).getByText(`Parcel ${cell % sim0.terrain.width}, ${Math.floor(cell / sim0.terrain.width)}`)).toBeInTheDocument()
    expect(within(inspector).getByText('What you could do here')).toBeInTheDocument()

    // pick Cropland with its keyboard shortcut and place it where the renderer would commit
    fireEvent.keyDown(window, { key: 'c' })
    expect(g().tool).toBe('cropland')
    const toolbar = screen.getByRole('navigation', { name: 'Land tools' })
    expect(within(toolbar).getByRole('button', { name: /^Cropland/ })).toHaveAttribute('aria-pressed', 'true')
    const before = g().sim!.economy.budget
    const { validateAction } = await import('../../src/simulation/engine')
    const expected = validateAction(g().sim!, { type: 'cropland', cells: [cell], intensity: 'medium', irrigated: false })
    act(() => g().setPreviewCells([cell]))
    expect(screen.getByText('Can build')).toBeInTheDocument()
    act(() => g().commitCells([cell]))
    expect(before - g().sim!.economy.budget).toBeCloseTo(expected.cost - (expected.revenue ?? 0), 6)
    expect(await screen.findByText(/Planted cropland on 1 parcel/)).toBeInTheDocument()

    // also place housing from the inspector's live intervention list
    const houseCell = findValidCell(g().sim!, 'housing')
    act(() => g().selectCell(houseCell))
    const doHousing = within(screen.getByRole('complementary', { name: 'Parcel inspector' })).getByRole('button', { name: /^Housing here for/ })
    fireEvent.click(doHousing)
    expect(g().log.map((l) => l.action.type)).toEqual(['cropland', 'housing'])

    // see the cost in the budget panel
    fireEvent.click(screen.getByRole('button', { name: 'Budget' }))
    expect(screen.getByRole('dialog', { name: 'Budget and economy' })).toBeInTheDocument()
    expect(screen.getByText(/This season you made 2 changes/)).toBeInTheDocument()

    // advance time
    fireEvent.click(screen.getByRole('button', { name: 'Advance one season' }))
    expect(g().sim!.step).toBe(1)
    expect(screen.getByTestId('game-world')).toHaveTextContent('world step 1')
    expect(screen.getAllByText('Dry season').length).toBeGreaterThan(0)
    expect(g().snapshots).toHaveLength(2)
    // one new history point recorded for the season just played (the engine may also keep a start point)
    expect(g().sim!.history.length).toBeGreaterThanOrEqual(1)
    expect(g().sim!.history.length).toBeLessThanOrEqual(2)

    // undo now explains that past seasons are fixed
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(screen.getByText(/Seasons that already happened cannot be undone/)).toBeInTheDocument()

    // open an overlay and read its legend
    fireEvent.keyDown(window, { key: '1' })
    const overlays = screen.getByRole('dialog', { name: 'Overlays' })
    fireEvent.click(within(overlays).getByRole('radio', { name: 'Erosion pressure' }))
    expect(g().overlay).toBe('erosion')
    expect(within(overlays).getByText(/Denser hatching/)).toBeInTheDocument()

    // inspect an explanation: use one the engine produced, if any
    if (!g().explanations.length) {
      // the engine in this build wrote no explanations yet; inject a fixture to exercise the UI path
      act(() =>
        useGame.setState({
          explanations: [
            {
              id: 'fixture-1',
              year: 1,
              season: 'wet',
              topic: 'soil',
              severity: 'warning',
              title: 'Test explanation',
              body: 'Fixture body',
              evidence: [{ label: 'Mean soil health', before: 0.7, after: 0.68 }],
              cells: [cell],
            },
          ],
        }),
      )
    }
    const target = g().explanations[g().explanations.length - 1]
    fireEvent.keyDown(window, { key: '4' })
    const insights = screen.getByRole('dialog', { name: 'Insights' })
    fireEvent.click(within(insights).getAllByRole('button', { name: target.title })[0])
    expect(g().activeExplanationId).toBe(target.id)
    if (target.evidence.length) expect(within(insights).getByText(target.evidence[0].label)).toBeInTheDocument()
    if (target.cells?.length) expect(g().focusCell).toBe(target.cells[0])

    // save, then reload the page (fresh modules) and continue
    fireEvent.click(screen.getByRole('button', { name: 'Save game' }))
    expect(localStorage.getItem(STORAGE_KEYS.save)).not.toBeNull()
    const savedStep = g().sim!.step
    const savedBudget = g().sim!.economy.budget
    const savedCover = Array.from(g().sim!.layers.cover)
    cleanup()
    ;({ useGame } = await mountApp())
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(await screen.findByTestId('game-world', {}, { timeout: 10_000 })).toHaveTextContent(`world step ${savedStep}`)
    expect(g().sim!.economy.budget).toBeCloseTo(savedBudget, 6)
    expect(Array.from(g().sim!.layers.cover)).toEqual(savedCover)
    expect(g().log).toHaveLength(2)

    // compare futures: save A, branch to B from the same start, play differently, compare
    fireEvent.click(screen.getByRole('button', { name: /save as scenario a/i }))
    expect(g().scenarios.A?.endStep).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: /play scenario b/i }))
    await waitFor(() => expect(g().runLabel).toBe('B'))
    expect(g().sim!.step).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Advance one season' }))
    fireEvent.click(screen.getByRole('button', { name: /compare futures/i }))
    expect(await screen.findByRole('heading', { name: 'Two strategies, one valley' })).toBeInTheDocument()
    const checks = screen.getByRole('list', { name: 'Fair comparison checks' })
    expect(within(checks).getByText(/Same weather/)).toBeInTheDocument()
    expect(within(checks).getByText(/Same seed \(4242\)/)).toBeInTheDocument()
    expect(screen.getByTestId('snapshot-Scenario A')).toHaveAttribute('data-sync', 'compare')
    expect(screen.getByTestId('snapshot-Scenario B')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /reveal slider/i }))
    expect(screen.getByLabelText(/Slide to reveal Scenario A/)).toBeInTheDocument()
    expect(screen.getByText('What the numbers say')).toBeInTheDocument()
    // each run's own explanations for the season shown, side by side
    expect(screen.getByRole('heading', { name: /^Why:/ })).toBeInTheDocument()
    expect(screen.getByText('Scenario A', { selector: 'h3' })).toBeInTheDocument()
    expect(screen.getByText('Scenario B', { selector: 'h3' })).toBeInTheDocument()
    // a chart with two lines can compare its second line too (water security)
    const water = screen.getAllByRole('radio', { name: 'Water' })[0]
    fireEvent.click(water)
    expect(screen.getByText('Food and water security: water')).toBeInTheDocument()
    // overlays on the compare screen come with their legend and non-color cue
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'erosion' } })
    expect(screen.getByRole('list', { name: 'Erosion pressure legend' })).toBeInTheDocument()
    expect(screen.getAllByText(/Denser hatching/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /back to scenario b/i }))
    expect(await screen.findByTestId('game-world', {}, { timeout: 10_000 })).toBeInTheDocument()
  })

  test('reaching the horizon opens the report with goals, grounded causes, reflection and Bring It Home', async () => {
    const { useGame } = await mountApp()
    await chooseValley()
    fireEvent.change(screen.getByLabelText('Weather seed'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: /start building/i }))
    await screen.findByTestId('game-world', {}, { timeout: 10_000 })
    const g = () => useGame.getState()
    act(() => {
      g().setTool('cropland')
      g().commitCells([findValidCell(g().sim!, 'cropland')])
    })
    const horizon = g().sim!.horizonYears * 2
    act(() => {
      for (let k = 0; k < horizon && !g().reportOpen; k++) g().stepSeason()
    })
    expect(g().sim!.step).toBe(horizon)
    expect(g().playing).toBe(false)
    const report = screen.getByRole('dialog', { name: `${g().sim!.horizonYears} years in the valley` })
    expect(within(report).getByText('Start to now')).toBeInTheDocument()
    expect(within(report).getByText('Goals')).toBeInTheDocument()
    const { scenarioReport } = await import('../../src/state/objectives')
    if (scenarioReport(g().sim!)?.cumulative) expect(within(report).getByText('Over the whole run')).toBeInTheDocument()
    expect(within(report).getByText(/You made 1 decision and spent/)).toBeInTheDocument()
    expect(within(report).getByText(/planted cropland on 1 parcel \(/)).toBeInTheDocument()
    expect(within(report).getByText('What tradeoff did you run into?')).toBeInTheDocument()
    expect(within(report).getByText('Bring it home')).toBeInTheDocument()
    fireEvent.change(within(report).getByLabelText('What tradeoff did you run into?'), { target: { value: 'Farms versus forest on the slopes' } })
    fireEvent.click(within(report).getByRole('button', { name: 'Keep my notes' }))
    expect(localStorage.getItem(STORAGE_KEYS.reflections)).toContain('Farms versus forest')
    fireEvent.click(within(report).getByRole('button', { name: /keep playing in sandbox/i }))
    expect(screen.queryByRole('dialog', { name: /years in the valley/ })).not.toBeInTheDocument()
    // sandbox continues past the horizon, and the report does not reopen by itself
    fireEvent.click(screen.getByRole('button', { name: 'Advance one season' }))
    expect(g().sim!.step).toBe(horizon + 1)
    expect(g().reportOpen).toBe(false)
    expect(screen.getByRole('button', { name: 'Report' })).toBeInTheDocument()
  }, 60_000)

  test('a damaged save shows a friendly message and can be cleared', async () => {
    localStorage.setItem(STORAGE_KEYS.save, '{"format":"amoria-save","version":1,"worldId":"amoria-valley","seed":1,"step":3,"log":"oops"}')
    const { useGame } = await mountApp()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/damaged/)
    expect(useGame.getState().screen).toBe('landing')
    fireEvent.click(screen.getByRole('button', { name: /delete the damaged save/i }))
    expect(localStorage.getItem(STORAGE_KEYS.save)).toBeNull()
    expect(screen.queryByRole('button', { name: /continue/i })).not.toBeInTheDocument()
  })

  test('without WebGL the valley is a playable flat map: pick a parcel and build from the keyboard', async () => {
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: () => null }
    proto.getContext = () => null
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await chooseValley()
    fireEvent.click(screen.getByRole('button', { name: /start building/i }))
    expect(await screen.findByText(/The 3D valley could not be drawn, so you are playing on a flat map/)).toBeInTheDocument()
    expect(screen.queryByTestId('game-world')).not.toBeInTheDocument()
    const map = screen.getByRole('application', { name: /Flat map of/ })
    // arrows on the flat map move the parcel cursor and select the parcel
    map.focus()
    fireEvent.keyDown(map, { key: 'ArrowRight', code: 'ArrowRight' })
    const first = g().selectedCell
    expect(first).not.toBeNull()
    expect(g().cursorCell).toBe(first)
    expect(screen.getByRole('complementary', { name: 'Parcel inspector' })).toBeInTheDocument()
    // move the cursor onto a parcel that accepts cropland, then build there with Enter
    const target = findValidCell(g().sim!, 'cropland', ['grassland'])
    act(() => useGame.setState({ cursorCell: target, selectedCell: target }))
    fireEvent.keyDown(window, { key: 'c' })
    expect(g().tool).toBe('cropland')
    fireEvent.keyDown(map, { key: 'ArrowLeft', code: 'ArrowLeft' })
    fireEvent.keyDown(map, { key: 'ArrowRight', code: 'ArrowRight' })
    expect(g().cursorCell).toBe(target)
    expect(g().preview?.cells).toEqual([target])
    expect(screen.getByText(/press Enter to build/)).toBeInTheDocument()
    const before = g().sim!.economy.budget
    fireEvent.keyDown(map, { key: 'Enter', code: 'Enter' })
    expect(g().log.map((l) => l.action.type)).toEqual(['cropland'])
    expect(g().sim!.economy.budget).toBeLessThan(before)
    fireEvent.click(screen.getByRole('button', { name: 'Advance one season' }))
    expect(g().sim!.step).toBe(1)
  })

  test('Farming intensity is available from the first season and can intensify a field', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await chooseValley()
    fireEvent.click(screen.getByRole('button', { name: /start building/i }))
    await screen.findByTestId('game-world', {}, { timeout: 10_000 })
    const toolbar = screen.getByRole('navigation', { name: 'Land tools' })
    const btn = within(toolbar).getByRole('button', { name: /^Farming intensity/ })
    await waitFor(() => expect(btn).toBeEnabled())
    expect(btn.getAttribute('aria-label')).not.toMatch(/unavailable/)
    fireEvent.click(btn)
    expect(g().tool).toBe('set-intensity')
    // every starting field is medium, so the tool starts on a level that changes something
    expect(g().toolOptions.intensity).not.toBe('medium')
    fireEvent.click(within(toolbar).getByRole('radio', { name: 'High' }))
    expect(g().toolOptions.intensity).toBe('high')
    expect(within(toolbar).getByText(/medium, 0 high/)).toBeInTheDocument()
    const sim = g().sim!
    const field = Array.from(sim.layers.cover).findIndex((c, i) => c === 2 && sim.terrain.protected[i] === 0)
    expect(field).toBeGreaterThanOrEqual(0)
    act(() => g().commitCells([field]))
    expect(g().sim!.layers.intensity[field]).toBe(2)
    // the inspector lists all three levels for a field, with the current one marked
    act(() => g().selectCell(field))
    const inspector = screen.getByRole('complementary', { name: 'Parcel inspector' })
    expect(within(inspector).getByText('Current level')).toBeInTheDocument()
    expect(within(inspector).getByRole('button', { name: /^Low intensity here for/ })).toBeInTheDocument()
    expect(within(inspector).getByRole('button', { name: /^Medium intensity here for/ })).toBeInTheDocument()
  })

  test('keyboard parcel cursor: Shift+arrows select and preview, Enter builds, Escape clears', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await chooseValley()
    fireEvent.click(screen.getByRole('button', { name: /start building/i }))
    await screen.findByTestId('game-world', {}, { timeout: 10_000 })
    fireEvent.keyDown(document.body, { key: 'ArrowRight', code: 'ArrowRight', shiftKey: true })
    const start = g().cursorCell!
    expect(start).not.toBeNull()
    expect(g().selectedCell).toBe(start)
    expect(g().focusCell).toBe(start)
    const w = g().sim!.terrain.width
    fireEvent.keyDown(document.body, { key: 'ArrowDown', code: 'ArrowDown', shiftKey: true })
    expect(g().cursorCell).toBe(start + w)
    const status = screen.getAllByRole('status').find((el) => /Parcel \d+, \d+/.test(el.textContent ?? ''))
    expect(status?.textContent).toMatch(new RegExp(`Parcel ${(start + w) % w}, ${Math.floor((start + w) / w)}`))
    // pick a valid housing parcel and build there with Enter
    const target = findValidCell(g().sim!, 'housing')
    act(() => useGame.setState({ cursorCell: target }))
    fireEvent.keyDown(window, { key: 'h' })
    expect(g().preview?.cells).toEqual([target])
    const budget = g().sim!.economy.budget
    fireEvent.keyDown(document.body, { key: 'Enter', code: 'Enter' })
    expect(g().log.at(-1)?.action.type).toBe('housing')
    expect(g().sim!.economy.budget).toBeLessThan(budget)
    // Enter on a button the player focused after using the cursor presses that button (a cursor move takes focus back)
    const logLength = g().log.length
    const season = screen.getByRole('button', { name: 'Advance one season' })
    fireEvent.keyDown(season, { key: 'Enter', code: 'Enter' })
    expect(g().log).toHaveLength(logLength)
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' })
    expect(g().cursorCell).toBeNull()
    expect(g().preview).toBeNull()
    // the controls help lists the keys
    fireEvent.keyDown(window, { key: '?' })
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Settings and help' })).getByRole('tab', { name: 'How to play' }))
    expect(screen.getByText('Shift + arrows')).toBeInTheDocument()
  })

  test('history: decision markers are labelled buttons and the past banner lists that season', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await chooseValley()
    fireEvent.click(screen.getByRole('button', { name: /start building/i }))
    await screen.findByTestId('game-world', {}, { timeout: 10_000 })
    act(() => {
      g().setTool('housing')
      g().commitCells([findValidCell(g().sim!, 'housing')])
      g().stepSeason()
      g().stepSeason()
    })
    const markers = screen.getByRole('list', { name: 'Your decisions' })
    const marker = within(markers).getByRole('button', { name: /^Year 1 wet: built housing on 1 parcel for \$/ })
    fireEvent.click(marker)
    expect(g().viewStep).toBe(1)
    const banner = screen.getByRole('region', { name: 'Viewing the past' })
    expect(banner).toHaveTextContent(/Viewing the past: after year 1, wet season/)
    expect(within(banner).getByText(/Built housing on 1 parcel for \$/)).toBeInTheDocument()
    fireEvent.click(within(banner).getByRole('button', { name: 'Show on map' }))
    expect(g().focusCell).toBe(g().sim!.decisions[0].action.type === 'housing' ? (g().sim!.decisions[0].action as { cells: number[] }).cells[0] : -1)
    const scrubber = screen.getByLabelText(/History: drag to look at earlier seasons/)
    expect(scrubber.getAttribute('aria-valuetext')).toMatch(/After year 1, wet season.*viewing the past/)
    // insights follow the season being viewed
    fireEvent.click(within(banner).getByRole('button', { name: /Insights for this season/ }))
    expect(screen.getByRole('dialog', { name: 'Insights' })).toHaveTextContent(/season you are viewing/)
  })

  test('the end report traps focus and gives it back when closed', async () => {
    const { useGame } = await mountApp()
    const g = () => useGame.getState()
    await chooseValley()
    fireEvent.click(screen.getByRole('button', { name: /start building/i }))
    await screen.findByTestId('game-world', {}, { timeout: 10_000 })
    const season = screen.getByRole('button', { name: 'Advance one season' })
    season.focus()
    act(() => {
      while (!g().reportOpen) g().stepSeason()
    })
    const report = screen.getByRole('dialog', { name: /years in the valley/ })
    expect(document.activeElement).toBe(report)
    expect(screen.getByRole('region', { name: 'Timeline', hidden: true }).closest('[inert]')).not.toBeNull()
    const buttons = within(report).getAllByRole('button')
    buttons[buttons.length - 1].focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(report.contains(document.activeElement)).toBe(true)
    fireEvent.click(within(report).getByRole('button', { name: /keep playing in sandbox/i }))
    expect(document.querySelector('[inert]')).toBeNull()
    expect(document.activeElement).toBe(season)
  }, 60_000)

  test('metric tooltips explain what each number is', async () => {
    await mountApp()
    await chooseValley()
    fireEvent.click(screen.getByRole('button', { name: /start building/i }))
    await screen.findByTestId('game-world', {}, { timeout: 10_000 })
    const food = screen.getByRole('button', { name: /^Food security:/ })
    const tipId = food.getAttribute('aria-describedby')!
    const tip = document.getElementById(tipId)!
    expect(tip).toHaveTextContent('How it is calculated')
    expect(tip).toHaveTextContent('Derived indicator')
    const land = screen.getByRole('button', { name: /^Land health:/ })
    expect(document.getElementById(land.getAttribute('aria-describedby')!)).toHaveTextContent('Illustrative model output')
  })

  test('settings: colorblind palette and reduced motion apply to the page and persist', async () => {
    const { useGame } = await mountApp()
    await chooseValley()
    fireEvent.click(screen.getByRole('button', { name: /start building/i }))
    await screen.findByTestId('game-world', {}, { timeout: 10_000 })
    fireEvent.keyDown(window, { key: '?' })
    const dlg = screen.getByRole('dialog', { name: 'Settings and help' })
    fireEvent.click(within(dlg).getByLabelText(/Colorblind-friendly colors/))
    fireEvent.click(within(dlg).getByLabelText(/Reduce motion/))
    expect(document.documentElement.dataset.colorblind).toBe('true')
    expect(useGame.getState().reducedMotion).toBe(!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.settings)!)).toMatchObject({ colorblind: true })
    fireEvent.click(within(dlg).getByRole('tab', { name: 'How to play' }))
    expect(within(dlg).getByText('Advance one season')).toBeInTheDocument()
  })

  test('a real-data world is offered, labelled truthfully, and shows its attribution in game', async () => {
    const { readFile } = await import('node:fs/promises')
    const { REAL_WORLDS } = await import('../../src/data/realWorlds.generated')
    if (!REAL_WORLDS.length) return
    // serve public/world-data from disk, as the static host would
    vi.stubGlobal('fetch', async (url: string) => {
      const file = decodeURIComponent(String(url).split('/world-data/')[1] ?? '')
      const text = await readFile(new URL(`../../public/world-data/${file}`, import.meta.url), 'utf8')
      return new Response(text, { status: 200 })
    })
    const { useGame } = await mountApp()
    const real = REAL_WORLDS[0].meta
    const radio = await screen.findByRole('radio', { name: new RegExp(real.name.replace(/[()]/g, '.')) })
    expect(radio).toBeChecked()
    expect(screen.getByText('Built from real map data')).toBeInTheDocument()
    expect(screen.getByText('Fictional valley')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /start building/i }))
    expect(await screen.findByTestId('game-world', {}, { timeout: 10_000 })).toBeInTheDocument()
    expect(useGame.getState().worldId).toBe(real.id)
    expect(useGame.getState().sim!.meta.kind).toBe('real-data-derived')
    const notes = (useGame.getState().world as { details?: { attribution?: string[] } }).details
    // the credits stay off the game screen and live in Settings and help, About the model, This world
    expect(screen.queryByTestId('map-credits')).not.toBeInTheDocument()
    if (notes?.attribution?.length) {
      act(() => useGame.getState().openPanel('settings'))
      const settings = screen.getByRole('dialog', { name: 'Settings and help' })
      fireEvent.click(within(settings).getByRole('tab', { name: 'About the model' }))
      expect(within(settings).getByText(new RegExp(notes.attribution[0].slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument()
      act(() => useGame.getState().openPanel(null))
    }
    // the inspector shows the observed land cover next to the game's adjusted start, and says why they differ
    const { worldCellData } = await import('../../src/state/worlds')
    const { observedCover } = worldCellData(useGame.getState().world)
    const sim = useGame.getState().sim!
    if (observedCover) {
      const differs = Array.from(observedCover).findIndex((c, i) => c !== sim.layers.baselineCover[i])
      expect(differs).toBeGreaterThanOrEqual(0)
      act(() => useGame.getState().selectCell(differs))
      const inspector = screen.getByRole('complementary', { name: 'Parcel inspector' })
      expect(within(inspector).getByText(/^Observed, as a game class \(ESA WorldCover/)).toBeInTheDocument()
      expect(within(inspector).getByText('At the start of the game')).toBeInTheDocument()
      expect(within(inspector).getByText(/Why the game differs from the observation/)).toBeInTheDocument()
      expect(within(inspector).getAllByRole('button', { name: /^Observed elevation, derived slope:/ }).length).toBeGreaterThan(0)
      expect(within(inspector).queryByText(/At the start \(observed\)/)).not.toBeInTheDocument()
    }
  })
})
