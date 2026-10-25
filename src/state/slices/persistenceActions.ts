// Starting, continuing (deterministic replay of the saved action log), resetting and leaving a run.
import { createInitialState } from '../../simulation/engine'
import type { SimulationState, WorldInput } from '../../simulation/types'
import { deleteSave, readSave } from '../persistence'
import { skippedDecisions } from '../messages'
import { fingerprint, replayRunAsync, snapshotOf } from '../replay'
import type { GameStore, LoadErrorKind } from '../storeTypes'
import { TUTORIAL_OFF, TUTORIAL_START } from '../tutorial'
import { loadWorld } from '../worlds'
import type { StoreCtx } from './context'
import { clearTimer, friendlyError, newRunId, randomSeed, readTutorialDone } from './runtime'

let exitWarnId: number | null = null

export function persistenceActions(ctx: StoreCtx) {
  const { set, get, notify, saveGame, installRun } = ctx
  return {
    newGame: async (worldId, seed, opts) => {
      const useSeed = seed ?? randomSeed()
      set({ busy: true, loadError: null, loadErrorKind: null })
      // On the title screen the error shows there; in a game (reset, branch) it goes to the feedback line
      const fail = (kind: LoadErrorKind, message: string) => {
        set({ busy: false, loadError: message, loadErrorKind: kind })
        if (get().screen !== 'landing') notify('error', message)
        return false
      }
      let world: WorldInput
      try {
        world = await loadWorld(worldId)
      } catch (e) {
        return fail('world', friendlyError(e, 'That world could not be loaded.'))
      }
      let state: SimulationState
      try {
        state = createInitialState(world, useSeed)
      } catch (e) {
        return fail('engine', `The simulation could not start: ${e instanceof Error ? e.message : 'unknown error'}.`)
      }
      const prev = get()
      installRun(world, worldId, useSeed, state, [snapshotOf(state)], [], state.explanations ?? [], {
        runId: newRunId(),
        runLabel: opts?.runLabel ?? null,
        scenarios: opts?.keepScenarios ? prev.scenarios : { A: null, B: null },
        tutorial: prev.tutorial.done ? TUTORIAL_OFF : TUTORIAL_START,
      })
      saveGame({ silent: true })
      return true
    },

    continueGame: async () => {
      const parsed = readSave()
      if (!parsed.ok) {
        set({ loadError: parsed.reason, loadErrorKind: 'save' })
        return false
      }
      const save = parsed.save
      set({ busy: true, loadError: null, loadErrorKind: null })
      let world: WorldInput
      try {
        world = await loadWorld(save.worldId)
      } catch (e) {
        set({ busy: false, loadError: friendlyError(e, 'The saved world could not be loaded.'), loadErrorKind: 'world' })
        return false
      }
      let replay: Awaited<ReturnType<typeof replayRunAsync>>
      try {
        // replaying in slices lets "Preparing the valley..." paint and the page stay responsive
        set({ loadProgress: { done: 0, total: save.step } })
        replay = await replayRunAsync(world, save.seed, save.log, save.step, (done, total) => set({ loadProgress: { done, total } }))
      } catch (e) {
        set({ busy: false, loadError: `The saved game could not be rebuilt: ${e instanceof Error ? e.message : 'unknown error'}.`, loadErrorKind: 'save' })
        return false
      } finally {
        set({ loadProgress: null })
      }
      const fp = fingerprint(replay.state)
      const matches =
        fp.step === save.fingerprint.step &&
        fp.budget === save.fingerprint.budget &&
        fp.debt === save.fingerprint.debt &&
        fp.population === save.fingerprint.population
      const log = save.log.filter((_, i) => !replay.rejected.some((r) => r.index === i))
      installRun(world, save.worldId, save.seed, replay.state, replay.snapshots, log, replay.explanations, {
        // edits made earlier in the current season can still be undone after a reload
        undoStack: replay.undoStack,
        // older saves had no run id: key them as reflections used to be keyed, so their notes stay
        runId: save.runId ?? `${save.worldId}:${save.seed}:${save.runLabel ?? 'run'}`,
        runLabel: save.runLabel,
        scenarios: save.scenarios,
        reportShown: save.reportShown,
        tutorial: save.tutorialDone || readTutorialDone() ? TUTORIAL_OFF : get().tutorial,
        lastSavedAt: save.savedAt || null,
        seenExplanations: replay.explanations.length,
      })
      if (replay.rejected.length) {
        notify('warning', `Loaded, but ${skippedDecisions(replay.rejected.length)} no longer allowed by this version of the model and ${replay.rejected.length === 1 ? 'was' : 'were'} skipped.`)
      } else if (!matches) {
        notify('warning', 'Loaded. This save was made with a slightly different version of the model, so some numbers may differ from when you saved.')
      } else {
        notify('ok', `Welcome back. Year ${replay.state.year}, ${replay.state.season} season.`)
      }
      return true
    },

    resetRun: async () => {
      const s = get()
      if (!s.worldId) return false
      // Resetting run A starts a new run: the saved Scenario A stays as it was and is no longer
      // the run being played, so branching B later starts from A's save, not from this reset run.
      const wasA = s.runLabel === 'A' && !!s.scenarios.A
      const cachedA = s.compare.A
      const ok = await get().newGame(s.worldId, s.seed, { runLabel: wasA ? null : s.runLabel, keepScenarios: true })
      if (!ok) return false
      if (cachedA) set({ compare: { ...get().compare, A: cachedA } })
      if (wasA) {
        notify('info', 'Started again from the same valley, budget and weather. Scenario A is still saved as it was: play a new run here, or branch to Scenario B from A.')
      } else if (s.runLabel === 'B') {
        notify('info', 'Scenario B reset to the same starting conditions as Scenario A: same valley, budget and weather.')
      } else {
        notify('info', 'Scenario reset to its starting conditions: same valley, budget and weather.')
      }
      return true
    },

    exitToLanding: () => {
      const s = get()
      if (s.sim && !saveGame({ silent: true })) {
        // leaving now would lose the run; the second press (while this warning shows) leaves anyway
        if (exitWarnId === null || s.feedback?.id !== exitWarnId) {
          set({ playing: false })
          clearTimer()
          notify('error', 'This browser would not save your game (storage may be full or disabled), so you are still here. Leaving now loses this run. Press Exit again to leave anyway.')
          exitWarnId = get().feedback?.id ?? null
          return
        }
      }
      exitWarnId = null
      clearTimer()
      set({ screen: 'landing', playing: false, panel: null, preview: null, viewSnapshot: null, viewStep: null })
    },

    discardSave: () => {
      deleteSave()
      set({ hasSave: false, loadError: null, loadErrorKind: null })
    },

    dismissLoadError: () => set({ loadError: null, loadErrorKind: null }),
  } satisfies Partial<GameStore>
}
