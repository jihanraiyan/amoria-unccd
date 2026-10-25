// World registry. The procedural Amoria Valley is always available. Real-data worlds
// come from src/data/loaders (geodata team). Those modules are discovered at build time
// so this file keeps compiling while that area is still being written.
//
// Loader contract (documented in docs/progress/ui.md): a module in src/data/loaders may
// export `WORLDS` (array) or `listWorlds()` (returning an array or a Promise of one) whose
// entries look like `{ meta: WorldMeta, load(): Promise<WorldInput> | WorldInput }`.
import { generateProceduralWorld } from '../simulation/world/procedural'
import type { WorldInput, WorldMeta } from '../simulation/types'

export interface WorldEntry {
  meta: WorldMeta
  load(): Promise<WorldInput>
}

/** The canonical Amoria Valley terrain. The game seed drives weather, not terrain shape. */
export const PROCEDURAL_WORLD_SEED = 1
export const PROCEDURAL_WORLD_ID = 'amoria-valley'

let proceduralCache: WorldInput | null = null
function proceduralWorld(): WorldInput {
  if (!proceduralCache) proceduralCache = generateProceduralWorld(PROCEDURAL_WORLD_SEED)
  return proceduralCache
}

export const proceduralEntry: WorldEntry = {
  meta: proceduralWorld().meta,
  load: async () => proceduralWorld(),
}

function isMeta(x: unknown): x is WorldMeta {
  if (!x || typeof x !== 'object') return false
  const m = x as Record<string, unknown>
  return (
    typeof m.id === 'string' &&
    typeof m.name === 'string' &&
    (m.kind === 'procedural' || m.kind === 'real-data-derived') &&
    typeof m.description === 'string' &&
    typeof m.provenance === 'string'
  )
}

function toEntry(x: unknown): WorldEntry | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  if (!isMeta(r.meta) || typeof r.load !== 'function') return null
  const load = r.load as () => unknown
  const meta = r.meta
  return {
    meta,
    load: async () => {
      const w = (await load()) as WorldInput
      if (!w || !(w.elevationM instanceof Float32Array) || !(w.cover instanceof Uint8Array)) {
        throw new Error(`World "${meta.name}" did not load valid terrain data.`)
      }
      return w
    },
  }
}

const loaderModules = import.meta.glob<Record<string, unknown>>(['../data/loaders/*.ts', '!../data/loaders/*.test.ts'], {
  eager: true,
})

async function entriesFromModule(mod: Record<string, unknown>): Promise<WorldEntry[]> {
  const out: WorldEntry[] = []
  const lists: unknown[] = []
  if (Array.isArray(mod.WORLDS)) lists.push(...mod.WORLDS)
  if (typeof mod.listWorlds === 'function') {
    try {
      const listed = await (mod.listWorlds as () => unknown)()
      if (Array.isArray(listed)) lists.push(...listed)
    } catch {
      // a failing loader must not hide the procedural world
    }
  }
  for (const item of lists) {
    const e = toEntry(item)
    if (e) out.push(e)
  }
  return out
}

let catalog: Promise<WorldEntry[]> | null = null

/** All selectable worlds, procedural first. Duplicate ids keep the first entry. */
export function listWorlds(): Promise<WorldEntry[]> {
  if (!catalog) {
    catalog = (async () => {
      const all: WorldEntry[] = [proceduralEntry]
      for (const mod of Object.values(loaderModules)) all.push(...(await entriesFromModule(mod)))
      const seen = new Set<string>()
      return all.filter((e) => (seen.has(e.meta.id) ? false : (seen.add(e.meta.id), true)))
    })()
  }
  return catalog
}

export async function loadWorld(worldId: string): Promise<WorldInput> {
  const worlds = await listWorlds()
  const entry = worlds.find((w) => w.meta.id === worldId)
  if (!entry) throw new Error(`The world "${worldId}" is not available in this version of Amoria.`)
  return entry.load()
}

export interface WorldNotes {
  /** Attribution lines that must be shown wherever the map is shown. */
  attribution: string[]
  /** Plain statements of what the data can and cannot tell the player. */
  disclosures: string[]
}

/** Attribution and disclosures a loaded world carries (real-data worlds), if any. */
export function worldNotes(world: WorldInput | null): WorldNotes | null {
  const d = (world as { details?: unknown } | null)?.details
  if (!d || typeof d !== 'object') return null
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [])
  const r = d as Record<string, unknown>
  const notes = { attribution: strings(r.attribution), disclosures: strings(r.disclosures) }
  return notes.attribution.length || notes.disclosures.length ? notes : null
}

/** Per-cell layers a real-data world keeps for honesty about its sources (see src/data/worldFile.ts). */
export interface WorldCellData {
  /**
   * Game cover class that won the per-cell vote after WorldCover pixels were mapped to game
   * classes (shrubland and grassland pooled), before the channel, road and settlement rules.
   * Not the satellite class itself: see worldCoverClass.
   */
  observedCover: Uint8Array | null
  /** Share of built-up pixels per cell, 0 to 100, if provided. */
  builtPct: Uint8Array | null
  /** Most common native ESA WorldCover class code in the cell, if provided. */
  worldCoverClass: Uint8Array | null
  /** Share of the cell's pixels in worldCoverClass, 0 to 100, if provided. */
  worldCoverSharePct: Uint8Array | null
  /** WorldCover code to class name. */
  worldCoverLegend: Record<number, string> | null
}

const EMPTY_CELL_DATA: WorldCellData = { observedCover: null, builtPct: null, worldCoverClass: null, worldCoverSharePct: null, worldCoverLegend: null }

function readLegend(v: unknown): Record<number, string> | null {
  if (!v || typeof v !== 'object') return null
  const out: Record<number, string> = {}
  for (const [k, name] of Object.entries(v as Record<string, unknown>)) {
    const code = Number(k)
    if (Number.isInteger(code) && typeof name === 'string') out[code] = name
  }
  return Object.keys(out).length ? out : null
}

/** Reads a loaded world's per-cell provenance layers, checking their type and length. */
export function worldCellData(world: WorldInput | null): WorldCellData {
  const d = (world as { details?: unknown } | null)?.details
  const n = world ? world.width * world.height : 0
  const layer = (v: unknown): Uint8Array | null => (v instanceof Uint8Array && v.length === n ? v : null)
  if (!world || !d || typeof d !== 'object') return EMPTY_CELL_DATA
  const r = d as Record<string, unknown>
  return {
    observedCover: layer(r.observedCover),
    builtPct: layer(r.builtPct),
    worldCoverClass: layer(r.worldCoverClass),
    worldCoverSharePct: layer(r.worldCoverSharePct),
    worldCoverLegend: readLegend(r.worldCoverLegend),
  }
}

/** Pit-filling counts a real-data world reports in its build stats, if present. */
export interface DemFillStats {
  filledCells: number
  maxRaiseM: number
}

export function demFillStats(world: WorldInput | null): DemFillStats | null {
  const d = (world as { details?: { stats?: unknown } } | null)?.details
  const st = d?.stats
  if (!st || typeof st !== 'object') return null
  const r = st as Record<string, unknown>
  const filled = r.filledCells
  const raise = r.filledPitMaxRaiseM
  if (typeof filled !== 'number' || !Number.isFinite(filled)) return null
  return { filledCells: filled, maxRaiseM: typeof raise === 'number' && Number.isFinite(raise) ? raise : 0 }
}

export { REAL_DATA_GENERIC_NOTE, genericClimateNote } from './climateNote'

const notesCache = new Map<string, Promise<WorldNotes | null>>()

/**
 * Attribution and disclosures for a world by id, loading it once if needed (the title screen
 * shows the real-data map before any game is started). Failures resolve to null and are retried
 * on the next call.
 */
export function loadWorldNotes(worldId: string): Promise<WorldNotes | null> {
  const hit = notesCache.get(worldId)
  if (hit) return hit
  const p = loadWorld(worldId)
    .then((w) => worldNotes(w))
    .catch(() => {
      notesCache.delete(worldId)
      return null
    })
  notesCache.set(worldId, p)
  return p
}

/** Test hook: forget the cached catalog. */
export function resetWorldCatalog(): void {
  catalog = null
  notesCache.clear()
}
