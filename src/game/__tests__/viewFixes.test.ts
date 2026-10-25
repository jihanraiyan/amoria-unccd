import { describe, expect, it } from 'vitest'
import { DataTexture, LinearFilter, NearestFilter, ShaderLib, Vector2, Vector3, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three'
import type { HistoryPoint, Snapshot, WeatherSeason } from '../../simulation/types'
import { TERRAIN_SUB, heightAt, meshHeightAt, sampleBilinear, terrainHeights } from '../core/coords'
import { OVERLAYS, OVERLAY_IDS } from '../core/overlays'
import { buildOutline, buildTiles } from '../controls/highlightData'
import { arrowStep } from '../controls/Interaction'
import { claimGroupLeader, isGroupFollower, isGroupLeader, publishGroupCamera, releaseGroupLeader, subscribeGroupCamera } from '../controls/cameraSync'
import { defaultCameraState } from '../controls/cameraMath'
import { SUN_DIR_RAW, moodFor, shadowHalfExtent, waterGlint, waterSkyColor } from '../effects/atmosphereData'
import { reservoirFillForSnapshot, weatherForSnapshot } from '../scene/snapshotUtils'
import { buildTerrainGeometry } from '../terrain/terrainData'
import { createTerrainMaterial, makeCellTexture, overlayFilterFor, setCellTextureFilter } from '../terrain/terrainMaterial'
import { Color } from 'three'

describe('terrain triangles vs draped geometry', () => {
  it('meshHeightAt matches the built terrain triangles', () => {
    const terrain = (async () => (await import('../../simulation/world/procedural')).generateProceduralWorld(1))()
    return terrain.then(async (w) => {
      const { deriveTerrain } = await import('../../simulation/engine')
      const t = deriveTerrain(w)
      const h = terrainHeights(t)
      const { geometry } = buildTerrainGeometry(t, h, TERRAIN_SUB)
      const pos = geometry.getAttribute('position').array as Float32Array
      const idx = geometry.getIndex()!.array
      // centroids of a spread of surface triangles lie on the mesh plane
      const surface = (t.width * TERRAIN_SUB) * (t.height * TERRAIN_SUB) * 2
      for (let tri = 0; tri < surface; tri += 97) {
        let x = 0
        let y = 0
        let z = 0
        for (let k = 0; k < 3; k++) {
          const v = idx[tri * 3 + k]
          x += pos[v * 3] / 3
          y += pos[v * 3 + 1] / 3
          z += pos[v * 3 + 2] / 3
        }
        expect(meshHeightAt(h, t, TERRAIN_SUB, x, z)).toBeCloseTo(y, 4)
      }
    })
  })

  it('both quality levels use the subdivision the props are placed for: no preview tile or outline vertex is buried', async () => {
    const { generateProceduralWorld } = await import('../../simulation/world/procedural')
    const { deriveTerrain } = await import('../../simulation/engine')
    const t = deriveTerrain(generateProceduralWorld(1))
    const h = terrainHeights(t)
    // TerrainMesh uses TERRAIN_SUB on high and low quality alike
    expect(TERRAIN_SUB).toBe(2)
    const all = Array.from({ length: t.width * t.height }, (_, i) => i)
    const tiles = buildTiles(all, all.map(() => 1), h, t)
    let buried = 0
    let worstSub1 = 0
    for (let v = 0; v < tiles.positions.length / 3; v++) {
      const x = tiles.positions[v * 3]
      const y = tiles.positions[v * 3 + 1]
      const z = tiles.positions[v * 3 + 2]
      if (y < meshHeightAt(h, t, TERRAIN_SUB, x, z)) buried++
      worstSub1 = Math.max(worstSub1, meshHeightAt(h, t, 1, x, z) - y)
    }
    expect(buried).toBe(0)
    // this is why low quality no longer drops to one subdivision
    expect(worstSub1).toBeGreaterThan(0)
    const ring = buildOutline(all.filter((_, i) => i % 7 === 0), h, t, 0.07, 0.07)
    for (let v = 0; v < ring.length / 3; v++) expect(ring[v * 3 + 1]).toBeGreaterThanOrEqual(meshHeightAt(h, t, TERRAIN_SUB, ring[v * 3], ring[v * 3 + 2]))
    // heightAt (used by every prop, road, highlight and the picker) is the drawn surface
    for (let k = 0; k < 4000; k++) {
      const x = ((k * 0.6180339) % 1) * t.width - t.width / 2
      const z = ((k * 0.7548776) % 1) * t.height - t.height / 2
      expect(heightAt(h, t, x, z)).toBeCloseTo(meshHeightAt(h, t, TERRAIN_SUB, x, z), 6)
    }
    // and agrees with the bilinear field at the mesh vertices
    expect(heightAt(h, t, 0.5, -3)).toBeCloseTo(sampleBilinear(h, t, 0.5, -3), 5)
  })
})

describe('overlay texture', () => {
  it('categorical overlays sample nearest, continuous ones linear', () => {
    expect(overlayFilterFor(OVERLAYS.landcover.valueKind)).toBe('nearest')
    for (const id of OVERLAY_IDS) {
      const def = OVERLAYS[id]
      expect(overlayFilterFor(def.valueKind)).toBe(def.valueKind === 'categorical' ? 'nearest' : 'linear')
    }
    const tex = makeCellTexture(2, 2, true, 'linear')
    const v0 = tex.version
    setCellTextureFilter(tex, 'nearest')
    expect(tex.magFilter).toBe(NearestFilter)
    expect(tex.minFilter).toBe(NearestFilter)
    expect(tex.version).toBeGreaterThan(v0)
    setCellTextureFilter(tex, 'linear')
    expect(tex.magFilter).toBe(LinearFilter)
  })

  it('the shader un-premultiplies the overlay and paints it after tone mapping', () => {
    const tex = new DataTexture(new Uint8Array(4), 1, 1)
    const mat = createTerrainMaterial({
      uOverlayTex: { value: tex },
      uCueTex: { value: tex },
      uOverlayMix: { value: 0 },
      uCueKind: { value: 0 },
      uGridSize: { value: new Vector2(1, 1) },
      uContourStep: { value: 1 },
    })
    const shader = { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader, uniforms: {} } as unknown as WebGLProgramParametersWithUniforms
    mat.onBeforeCompile(shader, {} as WebGLRenderer)
    const fs = shader.fragmentShader
    expect(fs).toContain('ov.rgb / max(ov.a, 1e-3)')
    expect(fs).toContain('gl_FragColor.rgb = mix(gl_FragColor.rgb, amOvc * amShade, amHas);')
    expect(fs.indexOf('amOvc * amShade')).toBeGreaterThan(fs.indexOf('#include <tonemapping_fragment>'))
  })
})

describe('snapshot 0 (the world before play)', () => {
  const base = { rainfallMm: 400, petMm: 200, stormIntensity: 1.4, normalRainfallMm: 400, designed: false }
  const weather: WeatherSeason[] = [
    { ...base, year: 1, season: 'wet', kind: 'heavy-rain' },
    { ...base, year: 1, season: 'dry', kind: 'drought' },
  ]
  const snap = { year: 1, season: 'wet' } as Snapshot
  const history = [
    { step: 0, year: 0, season: 'dry', reservoirFillFrac: 0.4 },
    { step: 1, year: 1, season: 'wet', reservoirFillFrac: 0.9 },
  ] as HistoryPoint[]

  it('shows calm weather and the starting reservoir fill', () => {
    expect(weatherForSnapshot(weather, snap, 0)).toBeNull()
    expect(reservoirFillForSnapshot(history, snap, 0)).toBeCloseTo(0.4)
  })

  it('snapshot 1 carries the same label but shows the season it simulated', () => {
    const one = { year: 1, season: 'wet' } as Snapshot
    expect(weatherForSnapshot(weather, one, 1)?.kind).toBe('heavy-rain')
    expect(reservoirFillForSnapshot(history, one, 1)).toBeCloseTo(0.9)
    expect(weatherForSnapshot(weather, { year: 1, season: 'dry' } as Snapshot, 2)?.kind).toBe('drought')
  })

  it('without an index the store run identifies snapshot 0', async () => {
    const { useGame } = await import('../../state/store')
    const first = { year: 1, season: 'wet' } as Snapshot
    const second = { year: 1, season: 'wet' } as Snapshot
    const prev = useGame.getState().snapshots
    useGame.setState({ snapshots: [first, second] })
    try {
      expect(weatherForSnapshot(weather, first)).toBeNull()
      expect(reservoirFillForSnapshot(history, first)).toBeCloseTo(0.4)
      expect(weatherForSnapshot(weather, second)?.kind).toBe('heavy-rain')
      expect(reservoirFillForSnapshot(history, second)).toBeCloseTo(0.9)
    } finally {
      useGame.setState({ snapshots: prev })
    }
  })
})

describe('atmosphere fit', () => {
  it('the shadow frustum covers every map corner as seen from the sun', () => {
    for (const extent of [16, 32, 48]) {
      const dir = new Vector3(...SUN_DIR_RAW).normalize()
      // light-space axes: right is perpendicular to the light in the horizontal plane
      const right = new Vector3(-dir.z, 0, dir.x).normalize()
      const up = new Vector3().crossVectors(right, dir).normalize()
      const e = shadowHalfExtent(extent)
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        for (const y of [0, 6]) {
          const p = new Vector3(x * extent, y, z * extent)
          expect(Math.abs(p.dot(right))).toBeLessThanOrEqual(e)
          expect(Math.abs(p.dot(up))).toBeLessThanOrEqual(e)
        }
      }
    }
  })

  it('water reflects a dull sky and a weak glint under heavy rain', () => {
    const clear = moodFor('wet', 'normal')
    const storm = moodFor('wet', 'heavy-rain')
    const lum = (c: Color) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722
    expect(waterGlint(storm)).toBeLessThan(waterGlint(clear) * 0.5)
    const a = waterSkyColor(clear, new Color())
    const b = waterSkyColor(storm, new Color())
    expect(a.equals(b)).toBe(false)
    expect(lum(b)).toBeLessThan(lum(a))
  })
})

describe('keyboard cursor', () => {
  it('arrows move relative to the way the camera faces', () => {
    // looking north (-z): up is -z, right is +x
    expect(arrowStep('ArrowUp', 0, -1)).toEqual([0, -1])
    expect(arrowStep('ArrowRight', 0, -1)).toEqual([1, 0])
    // looking east (+x): up is +x, right is +z
    expect(arrowStep('ArrowUp', 1, 0.2)).toEqual([1, 0])
    expect(arrowStep('ArrowRight', 1, 0.2)).toEqual([0, 1])
    expect(arrowStep('ArrowDown', 1, 0.2)).toEqual([-1, 0])
    expect(arrowStep('KeyW', 0, 1)).toBeNull()
  })
})

describe('camera sync groups', () => {
  it('the touched view leads; the others follow and never publish back', () => {
    const a = Symbol('a')
    const b = Symbol('b')
    const got: symbol[] = []
    const off = subscribeGroupCamera('t', (_, from) => got.push(from))
    expect(isGroupFollower('t', a)).toBe(false)
    claimGroupLeader('t', a)
    expect(isGroupLeader('t', a)).toBe(true)
    expect(isGroupFollower('t', b)).toBe(true)
    publishGroupCamera('t', defaultCameraState(8, 8), a)
    expect(got).toEqual([a])
    claimGroupLeader('t', b)
    expect(isGroupFollower('t', a)).toBe(true)
    releaseGroupLeader('t', a)
    expect(isGroupLeader('t', b)).toBe(true)
    releaseGroupLeader('t', b)
    expect(isGroupFollower('t', a)).toBe(false)
    off()
  })
})
