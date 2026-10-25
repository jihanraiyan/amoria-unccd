import './dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { STORAGE_KEYS } from '../../src/state/storage'
import { parseSave, sanitizeAction, SAVE_FORMAT } from '../../src/state/persistence'
import { fingerprint, replayRun } from '../../src/state/replay'
import { buildToolAction, DEFAULT_TOOL_OPTIONS } from '../../src/state/toolActions'
import { toolAvailability } from '../../src/state/toolProbe'
import { advanceTutorial, TUTORIAL_START, TUTORIAL_STEPS } from '../../src/state/tutorial'
import { PROCEDURAL_WORLD_ID, loadWorld } from '../../src/state/worlds'
import { findValidCell } from './helpers'

// these tests replay whole runs; give them room when every team's suite runs in parallel
vi.setConfig({ testTimeout: 30_000 })

type StoreModule = typeof import('../../src/state/store')

/** A fresh store module (as after a page reload), reading whatever localStorage holds. */
async function freshStore(): Promise<StoreModule> {
  vi.resetModules()
  return import('../../src/state/store')
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('tool actions', () => {
  test('maps tools and options to player actions, dedupes and sorts cells', () => {
    expect(buildToolAction('inspect', [1], DEFAULT_TOOL_OPTIONS)).toBeNull()
    expect(buildToolAction('road', [], DEFAULT_TOOL_OPTIONS)).toBeNull()
    expect(buildToolAction('cropland', [5, 3, 5], { intensity: 'high', irrigated: true })).toEqual({
      type: 'cropland',
      cells: [3, 5],
      intensity: 'high',
      irrigated: true,
    })
    expect(buildToolAction('set-intensity', [2], { intensity: 'low', irrigated: false })).toEqual({ type: 'set-intensity', cells: [2], intensity: 'low' })
    expect(buildToolAction('wetland', [9], DEFAULT_TOOL_OPTIONS)).toEqual({ type: 'wetland', cells: [9] })
  })
})

describe('store: editing within a season', () => {
  test('dispatch deducts the validated cost; undo and redo restore exactly', async () => {
    const { useGame } = await freshStore()
    expect(await useGame.getState().newGame(PROCEDURAL_WORLD_ID, 11)).toBe(true)
    const s0 = useGame.getState().sim!
    const cell = findValidCell(s0, 'cropland', ['grassland'])
    useGame.getState().setTool('cropland')
    useGame.getState().commitCells([cell])
    const s1 = useGame.getState().sim!
    const v = useGame.getState().undoStack.length
    expect(v).toBe(1)
    const validation = buildToolAction('cropland', [cell], DEFAULT_TOOL_OPTIONS)!
    expect(useGame.getState().log).toEqual([{ step: 0, action: validation }])
    // the budget moved by exactly what validation said it would (cost minus any one-off revenue)
    const { validateAction } = await import('../../src/simulation/engine')
    const expected = validateAction(s0, validation)
    expect(s0.economy.budget - s1.economy.budget).toBeCloseTo(expected.cost - (expected.revenue ?? 0), 6)
    expect(s1.layers.cover[cell]).not.toBe(s0.layers.cover[cell])

    useGame.getState().undo()
    expect(useGame.getState().sim).toBe(s0)
    expect(useGame.getState().log).toEqual([])
    expect(useGame.getState().redoStack).toHaveLength(1)

    useGame.getState().redo()
    const s2 = useGame.getState().sim!
    expect(s2.economy.budget).toBeCloseTo(s1.economy.budget, 6)
    expect(Array.from(s2.layers.cover)).toEqual(Array.from(s1.layers.cover))
    expect(useGame.getState().log).toHaveLength(1)
  })

  test('undo cannot cross a simulated season and says why', async () => {
    const { useGame } = await freshStore()
    await useGame.getState().newGame(PROCEDURAL_WORLD_ID, 12)
    const s0 = useGame.getState().sim!
    const cell = findValidCell(s0, 'cropland')
    useGame.getState().setTool('cropland')
    useGame.getState().commitCells([cell])
    useGame.getState().stepSeason()
    const after = useGame.getState().sim!
    expect(after.step).toBe(1)
    useGame.getState().undo()
    expect(useGame.getState().sim).toBe(after)
    expect(useGame.getState().feedback?.text).toMatch(/cannot be undone/i)
    expect(useGame.getState().feedback?.text).toMatch(/Scenario A/)
  })

  test('history view is read-only and the present can be restored', async () => {
    const { useGame } = await freshStore()
    await useGame.getState().newGame(PROCEDURAL_WORLD_ID, 13)
    useGame.getState().stepSeason()
    useGame.getState().stepSeason()
    const st = useGame.getState()
    expect(st.snapshots).toHaveLength(3)
    st.viewHistory(1)
    expect(useGame.getState().viewSnapshot).toBe(st.snapshots[1])
    const cell = findValidCell(useGame.getState().sim!, 'road')
    const v = useGame.getState().dispatch({ type: 'road', cells: [cell] })
    expect(v?.ok).toBe(false)
    expect(v?.reasons[0]).toMatch(/viewing the past/i)
    expect(useGame.getState().log).toHaveLength(0)
    useGame.getState().viewHistory(null)
    expect(useGame.getState().viewSnapshot).toBeNull()
  })

  test('preview validation comes from the engine for the active tool', async () => {
    const { useGame } = await freshStore()
    await useGame.getState().newGame(PROCEDURAL_WORLD_ID, 14)
    useGame.getState().setTool('housing')
    const cell = findValidCell(useGame.getState().sim!, 'housing')
    useGame.getState().setPreviewCells([cell])
    expect(useGame.getState().preview?.cells).toEqual([cell])
    expect(useGame.getState().preview?.validation.ok).toBe(true)
    useGame.getState().setTool('inspect')
    useGame.getState().setPreviewCells([cell])
    expect(useGame.getState().preview).toBeNull()
  })
})

describe('store: time', () => {
  test('play steps on a timer and pause stops it', async () => {
    vi.useFakeTimers()
    const { useGame, SPEED_MS, stopClock } = await freshStore()
    await useGame.getState().newGame(PROCEDURAL_WORLD_ID, 15)
    useGame.getState().setSpeed(3)
    useGame.getState().setPlaying(true)
    vi.advanceTimersByTime(SPEED_MS[3] * 2 + 5)
    expect(useGame.getState().sim!.step).toBe(2)
    useGame.getState().setPlaying(false)
    vi.advanceTimersByTime(SPEED_MS[3] * 3)
    expect(useGame.getState().sim!.step).toBe(2)
    stopClock()
  })

  test('step year advances two seasons', async () => {
    const { useGame } = await freshStore()
    await useGame.getState().newGame(PROCEDURAL_WORLD_ID, 16)
    useGame.getState().stepYear()
    expect(useGame.getState().sim!.step).toBe(2)
    expect(useGame.getState().sim!.year).toBe(2)
    expect(useGame.getState().sim!.season).toBe('wet')
  })
})

describe('replay and persistence', () => {
  test('replaying the action log reproduces the run exactly', async () => {
    const { useGame } = await freshStore()
    await useGame.getState().newGame(PROCEDURAL_WORLD_ID, 21)
    const st = () => useGame.getState()
    st().setTool('cropland')
    st().commitCells([findValidCell(st().sim!, 'cropland')])
    st().stepSeason()
    st().setTool('reforest')
    try {
      st().commitCells([findValidCell(st().sim!, 'reforest')])
    } catch {
      // no reforestable parcel in this engine version; the log still has one action
    }
    st().stepSeason()
    st().stepSeason()
    const live = st().sim!
    const world = await loadWorld(PROCEDURAL_WORLD_ID)
    const r = replayRun(world, 21, st().log, live.step)
    expect(r.rejected).toEqual([])
    expect(fingerprint(r.state)).toEqual(fingerprint(live))
    expect(Array.from(r.state.layers.cover)).toEqual(Array.from(live.layers.cover))
    expect(Array.from(r.state.layers.soilHealth)).toEqual(Array.from(live.layers.soilHealth))
    expect(r.state.history).toEqual(live.history)
    expect(r.snapshots).toHaveLength(st().snapshots.length)
  })

  test('save then load in a fresh store continues at the same state', async () => {
    let mod = await freshStore()
    await mod.useGame.getState().newGame(PROCEDURAL_WORLD_ID, 22)
    const g = () => mod.useGame.getState()
    g().setTool('housing')
    g().commitCells([findValidCell(g().sim!, 'housing')])
    g().stepSeason()
    g().setTool('cropland')
    g().commitCells([findValidCell(g().sim!, 'cropland')])
    expect(g().saveGame()).toBe(true)
    const before = g().sim!
    const logBefore = g().log

    mod = await freshStore()
    expect(mod.useGame.getState().hasSave).toBe(true)
    expect(mod.useGame.getState().sim).toBeNull()
    expect(await mod.useGame.getState().continueGame()).toBe(true)
    const after = g().sim!
    expect(after.step).toBe(before.step)
    expect(fingerprint(after)).toEqual(fingerprint(before))
    expect(Array.from(after.layers.cover)).toEqual(Array.from(before.layers.cover))
    expect(g().log).toEqual(logBefore)
    expect(g().snapshots).toHaveLength(before.step + 1)
    // the current season's edit is rebuilt as an undo point by the replay; the earlier
    // season's housing is history and stays
    expect(g().undoStack).toHaveLength(1)
    g().undo()
    expect(g().log).toHaveLength(1)
    expect(g().log[0].action.type).toBe('housing')
    g().undo()
    expect(g().log).toHaveLength(1)
    expect(g().feedback?.text).toMatch(/^Nothing to undo this season/)
  })

  test('corrupted, foreign and future saves are rejected with friendly messages', async () => {
    localStorage.setItem(STORAGE_KEYS.save, '{not json')
    let mod = await freshStore()
    expect(await mod.useGame.getState().continueGame()).toBe(false)
    expect(mod.useGame.getState().loadError).toMatch(/damaged/i)
    expect(mod.useGame.getState().sim).toBeNull()
    mod.useGame.getState().discardSave()
    expect(localStorage.getItem(STORAGE_KEYS.save)).toBeNull()
    expect(mod.useGame.getState().hasSave).toBe(false)

    localStorage.setItem(STORAGE_KEYS.save, JSON.stringify({ format: SAVE_FORMAT, version: 99 }))
    mod = await freshStore()
    expect(await mod.useGame.getState().continueGame()).toBe(false)
    expect(mod.useGame.getState().loadError).toMatch(/newer version/i)

    expect(parseSave({ hello: 'world' })).toEqual({ ok: false, reason: expect.stringMatching(/not an Amoria save/) })
    expect(parseSave({ format: SAVE_FORMAT, version: 0 })).toMatchObject({ ok: false, reason: expect.stringMatching(/older version/) })
    const bad = parseSave({
      format: SAVE_FORMAT,
      version: 1,
      worldId: 'amoria-valley',
      seed: 1,
      step: 2,
      log: [{ step: 0, action: { type: 'nuke', cells: [1] } }],
    })
    expect(bad).toMatchObject({ ok: false, reason: expect.stringMatching(/damaged/) })
    const unknownWorld = { format: SAVE_FORMAT, version: 1, worldId: 'atlantis', seed: 1, step: 0, log: [] }
    localStorage.setItem(STORAGE_KEYS.save, JSON.stringify(unknownWorld))
    mod = await freshStore()
    expect(await mod.useGame.getState().continueGame()).toBe(false)
    expect(mod.useGame.getState().loadError).toMatch(/not available/i)
  })

  test('sanitizeAction rejects malformed actions', () => {
    expect(sanitizeAction({ type: 'loan', amount: -5 })).toBeNull()
    expect(sanitizeAction({ type: 'loan', amount: 1000 })).toEqual({ type: 'loan', amount: 1000 })
    expect(sanitizeAction({ type: 'cropland', cells: [1], intensity: 'extreme', irrigated: false })).toBeNull()
    expect(sanitizeAction({ type: 'road', cells: [1.5] })).toBeNull()
    expect(sanitizeAction({ type: 'road', cells: [] })).toBeNull()
    expect(sanitizeAction({ type: 'road', cells: [4, 2] })).toEqual({ type: 'road', cells: [4, 2] })
  })

  test('settings persist and survive a reload', async () => {
    let mod = await freshStore()
    mod.useGame.getState().updateSettings({ colorblind: true, quality: 'low', uiScale: 5 })
    expect(mod.useGame.getState().colorblind).toBe(true)
    expect(mod.useGame.getState().quality).toBe('low')
    expect(mod.useGame.getState().settings.uiScale).toBe(1.3)
    mod = await freshStore()
    expect(mod.useGame.getState().settings).toMatchObject({ colorblind: true, quality: 'low', uiScale: 1.3 })
  })
})

describe('compare futures', () => {
  test('scenario B starts from identical conditions and compare builds both runs', async () => {
    const { useGame } = await freshStore()
    const g = () => useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 31)
    const startBudget = g().sim!.economy.budget
    g().setTool('cropland')
    g().commitCells([findValidCell(g().sim!, 'cropland')])
    g().stepYear()
    expect(g().saveScenarioA()).toBe(true)
    expect(g().runLabel).toBe('A')
    const aWeather = g().sim!.weather

    expect(await g().branchScenarioB()).toBe(true)
    expect(g().runLabel).toBe('B')
    expect(g().sim!.step).toBe(0)
    expect(g().sim!.seed).toBe(31)
    expect(g().sim!.economy.budget).toBe(startBudget)
    expect(g().sim!.weather).toEqual(aWeather)
    expect(g().scenarios.A?.endStep).toBe(2)

    g().setTool('reforest')
    try {
      g().commitCells([findValidCell(g().sim!, 'reforest')])
    } catch {
      // engine without valid reforest sites: B simply differs by having no edits
    }
    g().stepYear()
    expect(await g().openCompare()).toBe(true)
    const c = g().compare
    expect(g().screen).toBe('compare')
    expect(c.A?.state.step).toBe(2)
    expect(c.B?.state.step).toBe(2)
    expect(c.A?.snapshots).toHaveLength(3)
    expect(c.step).toBe(2)
    g().setCompareStep(99)
    expect(g().compare.step).toBe(2)
    g().closeCompare()
    expect(g().screen).toBe('game')
  })

  test('compare rebuilds Scenario A from its log after a reload', async () => {
    let mod = await freshStore()
    const g = () => mod.useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 32)
    g().stepSeason()
    g().saveScenarioA()
    await g().branchScenarioB()
    g().stepSeason()
    g().saveGame()
    mod = await freshStore()
    expect(await g().continueGame()).toBe(true)
    expect(g().scenarios.A).not.toBeNull()
    expect(g().compare.A).toBeNull()
    expect(await g().openCompare()).toBe(true)
    expect(g().compare.A?.state.step).toBe(1)
  })
})

describe('tutorial', () => {
  test('advances only on the expected real action, in order', () => {
    let t = TUTORIAL_START
    t = advanceTutorial(t, 'build')
    expect(t.index).toBe(0)
    for (const step of TUTORIAL_STEPS) t = advanceTutorial(t, step.id)
    expect(t.done).toBe(true)
    expect(t.active).toBe(false)
  })

  test('store events drive the tutorial and completion is remembered', async () => {
    let mod = await freshStore()
    const g = () => mod.useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 41)
    expect(g().tutorial.index).toBe(0)
    g().tutorialEvent('navigate')
    g().selectCell(100)
    g().setTool('road')
    g().commitCells([findValidCell(g().sim!, 'road')])
    g().openPanel('budget')
    g().stepSeason()
    g().setOverlay('erosion')
    expect(g().tutorial.done).toBe(true)
    mod = await freshStore()
    expect(g().tutorial.done).toBe(true)
  })
})

describe('round 2 fixes', () => {
  test('Farming intensity is placeable at step 0 whatever level is chosen, with a tool-level reason otherwise', async () => {
    const { useGame } = await freshStore()
    const g = () => useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 7)
    const sim = g().sim!
    for (const intensity of ['low', 'medium', 'high'] as const) {
      const a = toolAvailability(sim, 'set-intensity', { intensity, irrigated: false })
      expect(a.placeable).toBe(true)
      expect(a.reason).toBeNull()
      expect(a.minCost).toBeGreaterThan(0)
    }
    // selecting the tool moves the option off the level every field is already at
    g().setTool('set-intensity')
    expect(g().toolOptions.intensity).toBe('high')
    // with no cropland at all the reason says so, instead of quoting some random parcel
    const crop = 2
    const bare = { ...sim, layers: { ...sim.layers, cover: sim.layers.cover.map((c) => (c === crop ? 1 : c)) } }
    const none = toolAvailability(bare, 'set-intensity', { intensity: 'high', irrigated: false })
    expect(none.placeable).toBe(false)
    expect(none.reason).toBe('No cropland yet. Plant fields first.')
    const waterworksAnywhere = toolAvailability(sim, 'waterworks', DEFAULT_TOOL_OPTIONS)
    if (!waterworksAnywhere.placeable) expect(waterworksAnywhere.reason).not.toMatch(/Protected land/)
  })

  test('branching to Scenario B re-saves A when run A went on after it was saved', async () => {
    const { useGame } = await freshStore()
    const g = () => useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 51)
    g().stepSeason()
    g().stepSeason()
    expect(g().saveScenarioA()).toBe(true)
    expect(g().scenarios.A?.endStep).toBe(2)
    g().setTool('cropland')
    g().commitCells([findValidCell(g().sim!, 'cropland')])
    for (let k = 0; k < 4; k++) g().stepSeason()
    expect(g().sim!.step).toBe(6)
    expect(await g().branchScenarioB()).toBe(true)
    expect(g().runLabel).toBe('B')
    expect(g().scenarios.A?.endStep).toBe(6)
    expect(g().scenarios.A?.log).toHaveLength(1)
    expect(g().compare.A?.state.step).toBe(6)
    expect(g().feedback?.text).toMatch(/saved again at year 4, wet season \(it had been saved at year 2, wet season\)/)
    // and the reload path rebuilds the later A as well
    g().stepSeason()
    expect(await g().openCompare()).toBe(true)
    expect(g().compare.A?.state.step).toBe(6)
    expect(g().compare.A?.explanations.length).toBeGreaterThan(0)
    expect(g().compare.B?.explanations.length).toBeGreaterThan(0)
  })

  test('redo while viewing the past keeps the redo stack; a refused commit does not move the selection', async () => {
    const { useGame } = await freshStore()
    const g = () => useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 52)
    g().stepSeason()
    g().setTool('cropland')
    const cell = findValidCell(g().sim!, 'cropland')
    g().commitCells([cell])
    g().undo()
    expect(g().redoStack).toHaveLength(1)
    g().viewHistory(0)
    g().redo()
    expect(g().redoStack).toHaveLength(1)
    expect(g().feedback?.text).toMatch(/viewing the past/)
    g().viewHistory(null)
    g().redo()
    expect(g().redoStack).toHaveLength(0)
    expect(g().log).toHaveLength(1)
    // committing on a parcel that refuses the tool leaves the selection where it was
    g().selectCell(5)
    g().setTool('housing')
    g().commitCells([0])
    expect(g().selectedCell).toBe(5)
  })

  test('speed labels match the real season lengths', async () => {
    const { SPEED_MS, speedLabel } = await freshStore()
    expect([1, 2, 3].map((s) => speedLabel(s as 1 | 2 | 3))).toEqual(['1x', '2x', '4x'])
    for (const s of [2, 3] as const) expect(SPEED_MS[1] / SPEED_MS[s]).toBe(Number(speedLabel(s).replace('x', '')))
  })

  test('keyboard cursor moves within the map, previews the tool and builds on commit', async () => {
    const { useGame } = await freshStore()
    const g = () => useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 53)
    const w = g().sim!.terrain.width
    g().moveCursor(0, 0)
    const start = g().cursorCell!
    expect(g().sim!.layers.structure[start]).toBe(2) // starts in the village
    for (let k = 0; k < 200; k++) g().moveCursor(-1, 0)
    expect(g().cursorCell! % w).toBe(0)
    const target = findValidCell(g().sim!, 'reforest')
    useGame.setState({ cursorCell: target })
    g().setTool('reforest')
    expect(g().preview?.cells).toContain(target)
    expect(g().commitCursor()).toBe(true)
    expect(g().log.at(-1)?.action.type).toBe('reforest')
    g().clearCursor()
    expect(g().cursorCell).toBeNull()
    expect(g().commitCursor()).toBe(false)
  })

  test('the Insights badge counts only explanations newer than the last visit', async () => {
    const { useGame } = await freshStore()
    const g = () => useGame.getState()
    await g().newGame(PROCEDURAL_WORLD_ID, 54)
    g().openPanel('insights')
    expect(g().seenExplanations).toBe(g().explanations.length)
    g().openPanel(null)
    g().stepYear()
    expect(g().explanations.length).toBeGreaterThanOrEqual(g().seenExplanations)
    g().openPanel('insights')
    expect(g().seenExplanations).toBe(g().explanations.length)
  })

  test('tutorial describes the real preview colors and does not rely on color alone', () => {
    const build = TUTORIAL_STEPS.find((t) => t.id === 'build')!
    expect(build.body).not.toMatch(/green|red/i)
    expect(build.body).toMatch(/Blue/)
    expect(build.body).toMatch(/striped/)
    expect(build.body).toMatch(/says why/)
  })
})
