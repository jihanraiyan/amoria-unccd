// Fix round 4: stable tree counts across ordinary seasons, overlay ghosting of props, overlay
// fog push, snapshot-aware cursor announcement, the runoff wave cue and buffer hygiene.
import { describe, expect, it, vi } from 'vitest'
import { DataTexture, ShaderLib, Vector2, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three'
import { createInitialState, generateProceduralWorld, step } from '../../simulation'
import { coverCode, structureCode, type SimulationState } from '../../simulation/types'
import { terrainHeights } from '../core/coords'
import { frameFromSim, type WorldFrame } from '../core/frame'
import { easeOverlayMix } from '../core/overlayFade'
import { CUE_CODE, OVERLAYS, buildOverlayTextures, overlayDomain, overlayValues } from '../core/overlays'
import { FULL_STAND_VEG, VEG_KIND, VEG_SLOTS, computeVegetation, forestTreeCount, seasonFreeVegetation } from '../core/placement'
import { CAMERA_LIMITS } from '../controls/cameraMath'
import { cursorAnnouncement } from '../controls/announce'
import { DynamicGeometry } from '../controls/dynamicGeometry'
import { linearFog, moodFor, overlayFogRange } from '../effects/atmosphereData'
import { OVERLAY_GHOST, createPropMaterials, ghostScale } from '../props/materials'
import { createTerrainMaterial } from '../terrain/terrainMaterial'
import { makeFrame, withLayers } from './fixtures'

const FOREST = coverCode('forest')
const GRASS = coverCode('grassland')
const TREE_KINDS = new Set<number>([VEG_KIND.conifer, VEG_KIND.pineTall, VEG_KIND.pineRound, VEG_KIND.broadleaf, VEG_KIND.oak, VEG_KIND.poplar])

/** Trees per forest cell, and occupied slots per grassland cell. */
function counts(frame: WorldFrame) {
  const t = computeVegetation(frame, terrainHeights(frame.terrain), { forestSlots: 4 })
  const n = frame.terrain.width * frame.terrain.height
  const trees = new Int8Array(n)
  const grass = new Int8Array(n)
  for (let i = 0; i < n; i++)
    for (let k = 0; k < VEG_SLOTS; k++) {
      const kind = t.kind[i * VEG_SLOTS + k]
      if (frame.layers.cover[i] === FOREST && TREE_KINDS.has(kind)) trees[i]++
      if (frame.layers.cover[i] === GRASS && kind >= 0) grass[i] += 1 << k
    }
  return { trees, grass }
}

function compile(mat: { onBeforeCompile: (s: WebGLProgramParametersWithUniforms, r: WebGLRenderer) => void }) {
  const shader = { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader, uniforms: {} } as unknown as WebGLProgramParametersWithUniforms
  mat.onBeforeCompile(shader, {} as WebGLRenderer)
  return shader
}

describe('tree and bush counts do not follow the seasonal greenness swing', () => {
  it('two consecutive normal seasons on the valley give identical per-cell forest and grassland props', () => {
    let s: SimulationState = createInitialState(generateProceduralWorld(7), 7)
    const seen: { season: string; trees: Int8Array; grass: Int8Array; meanVeg: number }[] = []
    while (seen.length < 4) {
      const w = s.weather[s.step]
      s = step(s).state
      if (w.kind !== 'normal') {
        seen.length = 0
        continue
      }
      const f = frameFromSim(s)
      let sum = 0
      let cnt = 0
      for (let i = 0; i < s.layers.cover.length; i++)
        if (s.layers.cover[i] === FOREST) {
          sum += s.layers.vegetation[i]
          cnt++
        }
      seen.push({ season: w.season, ...counts(f), meanVeg: sum / cnt })
    }
    // the model's forest cover really does swing between the seasons
    const wet = seen.find((x) => x.season === 'wet')!
    const dry = seen.find((x) => x.season === 'dry')!
    expect(wet.meanVeg - dry.meanVeg).toBeGreaterThan(0.04)
    // but no tree, bush or shrub appears or disappears
    for (let k = 1; k < seen.length; k++) {
      expect(seen[k].season).not.toBe(seen[k - 1].season)
      expect(Array.from(seen[k].trees)).toEqual(Array.from(seen[k - 1].trees))
      expect(Array.from(seen[k].grass)).toEqual(Array.from(seen[k - 1].grass))
    }
    expect(seen[0].trees.reduce((a, b) => a + b, 0)).toBeGreaterThan(1000)
  })

  it('season-free vegetation cancels the wet/dry target swing and saturates stand counts', () => {
    // the same relative condition in both seasons
    expect(seasonFreeVegetation(FOREST, 0.88 * 0.82, 'dry')).toBeCloseTo(seasonFreeVegetation(FOREST, 0.92 * 0.82, 'wet'), 6)
    expect(seasonFreeVegetation(GRASS, 0.45 * 0.8, 'dry')).toBeCloseTo(seasonFreeVegetation(GRASS, 0.68 * 0.8, 'wet'), 6)
    // covers without a seasonal target pass through
    expect(seasonFreeVegetation(coverCode('urban'), 0.3, 'dry')).toBe(0.3)
    expect(forestTreeCount(FULL_STAND_VEG.forest, 4)).toBe(4)
    expect(forestTreeCount(0.95, 4)).toBe(4)
    expect(forestTreeCount(0.3, 4)).toBeLessThan(4)
    expect(forestTreeCount(0.3, 4)).toBeGreaterThan(0)
    expect(forestTreeCount(0.02, 4)).toBe(0)
  })

  it('clearing or degrading a forest still removes trees', () => {
    const base = withLayers(makeFrame(6, 6, { season: 'dry' }), (l) => {
      l.cover.fill(FOREST)
      l.baselineCover.fill(FOREST)
      l.vegetation.fill(0.72)
    })
    const full = counts(base).trees
    expect(full[14]).toBe(4)
    const degraded = withLayers(base, (l) => {
      l.vegetation[14] = 0.25
    })
    expect(counts(degraded).trees[14]).toBeLessThan(full[14])
    expect(counts(degraded).trees[14]).toBeGreaterThan(0)
    const cleared = withLayers(base, (l) => {
      l.cover[14] = coverCode('bare')
      l.vegetation[14] = 0.05
    })
    expect(counts(cleared).trees[14]).toBe(0)
    const t = computeVegetation(cleared, terrainHeights(cleared.terrain), { forestSlots: 4 })
    let stumps = 0
    for (let k = 0; k < VEG_SLOTS; k++) if (t.kind[14 * VEG_SLOTS + k] === VEG_KIND.stump) stumps++
    expect(stumps).toBeGreaterThan(0)
  })
})

describe('props give way to the overlay', () => {
  it('ghosting shrinks props toward their base and fades them, per view', () => {
    expect(ghostScale('vegetation', 0)).toEqual({ height: 1, width: 1 })
    const veg = ghostScale('vegetation', 1)
    expect(veg.height).toBeCloseTo(OVERLAY_GHOST.vegetation.height)
    // a forest cell's four trees then hide well under a fifth of the cell from the default view
    expect(veg.height * veg.width).toBeLessThan(0.15)
    // houses keep a faint footprint for orientation
    const solid = ghostScale('solid', 1)
    expect(solid.height).toBeGreaterThan(0.2)
    expect(solid.width).toBeGreaterThan(0.8)
    expect(ghostScale('road', 1)).toEqual({ height: 1, width: 1 })
    const a = createPropMaterials()
    const b = createPropMaterials()
    expect(a.overlayMix).not.toBe(b.overlayMix)
    const shader = compile(a.vegetation)
    expect(shader.vertexShader).toContain('transformed.y *= mix( 1.0, uGhostHeight, uOverlayMix );')
    expect(shader.vertexShader).toContain('uOverlayMix * uGhostColor')
    expect(shader.vertexShader.indexOf('uGhostHeight, uOverlayMix')).toBeLessThan(shader.vertexShader.indexOf('transformed.x += sin( ph ) * k;'))
    expect(shader.uniforms.uOverlayMix).toBe(a.overlayMix)
    expect(compile(a.solid).vertexShader).toContain('uGhostWidth')
    const spies = [a.vegetation, a.solid, a.ground, a.road].map((m) => vi.spyOn(m, 'dispose'))
    a.dispose()
    for (const s of spies) expect(s).toHaveBeenCalled()
  })

  it('the shared overlay easing lands exactly and snaps under reduced motion', () => {
    let v = 0
    for (let k = 0; k < 120; k++) v = easeOverlayMix(v, 1, 1 / 60, false)
    expect(v).toBe(1)
    expect(easeOverlayMix(0.2, 0, 1 / 60, true)).toBe(0)
    const one = easeOverlayMix(0, 1, 1 / 60, false)
    expect(one).toBeGreaterThan(0)
    expect(one).toBeLessThan(0.2)
  })
})

describe('fog does not wash out overlays', () => {
  it('heavy rain and drought fog clears the whole visible map at full overlay mix', () => {
    const extent = 32
    const farthest = CAMERA_LIMITS.maxDistance + 2 * Math.SQRT2 * extent
    for (const m of [moodFor('wet', 'heavy-rain'), moodFor('dry', 'drought'), moodFor('wet', 'normal')]) {
      const [near0, far0] = overlayFogRange(m.fogNear, m.fogFar, extent, 0)
      expect([near0, far0]).toEqual([m.fogNear, m.fogFar])
      const [near, far] = overlayFogRange(m.fogNear, m.fogFar, extent, 1)
      expect(linearFog(farthest, near, far)).toBe(0)
      // the default viewing distance (about 61) was fogged 0.24 in heavy rain before
      expect(linearFog(61, near, far)).toBe(0)
      // half way through the fade the fog is part way out
      const [nearHalf] = overlayFogRange(m.fogNear, m.fogFar, extent, 0.5)
      expect(nearHalf).toBeGreaterThan(m.fogNear)
      expect(nearHalf).toBeLessThan(near)
    }
    const rain = moodFor('wet', 'heavy-rain')
    expect(linearFog(61, rain.fogNear, rain.fogFar)).toBeGreaterThan(0.2)
  })
})

describe('keyboard cursor announcement', () => {
  it('describes the layers it is given, so a past snapshot is described as shown', () => {
    const f = makeFrame(6, 6)
    const live = withLayers(f, (l) => {
      l.cover[7] = coverCode('forest')
    })
    const past = withLayers(f, (l) => {
      l.cover[7] = coverCode('urban')
      l.structure[7] = structureCode('housing')
    })
    expect(cursorAnnouncement(7, f.terrain, live.layers, 'inspect')).toBe('Parcel 2, 2: forest. Enter to inspect.')
    expect(cursorAnnouncement(7, f.terrain, past.layers, 'inspect', true)).toBe('Parcel 2, 2 (past view): urban, housing. Enter to inspect.')
  })
})

describe('runoff overlay cue shows the same variable as its colors', () => {
  it('wavy lines follow local runoff even where little water flows in from upslope', () => {
    expect(OVERLAYS.runoff.cue.pattern).toBe('waves')
    expect(CUE_CODE.waves).toBe(8)
    const f = { ...makeFrame(6, 6), fieldsReady: true }
    for (let i = 0; i < 36; i++) {
      f.fields.runoffMm[i] = i
      f.fields.flowMm[i] = 0
    }
    const values = overlayValues('runoff', f)
    expect(Array.from(values)).toEqual(Array.from(f.fields.runoffMm))
    const domain = overlayDomain('runoff', values)
    const tex = buildOverlayTextures('runoff', values, domain)
    // heavy local runoff with no upstream flow still carries a strong pattern
    expect(tex.cue[35 * 4]).toBeGreaterThan(200)
    expect(tex.cue[0]).toBe(0)
    const tx = new DataTexture(new Uint8Array(4), 1, 1)
    const shader = compile(
      createTerrainMaterial({ uOverlayTex: { value: tx }, uCueTex: { value: tx }, uOverlayMix: { value: 0 }, uCueKind: { value: 0 }, uGridSize: { value: new Vector2(1, 1) }, uContourStep: { value: 1 } }),
    )
    expect(shader.fragmentShader).toContain('else if (kind == 8)')
    expect(OVERLAYS.runoff.cue.description).toMatch(/same measure as the colors/)
  })
})

describe('DynamicGeometry frees replaced buffers', () => {
  it('disposes the old GPU buffers when it grows, not when it reuses them', () => {
    const dg = new DynamicGeometry({ position: 3 }, true, 4)
    const disposed = vi.fn()
    dg.geometry.addEventListener('dispose', disposed)
    dg.write({ position: new Float32Array(12) }, 4, new Uint32Array(6))
    expect(disposed).not.toHaveBeenCalled()
    const old = dg.geometry.getAttribute('position')
    dg.write({ position: new Float32Array(30) }, 10, new Uint32Array(12))
    expect(disposed).toHaveBeenCalledTimes(1)
    expect(dg.geometry.getAttribute('position')).not.toBe(old)
    expect(dg.capacity).toBeGreaterThanOrEqual(10)
  })
})
