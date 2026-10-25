import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deriveTerrain } from '../../simulation/engine/terrain'
import { LAND_COVERS, STRUCTURES, coverCode, structureCode } from '../../simulation/types'
import { WorldLoadError, describeWorldCover, parseWorldFile, parseWorldText } from '../worldFile'

const REAL_FILE = resolve(__dirname, '../../../public/world-data/kaani-machakos.json')
const realText = () => readFileSync(REAL_FILE, 'utf8')

/** A small, valid world document; tests break one thing at a time. */
function tinyDoc(n = 8) {
  const cells = n * n
  const cover = new Array(cells).fill(coverCode('grassland'))
  const structure = new Array(cells).fill(0)
  const level = new Array(cells).fill(0)
  const channel = new Array(cells).fill(0)
  for (let z = 0; z < n; z++) {
    channel[z * n + 3] = 1
    cover[z * n + 3] = coverCode('water')
  }
  structure[n + 1] = structureCode('housing')
  level[n + 1] = 2
  cover[n + 1] = coverCode('urban')
  return {
    format: 'amoria-world',
    formatVersion: 1,
    meta: {
      id: 'tiny',
      name: 'Tiny',
      kind: 'real-data-derived',
      description: 'test',
      provenance: 'test provenance',
      bbox: [37, -2, 37.1, -1.9],
      crs: 'EPSG:32737',
      sources: [{ name: 'Test DEM', version: '1', license: 'CC BY 4.0', url: 'https://example.org' }],
      attribution: ['(c) test'],
      disclosures: ['not a measurement'],
      places: [{ name: 'Somewhere', place: 'village', row: 1, col: 1, osmNodeId: 5 }],
    },
    width: n,
    height: n,
    cellSizeM: 100,
    coverLegend: [...LAND_COVERS],
    structureLegend: [...STRUCTURES],
    layers: {
      elevationCm: Array.from({ length: cells }, (_, i) => 150_000 - (i % n) * 100),
      cover,
      structure,
      structureLevel: level,
      protected: new Array(cells).fill(0),
      channel,
    },
  }
}

function expectInvalid(doc: unknown, match: RegExp, code = 'invalid') {
  try {
    parseWorldFile(doc)
  } catch (err) {
    expect(err).toBeInstanceOf(WorldLoadError)
    const e = err as WorldLoadError
    expect(e.code).toBe(code)
    expect(e.userMessage.length).toBeGreaterThan(10)
    expect(e.issues.join(' | ')).toMatch(match)
    return
  }
  throw new Error('expected parseWorldFile to throw')
}

describe('parseWorldFile', () => {
  it('converts a valid document into the WorldInput contract', () => {
    const w = parseWorldFile(tinyDoc())
    expect(w.width).toBe(8)
    expect(w.elevationM).toBeInstanceOf(Float32Array)
    expect(w.elevationM[0]).toBeCloseTo(1500, 5)
    expect(w.cover).toBeInstanceOf(Uint8Array)
    expect(w.structure?.[9]).toBe(structureCode('housing'))
    expect(w.structureLevel?.[9]).toBe(2)
    expect(w.channel?.[3]).toBe(1)
    expect(w.meta.sources?.[0].license).toBe('CC BY 4.0')
    expect(w.details.places[0].name).toBe('Somewhere')
    expect(w.details.attribution).toEqual(['(c) test'])
  })

  it('remaps covers when the file legend uses a different order', () => {
    const doc = tinyDoc()
    const legend = [...LAND_COVERS].reverse()
    doc.coverLegend = legend
    doc.layers.cover = doc.layers.cover.map((c) => legend.indexOf(LAND_COVERS[c]))
    const w = parseWorldFile(doc)
    expect(w.cover[3]).toBe(coverCode('water'))
    expect(w.cover[9]).toBe(coverCode('urban'))
  })

  it('rejects unknown cover names', () => {
    const doc = tinyDoc()
    doc.coverLegend = [...LAND_COVERS.slice(0, 7), 'lava'] as never
    expectInvalid(doc, /lava/)
  })

  it('rejects wrong format and newer versions with distinct codes', () => {
    expectInvalid({ ...tinyDoc(), format: 'something-else' }, /format/)
    expectInvalid({ ...tinyDoc(), formatVersion: 2 }, /formatVersion 2/, 'unsupported-version')
  })

  it('rejects layers of the wrong length', () => {
    const doc = tinyDoc()
    doc.layers.cover = doc.layers.cover.slice(1)
    expectInvalid(doc, /"cover" has 63 values, expected 64/)
  })

  it('rejects non-finite and out-of-range values', () => {
    const a = tinyDoc()
    a.layers.elevationCm[5] = Number.NaN
    expectInvalid(a, /elevationCm/)
    const b = tinyDoc()
    b.layers.elevationCm[5] = 2_000_000
    expectInvalid(b, /elevationCm/)
    const c = tinyDoc()
    c.layers.cover[0] = 99
    expectInvalid(c, /"cover" has 1 invalid/)
    const d = tinyDoc()
    d.layers.structureLevel[0] = 1.5
    expectInvalid(d, /structureLevel/)
  })

  it('rejects inconsistent structures and channels', () => {
    const a = tinyDoc()
    a.layers.structureLevel[9] = 0
    expectInvalid(a, /housing level/)
    const b = tinyDoc()
    b.layers.structure[3] = structureCode('market')
    expectInvalid(b, /channel cells carry a structure other than a bridge/)
    const c = tinyDoc()
    c.layers.cover[3] = coverCode('cropland')
    expectInvalid(c, /channel cells are not water/)
  })

  it('accepts a road on a channel as a bridge that keeps its water cover', () => {
    const doc = tinyDoc()
    doc.layers.structure[3] = structureCode('road')
    const w = parseWorldFile(doc)
    expect(w.structure?.[3]).toBe(structureCode('road'))
    expect(w.cover[3]).toBe(coverCode('water'))
  })

  it('rejects structures that do not match their cover', () => {
    // housing on an open water body that is not a channel (like row 45, column 63 in Kaani)
    const a = tinyDoc()
    a.layers.cover[20] = coverCode('water')
    a.layers.structure[20] = structureCode('housing')
    a.layers.structureLevel[20] = 1
    expectInvalid(a, /1 housing cells are not on urban cover \(first at row 2, column 4: water\)/)
    expectInvalid(a, /water or wetland cells carry a structure other than a reservoir/)
    // a road through forest
    const b = tinyDoc()
    b.layers.cover[30] = coverCode('forest')
    b.layers.structure[30] = structureCode('road')
    expectInvalid(b, /1 road cells are not on urban cover \(first at row 3, column 6: forest\)/)
    // housing on grassland
    const c = tinyDoc()
    c.layers.cover[9] = coverCode('grassland')
    expectInvalid(c, /housing cells are not on urban cover/)
    // a market on a wetland
    const d = tinyDoc()
    d.layers.cover[40] = coverCode('wetland')
    d.layers.structure[40] = structureCode('market')
    expectInvalid(d, /1 water or wetland cells carry a structure other than a reservoir \(first at row 5, column 0: market\)/)
    // a reservoir on an off-channel water body and a waterworks on cropland are allowed
    const e = tinyDoc()
    e.layers.cover[20] = coverCode('water')
    e.layers.structure[20] = structureCode('reservoir')
    e.layers.cover[30] = coverCode('cropland')
    e.layers.structure[30] = structureCode('waterworks')
    expect(() => parseWorldFile(e)).not.toThrow()
  })

  it('rejects a structure added to the shipped world off urban cover', () => {
    const doc = JSON.parse(realText()) as { width: number; layers: Record<string, number[]> }
    const i = 45 * doc.width + 63
    expect(doc.layers.cover[i]).toBe(coverCode('water'))
    expect(doc.layers.channel[i]).toBe(0)
    doc.layers.structure[i] = structureCode('housing')
    doc.layers.structureLevel[i] = 1
    expectInvalid(doc, /housing cells are not on urban cover \(first at row 45, column 63: water\)/)
  })

  it('requires sources for real-data worlds and validates the bbox', () => {
    const a = tinyDoc()
    delete (a.meta as { sources?: unknown }).sources
    expectInvalid(a, /must list its sources/)
    const b = tinyDoc()
    b.meta.bbox = [38, -2, 37, -1.9]
    expectInvalid(b, /bbox/)
  })

  it('keeps a valid source acquisition date or range and rejects a malformed one', () => {
    const ok = tinyDoc()
    ok.meta.sources = [
      { name: 'A', version: '1', license: 'x', url: 'u', acquired: '2010-12-26/2013-02-28' },
      { name: 'B', version: '1', license: 'x', url: 'u', acquired: '2026-10-25T01:27:50Z' },
      { name: 'C', version: '1', license: 'x', url: 'u', acquired: '2010-12/2015-01' },
      { name: 'D', version: '1', license: 'x', url: 'u' },
    ] as typeof ok.meta.sources
    const w = parseWorldFile(ok)
    expect(w.meta.sources!.map((s) => s.acquired)).toEqual(['2010-12-26/2013-02-28', '2026-10-25T01:27:50Z', '2010-12/2015-01', undefined])
    expect('acquired' in w.meta.sources![3]).toBe(false)
    for (const bad of ['last spring', '2013-02-28/2010-12-26', '2010/2011/2012', '', 7]) {
      const doc = tinyDoc()
      doc.meta.sources = [{ name: 'A', version: '1', license: 'x', url: 'u', acquired: bad }] as unknown as typeof doc.meta.sources
      expectInvalid(doc, /acquired must be an ISO 8601 date/)
    }
  })

  it('requires attribution, disclosures, bbox and crs for real-data worlds', () => {
    const noAttribution = tinyDoc()
    delete (noAttribution.meta as { attribution?: unknown }).attribution
    expectInvalid(noAttribution, /must carry meta\.attribution/)
    const emptyAttribution = tinyDoc()
    emptyAttribution.meta.attribution = []
    expectInvalid(emptyAttribution, /must carry meta\.attribution/)
    const blankAttribution = tinyDoc()
    blankAttribution.meta.attribution = ['  ']
    expectInvalid(blankAttribution, /must carry meta\.attribution/)
    const noDisclosures = tinyDoc()
    noDisclosures.meta.disclosures = []
    expectInvalid(noDisclosures, /must carry meta\.disclosures/)
    const noBbox = tinyDoc()
    delete (noBbox.meta as { bbox?: unknown }).bbox
    expectInvalid(noBbox, /must give meta\.bbox/)
    const noCrs = tinyDoc()
    delete (noCrs.meta as { crs?: unknown }).crs
    expectInvalid(noCrs, /must give meta\.crs/)
  })

  it('requires the channel and protected layers for real-data worlds only', () => {
    const noChannel = tinyDoc()
    delete (noChannel.layers as { channel?: unknown }).channel
    expectInvalid(noChannel, /layer "channel" is missing/)
    const noProtected = tinyDoc()
    delete (noProtected.layers as { protected?: unknown }).protected
    expectInvalid(noProtected, /layer "protected" is missing/)
    const procedural = tinyDoc()
    procedural.meta.kind = 'procedural'
    delete (procedural.layers as { channel?: unknown }).channel
    delete (procedural.layers as { protected?: unknown }).protected
    const w = parseWorldFile(procedural)
    expect(w.channel).toBeUndefined()
    expect(w.protected).toBeUndefined()
  })

  it('validates place coordinates against the grid', () => {
    for (const [row, col] of [
      [-1, 1],
      [1, 8],
      [8, 0],
      [1.5, 2],
      ['1', 2],
    ] as const) {
      const doc = tinyDoc()
      ;(doc.meta.places[0] as Record<string, unknown>).row = row
      ;(doc.meta.places[0] as Record<string, unknown>).col = col
      expectInvalid(doc, /meta\.places\[0\] "Somewhere" has row .*inside the 8 x 8 grid/)
    }
    const unnamed = tinyDoc()
    ;(unnamed.meta.places[0] as Record<string, unknown>).name = ''
    expectInvalid(unnamed, /meta\.places\[0\] needs a name/)
    const notArray = tinyDoc()
    ;(notArray.meta as Record<string, unknown>).places = { name: 'x' }
    expectInvalid(notArray, /meta\.places must be an array/)
    const ok = tinyDoc()
    ;(ok.meta.places[0] as Record<string, unknown>).osmNodeIds = [5, 6]
    ;(ok.meta.places[0] as Record<string, unknown>).osmPlaceTypes = ['village', 'locality']
    const w = parseWorldFile(ok)
    expect(w.details.places).toEqual([
      { name: 'Somewhere', place: 'village', row: 1, col: 1, osmNodeId: 5, osmNodeIds: [5, 6], osmPlaceTypes: ['village', 'locality'] },
    ])
  })

  it('reads and validates the native WorldCover class layer', () => {
    const withClass = () => {
      const doc = tinyDoc() as ReturnType<typeof tinyDoc> & { worldCoverLegend?: unknown }
      const cells = 64
      ;(doc.layers as Record<string, unknown>).worldCoverClass = new Array(cells).fill(20)
      ;(doc.layers as Record<string, unknown>).worldCoverSharePct = new Array(cells).fill(55)
      doc.worldCoverLegend = { '10': 'Tree cover', '20': 'Shrubland', '80': 'Permanent water bodies' }
      return doc
    }
    const w = parseWorldFile(withClass())
    expect(w.details.worldCoverClass![0]).toBe(20)
    expect(w.details.worldCoverSharePct![0]).toBe(55)
    expect(w.details.worldCoverLegend![20]).toBe('Shrubland')
    expect(describeWorldCover(w.details, 0, 'grassland')).toBe('Shrubland (55% of the cell), played as grassland')

    const badCode = withClass()
    ;((badCode.layers as Record<string, number[]>).worldCoverClass)[7] = 25
    expectInvalid(badCode, /worldCoverClass" has 1 values that are not WorldCover codes .*cell 7: 25/)
    const zero = withClass()
    ;((zero.layers as Record<string, number[]>).worldCoverClass)[0] = 0
    expectInvalid(zero, /not WorldCover codes/)
    const noLegend = withClass()
    delete noLegend.worldCoverLegend
    expectInvalid(noLegend, /needs a worldCoverLegend/)
    const unnamedCode = withClass()
    unnamedCode.worldCoverLegend = { '10': 'Tree cover' }
    expectInvalid(unnamedCode, /no name for code\(s\) 20/)
    const badLegend = withClass()
    badLegend.worldCoverLegend = { '21': 'Made up' }
    expectInvalid(badLegend, /worldCoverLegend entry "21"/)
    const badShare = withClass()
    ;((badShare.layers as Record<string, number[]>).worldCoverSharePct)[3] = 101
    expectInvalid(badShare, /worldCoverSharePct/)
  })

  it('reads the optional DEM void-fill layer and rejects shares above 100', () => {
    const doc = tinyDoc()
    const cells = doc.width * doc.height
    expect(parseWorldFile(doc).details.demFilledPct).toBeUndefined()
    const filled = new Array(cells).fill(0)
    filled[5] = 92
    ;(doc.layers as Record<string, unknown>).demFilledPct = filled
    expect(parseWorldFile(doc).details.demFilledPct![5]).toBe(92)
    filled[6] = 101
    expectInvalid(doc, /demFilledPct/)
  })

  it('does not ask a procedural world file for real-data provenance', () => {
    const doc = tinyDoc()
    doc.meta.kind = 'procedural'
    const meta = doc.meta as Record<string, unknown>
    for (const k of ['attribution', 'disclosures', 'bbox', 'crs', 'sources']) delete meta[k]
    const w = parseWorldFile(doc)
    expect(w.meta.kind).toBe('procedural')
    expect(w.details.attribution).toEqual([])
  })

  it('rejects bad sizes before reading layers', () => {
    expectInvalid({ ...tinyDoc(), width: 3 }, /width and height/)
    expectInvalid({ ...tinyDoc(), cellSizeM: -1 }, /cellSizeM/)
  })

  it('checks the expected id', () => {
    expect(() => parseWorldFile(tinyDoc(), 'other')).toThrow(/expected "other"/)
  })

  it('gives a friendly parse error for truncated JSON', () => {
    const text = realText()
    try {
      parseWorldText(text.slice(0, text.length / 2))
      throw new Error('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(WorldLoadError)
      expect((err as WorldLoadError).code).toBe('parse')
    }
  })
})

describe('exported real-data world file', () => {
  const world = parseWorldText(realText(), 'kaani-machakos')
  const n = world.width * world.height

  it('is a 64 x 64 grid of 100 m cells with plausible heights', () => {
    expect(world.width).toBe(64)
    expect(world.height).toBe(64)
    expect(world.cellSizeM).toBe(100)
    for (let i = 0; i < n; i++) {
      expect(Number.isFinite(world.elevationM[i])).toBe(true)
    }
    const min = Math.min(...world.elevationM)
    const max = Math.max(...world.elevationM)
    expect(min).toBeGreaterThan(1000)
    expect(max).toBeLessThan(2500)
    expect(max - min).toBeGreaterThan(200)
  })

  it('has every game ingredient: village, road, river, farms, woodland, open land', () => {
    const count = (code: number, layer: Uint8Array) => layer.reduce((s, v) => s + (v === code ? 1 : 0), 0)
    expect(count(structureCode('housing'), world.structure!)).toBeGreaterThan(20)
    expect(count(structureCode('road'), world.structure!)).toBeGreaterThan(20)
    expect(count(1, world.channel!)).toBeGreaterThan(50)
    expect(count(coverCode('cropland'), world.cover) / n).toBeGreaterThan(0.1)
    expect(count(coverCode('forest'), world.cover) / n).toBeGreaterThan(0.05)
    expect(count(coverCode('grassland'), world.cover) / n).toBeGreaterThan(0.2)
  })

  it('passes the structure and cover checks: housing and roads on urban, nothing on water but bridges', () => {
    expect(() => parseWorldText(realText(), 'kaani-machakos')).not.toThrow()
    let bridges = 0
    for (let i = 0; i < n; i++) {
      const s = world.structure![i]
      const water = world.cover[i] === coverCode('water')
      if (s === structureCode('housing')) expect(world.cover[i]).toBe(coverCode('urban'))
      if (s === structureCode('road') && !water) expect(world.cover[i]).toBe(coverCode('urban'))
      if (water && s !== 0) {
        // the only structure on water is a road crossing it: a bridge
        expect(s).toBe(structureCode('road'))
        bridges++
      }
    }
    // the OSM main roads cross Kaani's streams in a few places
    expect(bridges).toBeGreaterThan(0)
  })

  it('keeps every cell whose most common WorldCover class is open water as water', () => {
    const cls = world.details.worldCoverClass!
    let cells = 0
    for (let i = 0; i < n; i++) {
      if (cls[i] !== 80) continue
      cells++
      expect(world.details.observedCover![i]).toBe(coverCode('water'))
      expect(world.cover[i]).toBe(coverCode('water'))
    }
    expect(cells).toBeGreaterThan(0)
    // the 38% pond beside the stream joins the channel network
    expect(world.channel![43 * world.width + 52]).toBe(1)
  })

  it('protects the map edge', () => {
    for (let x = 0; x < world.width; x++) {
      expect(world.protected![x]).toBe(1)
      expect(world.protected![(world.height - 1) * world.width + x]).toBe(1)
    }
    expect(world.protected![world.width * 10 + 10]).toBe(0)
  })

  it('carries truthful provenance, licences and attribution', () => {
    expect(world.meta.kind).toBe('real-data-derived')
    expect(world.meta.crs).toBe('EPSG:32737')
    expect(world.meta.bbox).toHaveLength(4)
    const names = world.meta.sources!.map((s) => s.name).join(' ')
    expect(names).toMatch(/Copernicus DEM GLO-30/)
    expect(names).toMatch(/WorldCover/)
    expect(names).toMatch(/OpenStreetMap/)
    expect(world.meta.sources!.some((s) => /CC BY 4\.0/.test(s.license))).toBe(true)
    expect(world.details.attribution.join(' ')).toMatch(/ESA WorldCover project 2021/)
    expect(world.details.attribution.join(' ')).toMatch(/Airbus Defence and Space/)
    expect(world.details.attribution.join(' ')).toMatch(/OpenStreetMap contributors/)
    const disclosures = world.details.disclosures.join(' ')
    expect(disclosures).toMatch(/2021/)
    expect(disclosures).toMatch(/Soil health is not measured from satellites/)
    expect(disclosures).toMatch(/100 m game cell/)
    expect(world.details.places.some((p) => p.name === 'Kaani')).toBe(true)
  })

  it('keeps the observed WorldCover majority alongside the game cover', () => {
    const obs = world.details.observedCover!
    let changed = 0
    for (let i = 0; i < n; i++) {
      if (obs[i] !== world.cover[i]) {
        changed++
        // only documented adjustments: channel to water, roads and settlements to urban
        expect([coverCode('water'), coverCode('urban')]).toContain(world.cover[i])
      }
    }
    expect(changed).toBe(world.details.stats?.coverCellsAdjusted)
  })

  it('keeps the native WorldCover class, including shrubland played as grassland', () => {
    const cls = world.details.worldCoverClass!
    const share = world.details.worldCoverSharePct!
    const obs = world.details.observedCover!
    const legend = world.details.worldCoverLegend!
    expect(legend[20]).toBe('Shrubland')
    const stats = world.details.stats as { worldCoverShrubPluralityCells: number; worldCoverMergedWinnerCells: number }
    const toGame: Record<number, string> = { 10: 'forest', 20: 'grassland', 30: 'grassland', 40: 'cropland', 50: 'urban', 60: 'bare', 80: 'water', 90: 'wetland', 95: 'wetland' }
    let shrub = 0
    let merged = 0
    for (let i = 0; i < n; i++) {
      expect(legend[cls[i]]).toBeTruthy()
      expect(share[i]).toBeGreaterThan(0)
      if (cls[i] === 20) shrub++
      if (toGame[cls[i]] !== LAND_COVERS[obs[i]]) merged++
    }
    expect(shrub).toBe(stats.worldCoverShrubPluralityCells)
    expect(shrub).toBeGreaterThan(n * 0.4)
    expect(merged).toBe(stats.worldCoverMergedWinnerCells)
    expect(world.details.disclosures.join(' ')).toContain(`In ${merged} cells this changes which cover wins`)
    const firstShrub = cls.indexOf(20)
    expect(describeWorldCover(world.details, firstShrub, LAND_COVERS[obs[firstShrub]])).toMatch(/^Shrubland \(\d+% of the cell\), played as grassland$/)
  })

  it('exports each place name once, inside the grid', () => {
    const names = world.details.places.map((p) => p.name)
    expect(new Set(names).size).toBe(names.length)
    const kaseve = world.details.places.find((p) => p.name === 'Kaseve')!
    expect(kaseve.place).toBe('village')
    expect(kaseve.osmNodeIds!.length).toBe(2)
  })

  it('records when each source was acquired, and that the years differ', () => {
    const dates = world.details.sourceDates!
    expect(dates['Copernicus DEM GLO-30']).toMatch(/^2010-12-\d\d\/2013-\d\d-\d\d$/)
    expect(dates['ESA WorldCover 10 m 2021']).toBe('2021-01-01/2021-12-31')
    expect(world.meta.sources![0].version).toMatch(/December 2010 to January 2015/)
    expect(world.details.disclosures.join(' ')).toMatch(/elevation and the land cover come from different years/)
  })

  it('has no channel that drains into a non-channel cell', () => {
    const t = deriveTerrain(world)
    let breaks = 0
    for (let i = 0; i < n; i++) if (world.channel![i] && t.flowTo[i] >= 0 && !world.channel![t.flowTo[i]]) breaks++
    expect(breaks).toBe(0)
    expect((world.details.stats as { channelBreaks: number }).channelBreaks).toBe(0)
  })

  it('uses no em dashes in player-facing text', () => {
    const text = JSON.stringify({ meta: world.meta, d: world.details.disclosures })
    expect(text).not.toContain('\u2014')
  })
})
