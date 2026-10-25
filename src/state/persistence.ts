// Save file format and validation. A save holds only inputs (world id, seed, action log)
// plus settings and scenario slots; loading replays the engine. Anything malformed is
// rejected with a message a player can understand.
import { INTENSITIES, type Intensity, type PlayerAction } from '../simulation/types'
import type { LogEntry } from './replay'
import { sanitizeSettings, type Settings } from './settings'
import { STORAGE_KEYS, readItem, removeItem, writeItem } from './storage'

export const SAVE_FORMAT = 'amoria-save'
export const SAVE_VERSION = 1

export type ScenarioId = 'A' | 'B'

export interface ScenarioSlot {
  id: ScenarioId
  label: string
  worldId: string
  seed: number
  log: LogEntry[]
  endStep: number
  savedAt: string
}

export interface SaveFile {
  format: typeof SAVE_FORMAT
  version: typeof SAVE_VERSION
  worldId: string
  seed: number
  log: LogEntry[]
  step: number
  settings: Settings
  scenarios: { A: ScenarioSlot | null; B: ScenarioSlot | null }
  runLabel: ScenarioId | null
  /** Identifies the run (its start time); missing in saves made before it existed. */
  runId?: string
  tutorialDone: boolean
  reportShown: boolean
  fingerprint: { step: number; budget: number; debt: number; population: number }
  savedAt: string
}

export type ParseResult = { ok: true; save: SaveFile } | { ok: false; reason: string }

const CELL_ACTIONS = new Set([
  'road',
  'housing',
  'cropland',
  'set-intensity',
  'toggle-irrigation',
  'agroforestry',
  'clear',
  'reforest',
  'wetland',
  'conservation',
  'reservoir',
  'waterworks',
  'market',
  'demolish',
])

const isInt = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

/** Checks one action's shape. Engine-level validity is checked during replay. */
export function sanitizeAction(raw: unknown): PlayerAction | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  if (a.type === 'loan' || a.type === 'repay') {
    return typeof a.amount === 'number' && Number.isFinite(a.amount) && a.amount > 0 ? { type: a.type, amount: a.amount } : null
  }
  if (a.type === 'set-levy') {
    // the engine checks the allowed range during replay; here only the shape
    return typeof a.rate === 'number' && Number.isFinite(a.rate) && a.rate >= 0 && a.rate <= 1 ? { type: 'set-levy', rate: a.rate } : null
  }
  if (typeof a.type !== 'string' || !CELL_ACTIONS.has(a.type)) return null
  if (!Array.isArray(a.cells) || a.cells.length === 0 || !a.cells.every((c) => isInt(c, 0, 1_000_000))) return null
  const cells = (a.cells as number[]).slice()
  const intensityOk = (v: unknown) => typeof v === 'string' && (INTENSITIES as readonly string[]).includes(v)
  if (a.type === 'cropland') {
    if (!intensityOk(a.intensity) || typeof a.irrigated !== 'boolean') return null
    return { type: 'cropland', cells, intensity: a.intensity as Intensity, irrigated: a.irrigated }
  }
  if (a.type === 'set-intensity') {
    if (!intensityOk(a.intensity)) return null
    return { type: 'set-intensity', cells, intensity: a.intensity as Intensity }
  }
  return { type: a.type as Exclude<PlayerAction['type'], 'cropland' | 'set-intensity' | 'loan' | 'repay' | 'set-levy'>, cells }
}

function sanitizeLog(raw: unknown): LogEntry[] | null {
  if (!Array.isArray(raw)) return null
  const out: LogEntry[] = []
  let lastStep = 0
  for (const e of raw) {
    if (!e || typeof e !== 'object') return null
    const r = e as Record<string, unknown>
    if (!isInt(r.step, 0, 100_000) || r.step < lastStep) return null
    const action = sanitizeAction(r.action)
    if (!action) return null
    lastStep = r.step
    out.push({ step: r.step, action })
  }
  return out
}

function sanitizeSlot(raw: unknown, id: ScenarioId): ScenarioSlot | null | undefined {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const log = sanitizeLog(r.log)
  if (typeof r.worldId !== 'string' || !isInt(r.seed, 0, 0xffffffff) || !log || !isInt(r.endStep, 0, 100_000)) return undefined
  return {
    id,
    label: typeof r.label === 'string' ? r.label.slice(0, 60) : `Scenario ${id}`,
    worldId: r.worldId,
    seed: r.seed,
    log,
    endStep: r.endStep,
    savedAt: typeof r.savedAt === 'string' ? r.savedAt : '',
  }
}

export function parseSave(raw: unknown): ParseResult {
  if (raw === undefined) return { ok: false, reason: 'The saved game could not be read. It looks damaged.' }
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'No saved game was found.' }
  const r = raw as Record<string, unknown>
  if (r.format !== SAVE_FORMAT) return { ok: false, reason: 'The saved data is not an Amoria save.' }
  if (typeof r.version !== 'number') return { ok: false, reason: 'The saved game has no version number, so it cannot be loaded safely.' }
  if (r.version > SAVE_VERSION) return { ok: false, reason: 'This save was made by a newer version of Amoria.' }
  if (r.version < SAVE_VERSION) return { ok: false, reason: 'This save was made by an older version of Amoria that this version cannot replay.' }
  const log = sanitizeLog(r.log)
  if (typeof r.worldId !== 'string' || !r.worldId) return { ok: false, reason: 'The saved game does not say which world it belongs to.' }
  if (!isInt(r.seed, 0, 0xffffffff)) return { ok: false, reason: 'The saved game has an invalid seed.' }
  if (!log) return { ok: false, reason: 'Some saved decisions are damaged, so the game cannot be rebuilt.' }
  if (!isInt(r.step, 0, 100_000)) return { ok: false, reason: 'The saved game has an invalid date.' }
  if (log.length && log[log.length - 1].step > r.step) return { ok: false, reason: 'The saved decisions do not match the saved date.' }
  const scen = (r.scenarios && typeof r.scenarios === 'object' ? r.scenarios : {}) as Record<string, unknown>
  const A = sanitizeSlot(scen.A, 'A')
  const B = sanitizeSlot(scen.B, 'B')
  if (A === undefined || B === undefined) return { ok: false, reason: 'A saved scenario slot is damaged.' }
  const fp = (r.fingerprint ?? {}) as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN)
  return {
    ok: true,
    save: {
      format: SAVE_FORMAT,
      version: SAVE_VERSION,
      worldId: r.worldId,
      seed: r.seed,
      log,
      step: r.step,
      settings: sanitizeSettings(r.settings),
      scenarios: { A, B },
      runLabel: r.runLabel === 'A' || r.runLabel === 'B' ? r.runLabel : null,
      ...(typeof r.runId === 'string' && r.runId.length > 0 && r.runId.length <= 80 ? { runId: r.runId } : {}),
      tutorialDone: r.tutorialDone === true,
      reportShown: r.reportShown === true,
      fingerprint: { step: num(fp.step), budget: num(fp.budget), debt: num(fp.debt), population: num(fp.population) },
      savedAt: typeof r.savedAt === 'string' ? r.savedAt : '',
    },
  }
}

export function readSave(): ParseResult {
  const raw = readItem(STORAGE_KEYS.save)
  if (raw === null) return { ok: false, reason: 'No saved game was found.' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'The saved game could not be read. It looks damaged.' }
  }
  return parseSave(parsed)
}

export function hasStoredSave(): boolean {
  return readItem(STORAGE_KEYS.save) !== null
}

export function writeSave(save: SaveFile): boolean {
  return writeItem(STORAGE_KEYS.save, JSON.stringify(save))
}

export function deleteSave(): void {
  removeItem(STORAGE_KEYS.save)
}
