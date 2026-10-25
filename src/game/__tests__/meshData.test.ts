import { describe, expect, it } from 'vitest'
import { buildTerrainGeometry, computeCellColors, writeVertexColors } from '../terrain/terrainData'
import { WATER_KIND, buildWaterMesh, computeWaterCells, reservoirFill } from '../water/waterData'
import { terrainHeights, sampleBilinear } from '../core/coords'
import { frameFromSim, lastSimulatedWeather, lookOf } from '../core/frame'
import { coverCode, structureCode, type WeatherSeason } from '../../simulation/types'
import { makeFrame, withLayers } from './fixtures'

describe('terrain geometry', () => {
  it('builds a shared-vertex grid with a closed skirt and no NaN', () => {
    const f = makeFrame(6, 5)
    const h = terrainHeights(f.terrain)
    const { geometry, grid } = buildTerrainGeometry(f.terrain, h, 2)
    expect(grid.vx).toBe(13)
    expect(grid.vz).toBe(11)
    const pos = geometry.getAttribute('position').array as Float32Array
    for (const v of pos) expect(Number.isFinite(v)).toBe(true)
    const tri = geometry.getIndex()!.count / 3
    const surfaceTris = 12 * 10 * 2
    const perimeter = 2 * 12 + 2 * 10
    expect(tri).toBe(surfaceTris + perimeter * 2)
    // surface vertices sit on the bilinear height field
    const v = 3 * 13 + 5
    expect(pos[v * 3 + 1]).toBeCloseTo(sampleBilinear(h, f.terrain, pos[v * 3], pos[v * 3 + 2]))
  })

  it('degraded soil shifts ground color toward ochre', () => {
    const healthy = makeFrame(4, 4)
    const degraded = withLayers(healthy, (l) => l.soilHealth.fill(0.15))
    const a = computeCellColors(healthy)
    const b = computeCellColors(degraded)
    // ochre: red up relative to green
    expect(b[0] / b[1]).toBeGreaterThan(a[0] / a[1])
  })

  it('dry season and drought look more parched than the wet season', () => {
    const wet = makeFrame(4, 4)
    const drought = { ...wet, season: 'dry' as const, weather: 'drought' as const }
    const a = computeCellColors(wet)
    const b = computeCellColors(drought)
    expect(b[0] / b[1]).toBeGreaterThan(a[0] / a[1])
  })

  it('writes blended vertex colors', () => {
    const f = withLayers(makeFrame(4, 4), (l) => {
      l.cover.fill(coverCode('forest'))
      l.cover[0] = coverCode('bare')
    })
    const { geometry, grid } = buildTerrainGeometry(f.terrain, terrainHeights(f.terrain), 2)
    writeVertexColors(geometry, grid, f.terrain, computeCellColors(f))
    const col = geometry.getAttribute('color').array as Float32Array
    for (const v of col) expect(Number.isFinite(v)).toBe(true)
    expect(col[0]).not.toBeCloseTo(col[(grid.vx * grid.vz - 1) * 3], 3)
  })
})

describe('water geometry', () => {
  it('covers channel cells and their banks, with depth >= 0 over the channel', () => {
    const f = makeFrame(8, 8)
    for (let z = 0; z < 8; z++) f.terrain.channel[z * 8 + 3] = 1
    const h = terrainHeights(f.terrain)
    const cells = computeWaterCells(f, h)
    expect(cells.kind[3]).toBe(WATER_KIND.river)
    expect(cells.kind[0]).toBe(WATER_KIND.none)
    const mesh = buildWaterMesh(f, h, cells, 2)
    expect(mesh.indices.length).toBeGreaterThan(0)
    // channel column (3) and its two neighbour columns: 3 cells wide x 8 tall x 4 subquads x 2 tris
    expect(mesh.indices.length / 3).toBe(3 * 8 * 4 * 2)
    for (const v of mesh.positions) expect(Number.isFinite(v)).toBe(true)
  })

  it('adds wetland pools, reservoirs and optional flood water', () => {
    const f = withLayers(makeFrame(6, 6), (l) => {
      l.cover[0] = coverCode('wetland')
      l.wetlandStoreMm[0] = 80
      l.cover[1] = coverCode('wetland')
      l.structure[20] = structureCode('reservoir')
    })
    f.fields.flooded[30] = 1
    f.fields.floodDepthM[30] = 1.2
    const frame = { ...f, fieldsReady: true }
    const h = terrainHeights(f.terrain)
    const cells = computeWaterCells(frame, h)
    expect(cells.kind[0]).toBe(WATER_KIND.wetland)
    // a wetland with no ponded water shows no pool
    expect(cells.kind[1]).toBe(WATER_KIND.none)
    expect(cells.kind[20]).toBe(WATER_KIND.reservoir)
    expect(cells.kind[30]).toBe(WATER_KIND.flood)
    expect(cells.level[30]).toBeGreaterThan(h[30])
    // flood water is only drawn once a season has been simulated
    expect(computeWaterCells(f, h).kind[30]).toBe(WATER_KIND.none)
    expect(reservoirFill({ ...frame, reservoirFill: 0 })).toBe(0)
    expect(reservoirFill({ ...frame, reservoirFill: null })).toBeCloseTo(0.6)
    const full = computeWaterCells({ ...frame, reservoirFill: 1 }, h).level[20]
    const empty = computeWaterCells({ ...frame, reservoirFill: 0 }, h).level[20]
    expect(full).toBeGreaterThan(empty)
  })
})

describe('frames', () => {
  it('uses the weather of the most recently simulated season', () => {
    const base = { rainfallMm: 400, petMm: 200, stormIntensity: 1, normalRainfallMm: 400, designed: false }
    const weather: WeatherSeason[] = [
      { ...base, year: 1, season: 'wet', kind: 'normal' },
      { ...base, year: 1, season: 'dry', kind: 'drought' },
    ]
    expect(lastSimulatedWeather({ step: 0, weather })).toBeNull()
    expect(lastSimulatedWeather({ step: 2, weather })?.kind).toBe('drought')
  })

  it('dresses the live view for the season on the date, not the season just played', async () => {
    const { generateProceduralWorld } = await import('../../simulation/world/procedural')
    const { createInitialState, step } = await import('../../simulation/engine')
    let sim = createInitialState(generateProceduralWorld(1), 1)
    for (let k = 0; k < 8; k++) {
      const played = sim.weather[sim.step]
      sim = step(sim).state
      const look = lookOf(frameFromSim(sim))
      // the top bar shows sim.season, so the colours and sky must follow it
      expect(look.season).toBe(sim.season)
      expect(look.season).not.toBe(played.season)
      // a drought's parched land lingers into the next season; a past storm does not keep raining
      expect(look.weather).toBe(played.kind === 'drought' ? 'drought' : 'normal')
    }
  })

  it('shows a past snapshot as the season it ended on', () => {
    const frame = { season: 'wet', weather: 'heavy-rain' } as Parameters<typeof lookOf>[0]
    expect(lookOf(frame)).toEqual({ season: 'wet', weather: 'heavy-rain' })
  })

  it('builds a frame from a live simulation state', async () => {
    const { generateProceduralWorld } = await import('../../simulation/world/procedural')
    const { createInitialState } = await import('../../simulation/engine')
    const sim = createInitialState(generateProceduralWorld(1), 1)
    const frame = frameFromSim(sim)
    expect(frame.fieldsReady).toBe(false)
    expect(frame.terrain.width).toBe(sim.terrain.width)
    const cells = computeWaterCells(frame, terrainHeights(frame.terrain))
    let river = 0
    for (const k of cells.kind) if (k === WATER_KIND.river) river++
    expect(river).toBeGreaterThan(20)
  })
})
