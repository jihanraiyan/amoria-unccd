import { describe, expect, it } from 'vitest'
import { CAMERA_LIMITS, clampTarget, defaultCameraState, lerp3, sameCameraState } from '../controls/cameraMath'
import { buildOutline, buildTiles, TILE_SUB } from '../controls/highlightData'
import { moodFor } from '../effects/atmosphereData'
import { reservoirFillForSnapshot, seasonIndex, sharedOverlayDomain, weatherForSnapshot } from '../scene/snapshotUtils'
import { terrainHeights } from '../core/coords'
import type { HistoryPoint, Snapshot, WeatherSeason } from '../../simulation/types'
import { makeFrame } from './fixtures'

describe('camera math', () => {
  it('default view is elevated, within distance limits and looks at the map', () => {
    const s = defaultCameraState(64, 64, 3)
    const d = Math.hypot(s.position[0] - s.target[0], s.position[1] - s.target[1], s.position[2] - s.target[2])
    expect(d).toBeGreaterThan(CAMERA_LIMITS.minDistance)
    expect(d).toBeLessThan(CAMERA_LIMITS.maxDistance)
    const polar = Math.acos((s.position[1] - s.target[1]) / d)
    expect(polar).toBeGreaterThan(CAMERA_LIMITS.minPolar)
    expect(polar).toBeLessThan(CAMERA_LIMITS.maxPolar)
  })
  it('clamps targets to the map and compares states', () => {
    expect(clampTarget(100, -100, 64, 64, 2)).toEqual([34, -34])
    expect(clampTarget(1, 2, 64, 64)).toEqual([1, 2])
    const a = defaultCameraState(64, 64)
    expect(sameCameraState(a, { position: [...a.position], target: [...a.target] })).toBe(true)
    expect(sameCameraState(a, { position: [0, 0, 0], target: a.target })).toBe(false)
    expect(lerp3([0, 0, 0], [2, 4, 6], 0.5)).toEqual([1, 2, 3])
  })
})

describe('highlight geometry', () => {
  const f = makeFrame(5, 5)
  const h = terrainHeights(f.terrain)
  it('builds one draped tile per cell with validity per vertex', () => {
    const t = buildTiles([0, 6], [1, 0], h, f.terrain)
    const per = (TILE_SUB + 1) ** 2
    expect(t.positions.length).toBe(2 * per * 3)
    expect(t.state[0]).toBe(1)
    expect(t.state[per]).toBe(0)
    expect(t.indices.length).toBe(2 * TILE_SUB * TILE_SUB * 6)
    for (let v = 0; v < 2 * per; v++) expect(t.positions[v * 3 + 1]).toBeGreaterThan(0)
  })
  it('outlines only the boundary of a region', () => {
    const single = buildOutline([12], h, f.terrain, 0.05, 0.05, 1)
    const pair = buildOutline([12, 13], h, f.terrain, 0.05, 0.05, 1)
    // 4 edges x 2 triangles x 3 vertices x 3 floats
    expect(single.length).toBe(4 * 2 * 9)
    // the shared edge is not drawn: 6 edges
    expect(pair.length).toBe(6 * 2 * 9)
    expect(buildOutline([], h, f.terrain).length).toBe(0)
  })
})

describe('atmosphere moods', () => {
  it('rain only in wet or heavy-rain seasons, dust in drought', () => {
    expect(moodFor('wet', 'heavy-rain').rain).toBe(1)
    expect(moodFor('dry', 'normal').rain).toBe(0)
    expect(moodFor('dry', 'drought').dust).toBe(1)
    expect(moodFor('wet', 'normal').dust).toBe(0)
    expect(moodFor('dry', 'drought').fogFar).toBeLessThan(moodFor('wet', 'normal').fogFar)
  })
})

describe('snapshot helpers', () => {
  const base = { rainfallMm: 1, petMm: 1, stormIntensity: 1, normalRainfallMm: 1, designed: false }
  const weather: WeatherSeason[] = [
    { ...base, year: 1, season: 'wet', kind: 'normal' },
    { ...base, year: 1, season: 'dry', kind: 'drought' },
    { ...base, year: 2, season: 'wet', kind: 'heavy-rain' },
  ]
  const f = makeFrame(4, 4)
  const snap = (year: number, season: 'wet' | 'dry'): Snapshot => ({ year, season, layers: f.layers, fields: f.fields, community: {} as Snapshot['community'], economy: {} as Snapshot['economy'], totals: {} as Snapshot['totals'] })
  it('finds the weather of the season a snapshot shows', () => {
    expect(seasonIndex(1, 'wet')).toBe(0)
    expect(seasonIndex(2, 'wet')).toBe(2)
    expect(weatherForSnapshot(weather, snap(1, 'dry'))?.kind).toBe('drought')
    expect(weatherForSnapshot(weather, snap(9, 'dry'))).toBeNull()
  })
  it('reads reservoir fill from history and shares overlay scales', () => {
    const hist = [{ year: 1, season: 'dry', step: 2, reservoirFillFrac: 0.4 } as HistoryPoint]
    expect(reservoirFillForSnapshot(hist, snap(1, 'dry'))).toBe(0.4)
    expect(reservoirFillForSnapshot(hist, snap(1, 'wet'))).toBeNull()
    const d = sharedOverlayDomain('soil', [snap(1, 'wet'), snap(1, 'dry')], f.terrain)
    expect(d).toEqual([0, 1])
  })
})

describe('camera sync groups', async () => {
  const { getGroupCamera, publishGroupCamera, subscribeGroupCamera } = await import('../controls/cameraSync')
  it('shares a camera between views of one group and skips the sender', () => {
    const a = Symbol('a')
    const b = Symbol('b')
    const seenByA: unknown[] = []
    const seenByB: unknown[] = []
    const offA = subscribeGroupCamera('g', (s, from) => from !== a && seenByA.push(s))
    const offB = subscribeGroupCamera('g', (s, from) => from !== b && seenByB.push(s))
    const cam = defaultCameraState(10, 10)
    publishGroupCamera('g', cam, a)
    expect(seenByA).toHaveLength(0)
    expect(seenByB).toEqual([cam])
    expect(getGroupCamera('g')).toBe(cam)
    offA()
    offB()
    expect(getGroupCamera('g')).toBeNull()
  })
})
