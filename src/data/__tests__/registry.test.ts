import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInitialState } from '../../simulation/engine'
import { deriveTerrain } from '../../simulation/engine/terrain'
import { coverCode } from '../../simulation/types'
import { generateProceduralWorld } from '../../simulation/world/procedural'
import { WORLDS } from '../loaders/realData'
import { REAL_WORLDS } from '../realWorlds.generated'
import {
  DEFAULT_WORLD_ID,
  FALLBACK_WORLD_ID,
  getWorldListing,
  listWorlds,
  loadWorld,
  loadWorldWithFallback,
  worldFileUrl,
} from '../registry'
import { WorldLoadError } from '../worldFile'

const DATA_DIR = resolve(__dirname, '../../../public/world-data')

/** fetch stand-in that serves public/world-data from disk and records requested URLs. */
function diskFetch(requests: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    requests.push(url)
    const file = decodeURIComponent(url.split('/world-data/')[1] ?? '')
    try {
      return new Response(readFileSync(resolve(DATA_DIR, file), 'utf8'), { status: 200 })
    } catch {
      return new Response('not found', { status: 404 })
    }
  }) as typeof fetch
}

describe('world registry', () => {
  it('lists the procedural fallback first and every exported real-data world', () => {
    const worlds = listWorlds()
    expect(worlds[0].meta.id).toBe('amoria-valley')
    expect(worlds[0].meta.kind).toBe('procedural')
    expect(worlds[0].source).toEqual({ type: 'procedural', seed: 1 })
    const ids = worlds.map((w) => w.meta.id)
    expect(new Set(ids).size).toBe(ids.length)
    const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json')
    expect(worlds.filter((w) => w.source.type === 'file').map((w) => (w.source as { file: string }).file).sort()).toEqual(files.sort())
    expect(ids).toContain('kaani-machakos')
  })

  it('keeps the generated registry in sync with the files on disk', () => {
    const index = JSON.parse(readFileSync(resolve(DATA_DIR, 'index.json'), 'utf8')) as { worlds: { id: string; file: string }[] }
    expect(index.worlds.map((w) => w.id).sort()).toEqual(REAL_WORLDS.map((r) => r.meta.id).sort())
    for (const rec of REAL_WORLDS) {
      const doc = JSON.parse(readFileSync(resolve(DATA_DIR, rec.file), 'utf8'))
      for (const key of ['id', 'name', 'kind', 'description', 'provenance', 'bbox', 'crs', 'sources'] as const) {
        expect(rec.meta[key]).toEqual(doc.meta[key])
      }
    }
  })

  it('prefers the real-data world by default and falls back to the valley', () => {
    expect(DEFAULT_WORLD_ID).toBe('kaani-machakos')
    expect(FALLBACK_WORLD_ID).toBe('amoria-valley')
  })

  it('exposes real-data worlds to the UI catalog contract', () => {
    expect(WORLDS.map((w) => w.meta.id)).toEqual(REAL_WORLDS.map((r) => r.meta.id))
    for (const w of WORLDS) expect(typeof w.load).toBe('function')
  })

  it('builds file URLs under the deploy base path', () => {
    expect(worldFileUrl('a.json', '/')).toBe('/world-data/a.json')
    expect(worldFileUrl('a.json', '/amoria')).toBe('/amoria/world-data/a.json')
    expect(worldFileUrl('a b.json', 'https://x.org/game/')).toBe('https://x.org/game/world-data/a%20b.json')
  })
})

describe('loadWorld', () => {
  it('loads the procedural valley identical to the generator, as a defensive copy', async () => {
    const a = await loadWorld('amoria-valley')
    const ref = generateProceduralWorld(1)
    expect(Array.from(a.cover)).toEqual(Array.from(ref.cover))
    expect(a.meta.kind).toBe('procedural')
    a.cover[0] = 99
    const b = await loadWorld('amoria-valley')
    expect(b.cover[0]).toBe(ref.cover[0])
  })

  it('fetches and validates the real-data world from the base path', async () => {
    const requests: string[] = []
    const w = await loadWorld('kaani-machakos', { fetchFn: diskFetch(requests), baseUrl: '/amoria/' })
    expect(requests).toEqual(['/amoria/world-data/kaani-machakos.json'])
    expect(w.meta.id).toBe('kaani-machakos')
    expect(w.elevationM.length).toBe(w.width * w.height)
  })

  it('keeps the loaded meta identical to the registry listing, acquisition dates included', async () => {
    for (const rec of REAL_WORLDS) {
      const w = await loadWorld(rec.meta.id, { fetchFn: diskFetch() })
      const listed = getWorldListing(rec.meta.id)!.meta
      expect(w.meta).toEqual(listed)
      expect(w.meta.sources).toEqual(rec.meta.sources)
      for (const s of w.meta.sources ?? []) expect(s.acquired).toBeTruthy()
    }
  })

  it('throws friendly errors for unknown ids, HTTP failures and network errors', async () => {
    await expect(loadWorld('atlantis')).rejects.toMatchObject({ code: 'unknown-world' })
    const notFound = (async () => new Response('', { status: 404 })) as unknown as typeof fetch
    await expect(loadWorld('kaani-machakos', { fetchFn: notFound })).rejects.toMatchObject({ code: 'network' })
    const offline = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const err = await loadWorld('kaani-machakos', { fetchFn: offline }).catch((e) => e)
    expect(err).toBeInstanceOf(WorldLoadError)
    expect(err.userMessage).toMatch(/could not be downloaded/)
  })

  it('reports a damaged download as a parse error', async () => {
    const truncated = (async () => new Response('{"format":"amoria-world","formatVers', { status: 200 })) as unknown as typeof fetch
    await expect(loadWorld('kaani-machakos', { fetchFn: truncated })).rejects.toMatchObject({ code: 'parse' })
  })

  it('falls back to the procedural valley when a real world cannot load', async () => {
    const notFound = (async () => new Response('', { status: 500 })) as unknown as typeof fetch
    const r = await loadWorldWithFallback('kaani-machakos', { fetchFn: notFound })
    expect(r.fellBack).toBe(true)
    expect(r.world.meta.id).toBe('amoria-valley')
    expect(r.error?.code).toBe('network')
    const ok = await loadWorldWithFallback('kaani-machakos', { fetchFn: diskFetch() })
    expect(ok.fellBack).toBe(false)
  })
})

describe('routing parity between the geodata pipeline and the engine', () => {
  it('reproduces the pipeline outlet, catchment, fill and channel network', async () => {
    const world = await loadWorld('kaani-machakos', { fetchFn: diskFetch() })
    const t = deriveTerrain(world)
    const stats = world.details.stats as { mainOutletCell: [number, number]; mainCatchmentCells: number }
    const params = (world.details.generated as { parameters: { channelMinCells: number } }).parameters
    const n = t.width * t.height
    // main outlet: the edge cell with the largest accumulation, as the pipeline picked it
    let outlet = -1
    for (let i = 0; i < n; i++) if (t.flowTo[i] < 0 && (outlet < 0 || t.flowAccumulation[i] > t.flowAccumulation[outlet])) outlet = i
    expect([Math.floor(outlet / t.width), outlet % t.width]).toEqual(stats.mainOutletCell)
    expect(t.flowAccumulation[outlet]).toBe(stats.mainCatchmentCells)
    // the exported elevation is already depression-filled, so the engine adds no further fill
    let raised = 0
    for (let i = 0; i < n; i++) if (t.filledElevationM[i] - world.elevationM[i] > 1e-6) raised++
    expect(raised).toBe(0)
    // channel layer = cells with accumulation >= channelMinCells, plus observed WorldCover water
    const water = coverCode('water')
    const observed = world.details.observedCover!
    let byAreaCount = 0
    for (let i = 0; i < n; i++) {
      const byArea = t.flowAccumulation[i] >= params.channelMinCells
      if (byArea) byAreaCount++
      if (byArea) expect(world.channel![i]).toBe(1)
      else if (world.channel![i] === 1) expect(observed[i]).toBe(water)
    }
    expect(byAreaCount).toBeGreaterThan(100)
  })
})

describe('slope parity between the geodata pipeline and the engine', () => {
  it('gives the recorded 100 m Horn slope summary when the engine derives terrain from the file', async () => {
    const world = await loadWorld('kaani-machakos', { fetchFn: diskFetch() })
    const t = deriveTerrain(world)
    const rec = (world.details.stats as { slope: { grid100m: { mean: number; median: number; pctAbove30: number; count: number } } }).slope.grid100m
    const values = Array.from(t.slope)
    expect(values.length).toBe(rec.count)
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    expect(mean).toBeCloseTo(rec.mean, 3)
    const sorted = [...values].sort((a, b) => a - b)
    const median = (sorted[values.length / 2 - 1] + sorted[values.length / 2]) / 2
    expect(median).toBeCloseTo(rec.median, 3)
    const steep = (100 * values.filter((v) => v > 0.3).length) / values.length
    expect(steep).toBeCloseTo(rec.pctAbove30, 1)
  })
})

describe('DEM void fills', () => {
  it('loads the demFilledPct layer and it agrees with the recorded stats', async () => {
    const world = await loadWorld('kaani-machakos', { fetchFn: diskFetch() })
    const layer = world.details.demFilledPct!
    const stats = world.details.stats as { demVoidFilledCells: number; demVoidFilledMaxCellPct: number }
    expect(layer.length).toBe(world.width * world.height)
    expect(layer.filter((v) => v > 0).length).toBe(stats.demVoidFilledCells)
    expect(Math.max(...layer)).toBe(Math.round(stats.demVoidFilledMaxCellPct))
  })
})

describe('real-data world in the simulation', () => {
  it('starts a game whose drainage reaches the map edge and forms one main catchment', async () => {
    const world = await getWorldListing('kaani-machakos')!.load({ fetchFn: diskFetch() })
    const state = createInitialState(world, 7)
    const { width, height, flowTo, flowAccumulation, channel } = state.terrain
    // no interior sinks: every cell without a receiver is on the edge
    for (let i = 0; i < flowTo.length; i++) {
      if (flowTo[i] >= 0) continue
      const x = i % width
      const z = (i - x) / width
      expect(x === 0 || z === 0 || x === width - 1 || z === height - 1).toBe(true)
    }
    let outlet = -1
    for (let i = 0; i < flowTo.length; i++) if (flowTo[i] < 0 && (outlet < 0 || flowAccumulation[i] > flowAccumulation[outlet])) outlet = i
    expect(flowAccumulation[outlet] / flowTo.length).toBeGreaterThan(0.8)
    expect(channel[outlet]).toBe(1)
    // the routed channel network is continuous down to the outlet
    let i = state.terrain.flowTo.findIndex((_, k) => channel[k] === 1 && flowAccumulation[k] > 300 && flowAccumulation[k] < 600)
    expect(i).toBeGreaterThanOrEqual(0)
    let steps = 0
    while (flowTo[i] >= 0 && steps++ < 500) {
      expect(channel[flowTo[i]]).toBe(1)
      i = flowTo[i]
    }
    expect(i).toBe(outlet)
    // the village is inhabited and the state is numerically sane
    expect(state.community.population).toBeGreaterThan(0)
    expect(state.community.housingCapacity).toBeGreaterThan(0)
    for (const v of state.layers.soilHealth) expect(Number.isFinite(v)).toBe(true)
    expect(state.meta.kind).toBe('real-data-derived')
  })
})

describe('docs/DATA_SOURCES.md', () => {
  it('quotes the channel and catchment counts of the shipped world file', () => {
    const doc = readFileSync(resolve(__dirname, '../../../docs/DATA_SOURCES.md'), 'utf8')
    const stats = JSON.parse(readFileSync(resolve(DATA_DIR, 'kaani-machakos.json'), 'utf8')).meta.stats as {
      channelCells: number
      waterBodyCells: number
      mainCatchmentCells: number
    }
    expect(doc).toContain(`${stats.channelCells} channel cells`)
    expect(doc).toContain(`${stats.waterBodyCells} WorldCover water cell`)
    expect(doc).toContain(`(${stats.mainCatchmentCells} cells) drains to one outlet`)
  })

  it('quotes the slope, pixel density and void-fill figures of the shipped world file', () => {
    const doc = readFileSync(resolve(__dirname, '../../../docs/DATA_SOURCES.md'), 'utf8')
    const stats = JSON.parse(readFileSync(resolve(DATA_DIR, 'kaani-machakos.json'), 'utf8')).meta.stats as {
      slope: { grid100m: { mean: number; median: number }; native30m: { mean: number; median: number } }
      worldCoverPixelsPerCell: { mean: number }
      demVoidFilledPixels: number
      demPixelsInGrid: number
    }
    expect(doc).toContain(`mean ${stats.slope.grid100m.mean} and median ${stats.slope.grid100m.median} on the 100 m grid`)
    expect(doc).toContain(`the mean is ${stats.slope.native30m.mean} and the median ${stats.slope.native30m.median}`)
    expect(doc).toContain(`${stats.worldCoverPixelsPerCell.mean.toFixed(1)} on average`)
    expect(doc).toContain(`${stats.demVoidFilledPixels} of the ${stats.demPixelsInGrid.toLocaleString('en-US')} DEM pixels`)
  })
})
