// The store's shared internals: feedback, tutorial progress, saving, installing a run, the play
// clock, the live preview and the one path that applies a player's edit. Every slice gets these.
import { applyAction, validateAction } from '../../simulation/engine'
import type { ActionValidation, Explanation, PlayerAction, SimulationState, Snapshot, WorldInput } from '../../simulation/types'
import type { Feedback, GameStore } from '../storeTypes'
import { SAVE_FORMAT, SAVE_VERSION, writeSave, type SaveFile } from '../persistence'
import { fingerprint, type LogEntry } from '../replay'
import { STORAGE_KEYS, writeItem } from '../storage'
import { ACTION_PHRASE, toolCellsAt } from '../toolActions'
import { advanceTutorial, type TutorialEvent } from '../tutorial'
import { SPEED_MS, clearTimer, emptyCompare, money, runDefaults, startTimer } from './runtime'

export type StoreSet = (partial: Partial<GameStore>) => void
export type StoreGet = () => GameStore

export interface StoreCtx {
  set: StoreSet
  get: StoreGet
  notify(kind: Feedback['kind'], text: string): void
  tutorialEvent(ev: TutorialEvent): void
  saveGame(opts?: { silent?: boolean }): boolean
  installRun(
    world: WorldInput,
    worldId: string,
    seed: number,
    state: SimulationState,
    snapshots: Snapshot[],
    log: LogEntry[],
    explanations: Explanation[],
    extra: Partial<GameStore>,
  ): void
  /** Arms the next play tick (or clears it when paused). */
  schedule(): void
  refreshPreview(footprintChanged: boolean): void
  record(action: PlayerAction, opts: { fromRedo: boolean }): ActionValidation | null
}

let feedbackSeq = 0

/**
 * Applies `action` restricted to the parcels `validation` accepted. If the engine judges the
 * trimmed action differently (a footprint rule that depends on the whole stroke), the full
 * action is applied as validated, which the engine then records as requested.
 */
function applyValid(sim: SimulationState, action: PlayerAction, validation: ActionValidation): { state: SimulationState; applied: PlayerAction } {
  if ('cells' in action && validation.cellOk.some((ok) => ok === false)) {
    const trimmed = { ...action, cells: action.cells.filter((_, i) => validation.cellOk[i] !== false) } as PlayerAction
    const r = applyAction(sim, trimmed)
    if (r.validation.ok && Math.abs(r.validation.cost - validation.cost) < 0.5 && (r.validation.revenue ?? 0) === (validation.revenue ?? 0)) {
      return { state: r.state, applied: trimmed }
    }
  }
  return { state: applyAction(sim, action).state, applied: action }
}

export function makeContext(set: StoreSet, get: StoreGet): StoreCtx {
  const notify = (kind: Feedback['kind'], text: string) => set({ feedback: { id: ++feedbackSeq, kind, text } })

  const tutorialEvent = (ev: TutorialEvent) => {
    const t = get().tutorial
    const next = advanceTutorial(t, ev)
    if (next === t) return
    set({ tutorial: next })
    if (next.done) writeItem(STORAGE_KEYS.tutorial, 'done')
  }

  const buildSave = (): SaveFile | null => {
    const s = get()
    if (!s.sim || !s.worldId) return null
    return {
      format: SAVE_FORMAT,
      version: SAVE_VERSION,
      worldId: s.worldId,
      seed: s.seed,
      log: s.log,
      step: s.sim.step,
      settings: s.settings,
      scenarios: s.scenarios,
      runLabel: s.runLabel,
      ...(s.runId ? { runId: s.runId } : {}),
      tutorialDone: s.tutorial.done,
      reportShown: s.reportShown,
      fingerprint: fingerprint(s.sim),
      savedAt: new Date().toISOString(),
    }
  }

  const saveGame = (opts?: { silent?: boolean }): boolean => {
    const save = buildSave()
    if (!save) return false
    const ok = writeSave(save)
    const failedBefore = get().autosaveFailed
    if (ok) set({ hasSave: true, lastSavedAt: save.savedAt, autosaveFailed: false })
    else set({ autosaveFailed: true })
    if (!opts?.silent) {
      if (ok) notify('ok', 'Game saved in this browser.')
      else notify('error', 'This browser would not let Amoria save (storage may be full or disabled).')
    } else if (!ok && !failedBefore) {
      // tell the player once; the flag stays up (and the save copy says so) until a save works
      notify('warning', 'Your last change could not be saved: this browser stopped accepting saves (storage may be full or disabled). Keep playing, but a reload would lose recent changes.')
    }
    return ok
  }

  /** Installs a run (fresh or replayed) as the live game. */
  const installRun = (
    world: WorldInput,
    worldId: string,
    seed: number,
    state: SimulationState,
    snapshots: Snapshot[],
    log: LogEntry[],
    explanations: Explanation[],
    extra: Partial<GameStore>,
  ) => {
    clearTimer()
    set({
      ...runDefaults,
      screen: 'game',
      world,
      worldId,
      seed,
      sim: state,
      snapshots,
      log,
      explanations,
      tool: 'inspect',
      overlay: 'none',
      panel: null,
      busy: false,
      loadError: null,
      loadErrorKind: null,
      compare: emptyCompare(),
      ...extra,
    })
  }

  const schedule = () => {
    clearTimer()
    const s = get()
    if (!s.playing) return
    startTimer(() => {
      const st = get()
      if (!st.playing || st.screen !== 'game') return
      st.stepSeason()
      schedule()
    }, SPEED_MS[s.speed])
  }

  /**
   * Keeps the preview in step with the active tool, brush and options, so what is shown is
   * exactly what Enter or a click would build. The keyboard cursor wins, then the hovered
   * parcel (when the footprint changed), then the cells already previewed (a drag stroke).
   */
  const refreshPreview = (footprintChanged: boolean) => {
    const s = get()
    if (!s.sim) return
    const { width, height } = s.sim.terrain
    if (s.tool === 'inspect') {
      if (s.preview) set({ preview: null })
      return
    }
    if (s.cursorCell !== null) s.setPreviewCells(toolCellsAt(s.tool, s.cursorCell, s.brush, width, height))
    else if (footprintChanged && s.hoverCell !== null) s.setPreviewCells(toolCellsAt(s.tool, s.hoverCell, s.brush, width, height))
    else if (s.preview) s.setPreviewCells(s.preview.cells)
  }

  const record = (action: PlayerAction, opts: { fromRedo: boolean }): ActionValidation | null => {
    const s = get()
    if (!s.sim) return null
    if (s.viewStep !== null) {
      const v: ActionValidation = {
        ok: false,
        cost: 0,
        cellOk: 'cells' in action ? action.cells.map(() => false) : [],
        reasons: ['You are viewing the past. Return to the present to make changes.'],
      }
      notify('error', v.reasons[0])
      return v
    }
    const validation = validateAction(s.sim, action)
    if (!validation.ok) {
      notify('error', validation.reasons.length ? validation.reasons.join(' ') : 'That change is not allowed here.')
      return validation
    }
    // Apply, record, log and undo only the parcels that were actually valid, so the decision
    // history matches what was built. The feedback below still reports the skipped parcels.
    const { state, applied } = applyValid(s.sim, action, validation)
    const count = 'cells' in action ? action.cells.filter((_, i) => validation.cellOk[i] !== false).length : 0
    const where = 'cells' in action ? ` ${count} parcel${count === 1 ? '' : 's'}` : ''
    const amount = 'amount' in action ? ` of ${money(action.amount)}` : ''
    const cost = validation.cost > 0 ? ` for ${money(validation.cost)}` : ''
    const skipped = 'cells' in action ? action.cells.length - count : 0
    const skipNote = skipped > 0 ? ` Skipped ${skipped} parcel${skipped === 1 ? '' : 's'}${validation.reasons[0] ? `: ${validation.reasons[0]}` : ''}` : ''
    const revenue = validation.revenue && validation.revenue > 0 ? `, earning ${money(validation.revenue)} once` : ''
    notify('ok', `${ACTION_PHRASE[action.type]}${where}${amount}${cost}${revenue}.${skipNote}`)
    set({
      sim: state,
      log: [...s.log, { step: s.sim.step, action: applied }],
      undoStack: [...s.undoStack, { state: s.sim, logLength: s.log.length }],
      redoStack: opts.fromRedo ? s.redoStack : [],
      preview: null,
    })
    if ('cells' in action) tutorialEvent('build')
    saveGame({ silent: true })
    return validation
  }

  return { set, get, notify, tutorialEvent, saveGame, installRun, schedule, refreshPreview, record }
}
