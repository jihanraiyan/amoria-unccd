// Parser and validator for real-data world files (public/world-data/*.json) written by
// scripts/geodata/build_world.py. Turns the JSON document into the WorldInput contract
// from src/simulation/types.ts, or throws a WorldLoadError with a player-friendly message
// plus the exact list of problems for developers.
import { LAND_COVERS, STRUCTURES, type WorldInput, type WorldMeta } from '../simulation/types'

export const WORLD_FILE_FORMAT = 'amoria-world'
export const WORLD_FILE_VERSION = 1

/** Grid sizes the game can reasonably simulate and render. */
const MIN_SIZE = 8
const MAX_SIZE = 256
/** Lowest and highest land surface on Earth, with margin, in centimetres. */
const MIN_ELEV_CM = -50_000
const MAX_ELEV_CM = 900_000
/** Road provenance codes written by the pipeline. */
export const ROAD_SOURCES = ['none', 'osm-main', 'osm-minor-link', 'pipeline-link'] as const
/** ESA WorldCover 2021 v200 class codes (the only values a worldCoverClass layer may hold). */
export const WORLDCOVER_CODES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100] as const

export type WorldLoadErrorCode = 'unknown-world' | 'network' | 'parse' | 'invalid' | 'unsupported-version'

export class WorldLoadError extends Error {
  readonly code: WorldLoadErrorCode
  /** Specific problems found, for logs and developer tools. */
  readonly issues: string[]
  /** Short message safe to show to players. */
  readonly userMessage: string

  constructor(code: WorldLoadErrorCode, userMessage: string, issues: string[] = []) {
    super(issues.length ? `${userMessage} (${issues.slice(0, 5).join('; ')}${issues.length > 5 ? '; ...' : ''})` : userMessage)
    this.name = 'WorldLoadError'
    this.code = code
    this.userMessage = userMessage
    this.issues = issues
  }
}

export interface WorldPlace {
  name: string
  place: string
  row: number
  col: number
  osmNodeId?: number
  /** All OSM node ids merged into this place (same name a few cells apart), when more than one. */
  osmNodeIds?: number[]
  /** OSM place types of the merged nodes, in the same order as osmNodeIds. */
  osmPlaceTypes?: string[]
}

/** Extra information a real-data world carries beyond the simulation contract. */
export interface WorldDetails {
  /** Attribution lines that must be shown wherever the map is shown. */
  attribution: string[]
  /** Plain statements of what the data can and cannot tell the player. */
  disclosures: string[]
  /** Named places from OpenStreetMap that fall inside the grid. */
  places: WorldPlace[]
  /**
   * WorldCover pixels mapped to game covers, then the majority per cell, before the channel, road and
   * settlement rules (game cover codes). Not the satellite class itself: see worldCoverClass.
   */
  observedCover?: Uint8Array
  /** Most common native ESA WorldCover class per cell (codes 10..100, e.g. 20 = Shrubland). */
  worldCoverClass?: Uint8Array
  /** Share of the cell's valid WorldCover pixels (about 117 native pixels of about 9.3 m) in worldCoverClass, 0..100. */
  worldCoverSharePct?: Uint8Array
  /** WorldCover code to class name, as written by the pipeline. */
  worldCoverLegend?: Record<number, string>
  /** Acquisition date or period per source name (ISO date or start/end), when the file gives one. */
  sourceDates?: Record<string, string>
  /** Road provenance per cell, index into ROAD_SOURCES. */
  roadSource?: Uint8Array
  /** Share of WorldCover built-up pixels per cell, 0..100. */
  builtPct?: Uint8Array
  /**
   * Share of the cell's Copernicus DEM pixels that the producer void-filled from another elevation source
   * (for example ASTER GDEM) instead of TanDEM-X, 0..100, from the DEM's Filling Mask.
   */
  demFilledPct?: Uint8Array
  grid?: { orientation?: string; originUtm?: [number, number]; cellSizeM?: number; verticalDatum?: string }
  stats?: Record<string, unknown>
  generated?: Record<string, unknown>
}

export type LoadedWorld = WorldInput & { details: WorldDetails }

type Json = Record<string, unknown>

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
/** A non-empty array whose every entry is a non-empty string. */
const nonEmptyStrings = (v: unknown): boolean => Array.isArray(v) && v.length > 0 && v.every(isStr)

class Issues {
  readonly list: string[] = []
  add(msg: string) {
    this.list.push(msg)
  }
}

function readMeta(raw: unknown, issues: Issues): WorldMeta | null {
  if (!isObj(raw)) {
    issues.add('meta is missing')
    return null
  }
  for (const k of ['id', 'name', 'description', 'provenance'] as const) {
    if (!isStr(raw[k])) issues.add(`meta.${k} must be a non-empty string`)
  }
  const kind = raw.kind
  if (kind !== 'procedural' && kind !== 'real-data-derived') issues.add('meta.kind must be "procedural" or "real-data-derived"')
  const meta: WorldMeta = {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    kind: kind === 'procedural' ? 'procedural' : 'real-data-derived',
    description: String(raw.description ?? ''),
    provenance: String(raw.provenance ?? ''),
  }
  if (raw.bbox !== undefined) {
    const b = raw.bbox
    if (!Array.isArray(b) || b.length !== 4 || !b.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      issues.add('meta.bbox must be four finite numbers [west, south, east, north]')
    } else {
      const [w, s, e, n] = b as number[]
      if (w < -180 || e > 180 || s < -90 || n > 90 || w >= e || s >= n) issues.add('meta.bbox is not a valid WGS84 box')
      else meta.bbox = [w, s, e, n]
    }
  }
  if (raw.crs !== undefined) {
    if (isStr(raw.crs)) meta.crs = raw.crs
    else issues.add('meta.crs must be a string')
  }
  if (raw.sources !== undefined) {
    if (!Array.isArray(raw.sources)) issues.add('meta.sources must be an array')
    else {
      const sources: NonNullable<WorldMeta['sources']> = []
      raw.sources.forEach((s, i) => {
        if (!isObj(s) || !isStr(s.name) || !isStr(s.version) || !isStr(s.license) || !isStr(s.url)) {
          issues.add(`meta.sources[${i}] needs name, version, license and url`)
        } else {
          const source: NonNullable<WorldMeta['sources']>[number] = { name: s.name, version: s.version, license: s.license, url: s.url }
          if (s.acquired !== undefined) {
            if (isStr(s.acquired) && isIsoPeriod(s.acquired)) source.acquired = s.acquired
            else issues.add(`meta.sources[${i}].acquired must be an ISO 8601 date or a start/end range`)
          }
          sources.push(source)
        }
      })
      meta.sources = sources
    }
  }
  // Integrity rule: a world that claims real data must say where it came from.
  if (meta.kind === 'real-data-derived') {
    if (!(meta.sources && meta.sources.length > 0)) issues.add('a real-data-derived world must list its sources')
    // The source licences (CC BY 4.0, Copernicus, ODbL) require attribution wherever the map is shown.
    if (!nonEmptyStrings(raw.attribution)) issues.add('a real-data-derived world must carry meta.attribution lines')
    if (!nonEmptyStrings(raw.disclosures)) issues.add('a real-data-derived world must carry meta.disclosures')
    if (raw.bbox === undefined) issues.add('a real-data-derived world must give meta.bbox')
    if (raw.crs === undefined) issues.add('a real-data-derived world must give meta.crs')
  }
  return meta
}

/** ISO 8601 date or date-time, at year, month, day, minute or second precision. */
const ISO_DATE = /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?)?)?$/

/** True for one ISO 8601 date or a "start/end" range whose start is not after its end. */
export function isIsoPeriod(text: string): boolean {
  const parts = text.split('/')
  if (parts.length > 2 || !parts.every((p) => ISO_DATE.test(p))) return false
  return parts.length === 1 || parts[0].slice(0, 10) <= parts[1].slice(0, 10)
}

/** Build a remap table from the file's legend to the game's code order. */
function legendMap(raw: unknown, expected: readonly string[], label: string, issues: Issues): number[] | null {
  if (raw === undefined) return expected.map((_, i) => i)
  if (!Array.isArray(raw) || !raw.every((v) => typeof v === 'string')) {
    issues.add(`${label} must be an array of names`)
    return null
  }
  const map: number[] = []
  for (const name of raw as string[]) {
    const code = expected.indexOf(name)
    if (code < 0) {
      issues.add(`${label} contains "${name}", which this version of the game does not know`)
      return null
    }
    map.push(code)
  }
  return map
}

interface LayerSpec {
  min: number
  max: number
  integer: boolean
}

function readLayer(layers: Json, key: string, n: number, spec: LayerSpec, required: boolean, issues: Issues): number[] | null {
  const raw = layers[key]
  if (raw === undefined) {
    if (required) issues.add(`layer "${key}" is missing`)
    return null
  }
  if (!Array.isArray(raw)) {
    issues.add(`layer "${key}" must be an array`)
    return null
  }
  if (raw.length !== n) {
    issues.add(`layer "${key}" has ${raw.length} values, expected ${n}`)
    return null
  }
  let bad = 0
  let first = -1
  for (let i = 0; i < n; i++) {
    const v = raw[i]
    const ok = typeof v === 'number' && Number.isFinite(v) && v >= spec.min && v <= spec.max && (!spec.integer || Number.isInteger(v))
    if (!ok) {
      bad++
      if (first < 0) first = i
    }
  }
  if (bad) {
    issues.add(`layer "${key}" has ${bad} invalid values (first at cell ${first}: ${JSON.stringify(raw[first])}; allowed ${spec.min}..${spec.max})`)
    return null
  }
  return raw as number[]
}

const u8 = (a: number[] | null, map?: number[] | null) => {
  if (!a) return undefined
  const out = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = map ? map[a[i]] : a[i]
  return out
}

/** Validate meta.places: each needs a name and integer row/col inside the grid. */
function readPlaces(raw: unknown, width: number, height: number, issues: Issues): WorldPlace[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    issues.add('meta.places must be an array')
    return []
  }
  const places: WorldPlace[] = []
  const inRange = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < max
  const ints = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isInteger(x))
  raw.forEach((p, i) => {
    if (!isObj(p) || !isStr(p.name)) {
      issues.add(`meta.places[${i}] needs a name`)
      return
    }
    if (!inRange(p.row, height) || !inRange(p.col, width)) {
      issues.add(`meta.places[${i}] "${p.name}" has row ${JSON.stringify(p.row)}, col ${JSON.stringify(p.col)}; both must be whole numbers inside the ${width} x ${height} grid`)
      return
    }
    const place: WorldPlace = { name: p.name, place: String(p.place ?? ''), row: p.row, col: p.col }
    if (typeof p.osmNodeId === 'number') place.osmNodeId = p.osmNodeId
    if (ints(p.osmNodeIds)) place.osmNodeIds = [...p.osmNodeIds]
    if (Array.isArray(p.osmPlaceTypes) && p.osmPlaceTypes.every((t) => typeof t === 'string')) place.osmPlaceTypes = [...(p.osmPlaceTypes as string[])]
    places.push(place)
  })
  return places
}

/** Validate the WorldCover legend: keys must be known WorldCover codes, values names. */
function readWorldCoverLegend(raw: unknown, issues: Issues): Record<number, string> | undefined {
  if (raw === undefined) return undefined
  if (!isObj(raw)) {
    issues.add('worldCoverLegend must be an object of code to name')
    return undefined
  }
  const legend: Record<number, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    const code = Number(k)
    if (!(WORLDCOVER_CODES as readonly number[]).includes(code) || !isStr(v)) {
      issues.add(`worldCoverLegend entry ${JSON.stringify(k)} is not a WorldCover code with a name`)
      return undefined
    }
    legend[code] = v
  }
  return legend
}

function readSourceDates(meta: Json): Record<string, string> | undefined {
  if (!Array.isArray(meta.sources)) return undefined
  const out: Record<string, string> = {}
  for (const s of meta.sources) if (isObj(s) && isStr(s.name) && isStr(s.acquired)) out[s.name] = s.acquired
  return Object.keys(out).length ? out : undefined
}

function readDetails(doc: Json, places: WorldPlace[]): Omit<WorldDetails, 'observedCover' | 'roadSource' | 'builtPct' | 'worldCoverClass' | 'worldCoverSharePct' | 'worldCoverLegend' | 'demFilledPct'> {
  const meta = isObj(doc.meta) ? doc.meta : {}
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter(isStr) : [])
  return {
    attribution: strings(meta.attribution),
    disclosures: strings(meta.disclosures),
    places,
    sourceDates: readSourceDates(meta),
    grid: isObj(meta.grid) ? (meta.grid as WorldDetails['grid']) : undefined,
    stats: isObj(meta.stats) ? meta.stats : undefined,
    generated: isObj(meta.generated) ? meta.generated : undefined,
  }
}

/**
 * Validate a parsed world document and convert it to the simulation contract.
 * Throws WorldLoadError listing every problem found.
 */
export function parseWorldFile(doc: unknown, expectedId?: string): LoadedWorld {
  const fail = (code: WorldLoadErrorCode, issues: string[]) =>
    new WorldLoadError(code, 'This map file is damaged or incomplete, so it cannot be played. Try the Amoria Valley map instead.', issues)

  if (!isObj(doc)) throw fail('invalid', ['the file is not a JSON object'])
  if (doc.format !== WORLD_FILE_FORMAT) throw fail('invalid', [`format must be "${WORLD_FILE_FORMAT}"`])
  if (doc.formatVersion !== WORLD_FILE_VERSION) {
    throw new WorldLoadError(
      'unsupported-version',
      'This map was made for a different version of Amoria and cannot be opened here.',
      [`formatVersion ${String(doc.formatVersion)} is not supported (expected ${WORLD_FILE_VERSION})`],
    )
  }

  const issues = new Issues()
  const meta = readMeta(doc.meta, issues)
  if (meta && expectedId !== undefined && meta.id !== expectedId) issues.add(`file contains world "${meta.id}", expected "${expectedId}"`)

  const { width, height, cellSizeM } = doc
  const sizeOk = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= MIN_SIZE && v <= MAX_SIZE
  if (!sizeOk(width) || !sizeOk(height)) issues.add(`width and height must be whole numbers from ${MIN_SIZE} to ${MAX_SIZE}`)
  if (typeof cellSizeM !== 'number' || !Number.isFinite(cellSizeM) || cellSizeM <= 0 || cellSizeM > 10_000) {
    issues.add('cellSizeM must be a positive number of metres')
  }
  if (!isObj(doc.layers)) issues.add('layers object is missing')
  if (issues.list.length || !meta || !isObj(doc.layers) || !sizeOk(width) || !sizeOk(height)) throw fail('invalid', issues.list)

  const n = width * height
  const layers = doc.layers
  const realData = meta.kind === 'real-data-derived'
  const places = readPlaces(isObj(doc.meta) ? doc.meta.places : undefined, width, height, issues)
  const wcLegend = readWorldCoverLegend(doc.worldCoverLegend, issues)
  const coverMap = legendMap(doc.coverLegend, LAND_COVERS, 'coverLegend', issues)
  const structMap = legendMap(doc.structureLegend, STRUCTURES, 'structureLegend', issues)
  const coverMax = (coverMap?.length ?? LAND_COVERS.length) - 1
  const structMax = (structMap?.length ?? STRUCTURES.length) - 1

  const elev = readLayer(layers, 'elevationCm', n, { min: MIN_ELEV_CM, max: MAX_ELEV_CM, integer: true }, true, issues)
  const cover = readLayer(layers, 'cover', n, { min: 0, max: coverMax, integer: true }, true, issues)
  const observed = readLayer(layers, 'observedCover', n, { min: 0, max: coverMax, integer: true }, false, issues)
  const structure = readLayer(layers, 'structure', n, { min: 0, max: structMax, integer: true }, false, issues)
  const level = readLayer(layers, 'structureLevel', n, { min: 0, max: 3, integer: true }, false, issues)
  // The simulation needs channels (HAND, floods, waterworks, wetlands) and the protected edge; a
  // procedural file may leave them to the engine, a real-data world must carry the derived ones.
  const prot = readLayer(layers, 'protected', n, { min: 0, max: 1, integer: true }, realData, issues)
  const channel = readLayer(layers, 'channel', n, { min: 0, max: 1, integer: true }, realData, issues)
  const roadSource = readLayer(layers, 'roadSource', n, { min: 0, max: ROAD_SOURCES.length - 1, integer: true }, false, issues)
  const builtPct = readLayer(layers, 'builtPct', n, { min: 0, max: 100, integer: true }, false, issues)
  const wcClass = readLayer(layers, 'worldCoverClass', n, { min: 0, max: 255, integer: true }, false, issues)
  const wcShare = readLayer(layers, 'worldCoverSharePct', n, { min: 0, max: 100, integer: true }, false, issues)
  const demFilled = readLayer(layers, 'demFilledPct', n, { min: 0, max: 100, integer: true }, false, issues)
  if (wcClass) {
    let bad = 0
    let first = -1
    for (let i = 0; i < n; i++) {
      if (!(WORLDCOVER_CODES as readonly number[]).includes(wcClass[i])) {
        bad++
        if (first < 0) first = i
      }
    }
    if (bad) issues.add(`layer "worldCoverClass" has ${bad} values that are not WorldCover codes (first at cell ${first}: ${wcClass[first]}; allowed ${WORLDCOVER_CODES.join(', ')})`)
    if (!wcLegend) issues.add('layer "worldCoverClass" needs a worldCoverLegend')
    else {
      const missing = [...new Set(wcClass)].filter((c) => (WORLDCOVER_CODES as readonly number[]).includes(c) && !(c in wcLegend))
      if (missing.length) issues.add(`worldCoverLegend has no name for code(s) ${missing.join(', ')}`)
    }
  }
  if (issues.list.length || !elev || !cover || !coverMap || !structMap) throw fail('invalid', issues.list)

  const coverU8 = u8(cover, coverMap)!
  const structU8 = u8(structure, structMap)
  const levelU8 = u8(level)
  const channelU8 = u8(channel)
  const housing = STRUCTURES.indexOf('housing')
  const road = STRUCTURES.indexOf('road')
  const reservoir = STRUCTURES.indexOf('reservoir')
  const water = LAND_COVERS.indexOf('water')
  const wetland = LAND_COVERS.indexOf('wetland')
  const urban = LAND_COVERS.indexOf('urban')
  if (structU8) {
    let badLevel = 0
    let onChannel = 0
    // The game builds housing and roads only on urban cover, and nothing but a reservoir or a
    // bridge (a road on a channel or open water, which keeps its water cover) on open water or
    // wetland; a file that breaks this was damaged or edited by hand.
    const offUrban: Record<'housing' | 'road', { count: number; first: number }> = {
      housing: { count: 0, first: -1 },
      road: { count: 0, first: -1 },
    }
    let onWet = 0
    let firstWet = -1
    for (let i = 0; i < n; i++) {
      const s = structU8[i]
      const lv = levelU8 ? levelU8[i] : s === housing ? 1 : 0
      if ((s === housing) !== lv > 0) badLevel++
      const bridge = s === road && coverU8[i] === water
      if (s !== 0 && !bridge && channelU8?.[i]) onChannel++
      if ((s === housing || (s === road && !bridge)) && coverU8[i] !== urban) {
        const slot = offUrban[s === housing ? 'housing' : 'road']
        slot.count++
        if (slot.first < 0) slot.first = i
      }
      if (s !== 0 && s !== reservoir && !bridge && (coverU8[i] === water || coverU8[i] === wetland)) {
        onWet++
        if (firstWet < 0) firstWet = i
      }
    }
    if (badLevel) issues.add(`${badLevel} cells have a housing level that does not match their structure`)
    if (onChannel) issues.add(`${onChannel} channel cells carry a structure other than a bridge`)
    const at = (i: number) => `row ${Math.floor(i / width)}, column ${i % width}`
    for (const [name, { count, first }] of Object.entries(offUrban)) {
      if (count) issues.add(`${count} ${name} cells are not on urban cover (first at ${at(first)}: ${LAND_COVERS[coverU8[first]]})`)
    }
    if (onWet) {
      issues.add(`${onWet} water or wetland cells carry a structure other than a reservoir (first at ${at(firstWet)}: ${STRUCTURES[structU8[firstWet]]})`)
    }
  }
  if (channelU8) {
    let dry = 0
    for (let i = 0; i < n; i++) if (channelU8[i] && coverU8[i] !== water) dry++
    if (dry) issues.add(`${dry} channel cells are not water`)
  }
  if (issues.list.length) throw fail('invalid', issues.list)

  const elevationM = new Float32Array(n)
  for (let i = 0; i < n; i++) elevationM[i] = elev[i] / 100

  const world: LoadedWorld = {
    meta,
    width,
    height,
    cellSizeM: cellSizeM as number,
    elevationM,
    cover: coverU8,
    details: {
      ...readDetails(doc, places),
      observedCover: u8(observed, coverMap),
      roadSource: u8(roadSource),
      builtPct: u8(builtPct),
      worldCoverClass: u8(wcClass),
      worldCoverSharePct: u8(wcShare),
      worldCoverLegend: wcLegend,
      demFilledPct: u8(demFilled),
    },
  }
  if (structU8) world.structure = structU8
  if (structU8) world.structureLevel = levelU8 ?? structU8.map((s) => (s === housing ? 1 : 0))
  const protU8 = u8(prot)
  if (protU8) world.protected = protU8
  if (channelU8) world.channel = channelU8
  return world
}

/**
 * Player-facing description of a cell's native WorldCover class, e.g. "Shrubland, played as grassland".
 * Returns null when the world has no worldCoverClass layer.
 */
export function describeWorldCover(details: WorldDetails, cell: number, gameCoverName?: string): string | null {
  const code = details.worldCoverClass?.[cell]
  if (code === undefined) return null
  const name = details.worldCoverLegend?.[code] ?? `WorldCover class ${code}`
  const share = details.worldCoverSharePct?.[cell]
  const base = share === undefined ? name : `${name} (${share}% of the cell)`
  if (!gameCoverName || name.toLowerCase() === gameCoverName.toLowerCase()) return base
  return `${base}, played as ${gameCoverName.toLowerCase()}`
}

/** Parse the raw text of a world file (JSON), with a friendly error on malformed JSON. */
export function parseWorldText(text: string, expectedId?: string): LoadedWorld {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch (err) {
    throw new WorldLoadError('parse', 'This map file could not be read. It may have been cut off while downloading.', [
      err instanceof Error ? err.message : String(err),
    ])
  }
  return parseWorldFile(doc, expectedId)
}
