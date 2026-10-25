// Shared helpers and module state for the store slices (play timer, small formatters, run defaults).
import type { Explanation, PlayerAction, Snapshot } from '../../simulation/types'
import type { CompareState, GameStore, Speed, Toast } from '../storeTypes'
import type { ScenarioId, ScenarioSlot } from '../persistence'
import type { LogEntry } from '../replay'
import { STORAGE_KEYS, readItem } from '../storage'

/** Milliseconds of wall time per simulated season at each speed. */
export const SPEED_MS: Record<Speed, number> = { 1: 2400, 2: 1200, 3: 600 }

/** How much faster than the slowest speed each speed runs ("1x", "2x", "4x"), derived from SPEED_MS. */
export const speedLabel = (sp: Speed): string => `${Math.round(SPEED_MS[1] / SPEED_MS[sp])}x`

let timer: ReturnType<typeof setTimeout> | null = null

export const clearTimer = (): void => {
  if (timer !== null) clearTimeout(timer)
  timer = null
}

/** Runs `fn` once after `ms`, replacing any pending tick. */
export const startTimer = (fn: () => void, ms: number): void => {
  clearTimer()
  timer = setTimeout(() => {
    timer = null
    fn()
  }, ms)
}

export const randomSeed = (): number => Math.floor(Math.random() * 0x7fffffff) >>> 0

let runSeq = 0
/** A fresh run id: when the run started, plus a counter so two runs started in the same millisecond differ. */
export const newRunId = (): string => `${new Date().toISOString()}#${++runSeq}`

export const money = (v: number): string => `$${Math.round(v).toLocaleString('en-US')}`

/** Player-facing message: a loader's userMessage if it has one, else the error text. */
export function friendlyError(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && typeof (e as { userMessage?: unknown }).userMessage === 'string') return (e as { userMessage: string }).userMessage
  return e instanceof Error && e.message ? e.message : fallback
}

export const readTutorialDone = (): boolean => readItem(STORAGE_KEYS.tutorial) === 'done'

/** How the current state relates to a scenario: no slot yet, or which one it is. */
export function slotFrom(id: ScenarioId, worldId: string, seed: number, log: LogEntry[], endStep: number): ScenarioSlot {
  return { id, label: `Scenario ${id}`, worldId, seed, log: log.slice(), endStep, savedAt: new Date().toISOString() }
}

/** "year 3, dry season": the date of the season a run is about to play after `step` seasons. */
export const stepText = (step: number): string => `year ${Math.floor(step / 2) + 1}, ${step % 2 === 0 ? 'wet' : 'dry'} season`

const sameEntry = (a: LogEntry, b: LogEntry) => a.step === b.step && JSON.stringify(a.action) === JSON.stringify(b.action)

/** True when the live run is Scenario A played on past its save: same decisions first, then more seasons or decisions. */
export function extendsRun(saved: ScenarioSlot, log: LogEntry[], step: number): boolean {
  if (step < saved.endStep || log.length < saved.log.length) return false
  if (step === saved.endStep && log.length === saved.log.length) return false
  return saved.log.every((e, i) => sameEntry(e, log[i]))
}

export const emptyCompare = (): CompareState => ({ A: null, B: null, loading: false, error: null, step: 0 })

export const runDefaults = {
  sim: null,
  viewSnapshot: null,
  hoverCell: null,
  selectedCell: null,
  preview: null,
  focusCell: null,
  world: null,
  log: [] as LogEntry[],
  snapshots: [] as Snapshot[],
  viewStep: null,
  explanations: [] as Explanation[],
  seenExplanations: 0,
  cursorCell: null,
  undoStack: [] as GameStore['undoStack'],
  redoStack: [] as PlayerAction[],
  playing: false,
  activeExplanationId: null,
  toasts: [] as Toast[],
  toastAnnouncement: null,
  reportOpen: false,
  reportShown: false,
}
