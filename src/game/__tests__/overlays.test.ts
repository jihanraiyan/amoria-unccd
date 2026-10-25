import { describe, expect, it } from 'vitest'
import {
  OVERLAYS,
  OVERLAY_IDS,
  RAMPS,
  buildOverlayTextures,
  cueLevel,
  normalize,
  overlayColor,
  overlayDomain,
  overlayValues,
  rampColor,
  resolveLegend,
} from '../core/overlays'
import type { OverlayId } from '../core/overlays'
import { coverCode, structureCode } from '../../simulation/types'
import { createInitialState, environmentalSensitivity, erosionSusceptibility, generateProceduralWorld, makeSnapshot, urbanIntensity } from '../../simulation'
import { frameFromSim, frameFromSnapshot } from '../core/frame'
import { makeFrame, withLayers } from './fixtures'

const ALL: OverlayId[] = ['none', 'landcover', 'elevation', 'slope', 'runoff', 'soil', 'erosion', 'productivity', 'moisture', 'sensitivity', 'susceptibility', 'urban']

const luminance = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b

describe('overlay definitions', () => {
  it('defines every OverlayId with label, description and legend', () => {
    expect(OVERLAY_IDS.sort()).toEqual([...ALL].sort())
    for (const id of ALL) {
      const d = OVERLAYS[id]
      expect(d.id).toBe(id)
      expect(d.label.length).toBeGreaterThan(0)
      expect(d.description.length).toBeGreaterThan(0)
      if (id !== 'none') {
        expect(d.legend.length).toBeGreaterThanOrEqual(3)
        expect(d.cue.pattern).not.toBe('none')
        expect(d.cue.description.length).toBeGreaterThan(0)
      }
      // humanized copy: no em dashes
      expect(d.description).not.toMatch(/\u2014/)
      expect(d.cue.description).not.toMatch(/\u2014/)
    }
  })

  it('sequential ramps are monotonic in lightness (readable without hue)', () => {
    for (const ramp of ['viridis', 'cividis', 'inferno'] as const) {
      let prev = -1
      for (let k = 0; k <= 10; k++) {
        const l = luminance(rampColor(ramp, k / 10))
        expect(l).toBeGreaterThan(prev - 1e-3)
        prev = l
      }
    }
    let prev = 2
    for (let k = 0; k <= 10; k++) {
      const l = luminance(rampColor('blues', k / 10))
      expect(l).toBeLessThan(prev + 1e-3)
      prev = l
    }
  })

  it('maps values to colors, clamping out of range and returning null for no-data', () => {
    const lo = overlayColor('soil', -5, [0, 1])
    const hi = overlayColor('soil', 5, [0, 1])
    expect(lo).toEqual(rampColor('viridis', 0))
    expect(hi).toEqual(rampColor('viridis', 1))
    expect(overlayColor('soil', NaN, [0, 1])).toBeNull()
    expect(overlayColor('none', 0.5, [0, 1])).toBeNull()
    const forest = overlayColor('landcover', coverCode('forest'), [0, 7])!
    expect(forest.map((v) => Math.round(v * 255))).toEqual([0x00, 0x9e, 0x73])
    expect(RAMPS['okabe-ito']).toHaveLength(8)
  })

  it('cue strength follows the value, or its inverse where low values are the concern', () => {
    expect(cueLevel('erosion', 1, [0, 1])).toBe(1)
    expect(cueLevel('erosion', 0, [0, 1])).toBe(0)
    expect(cueLevel('soil', 0.1, [0, 1])).toBeCloseTo(0.9)
    expect(cueLevel('landcover', 3, [0, 7])).toBe(0)
    expect(normalize(5, [0, 10])).toBe(0.5)
    expect(Number.isNaN(normalize(NaN, [0, 1]))).toBe(true)
  })

  it('adaptive domains never shrink below their floor and can be shared across frames', () => {
    expect(overlayDomain('runoff', new Float32Array(10).fill(1))).toEqual([0, 20])
    const big = new Float32Array(100).map((_, i) => i)
    const [, hi] = overlayDomain('runoff', new Float32Array(10), big)
    expect(hi).toBeGreaterThan(90)
    expect(overlayDomain('slope', big)).toEqual([0, 60])
    expect(overlayDomain('elevation', Float32Array.from([1200, 1500]))).toEqual([1200, 1500])
  })

  it('resolves numeric legend labels', () => {
    const l = resolveLegend('slope', [0, 60])
    expect(l[0].label).toContain('0 %')
    expect(l[l.length - 1].label).toContain('60 %+')
    expect(resolveLegend('landcover', [0, 7])).toBe(OVERLAYS.landcover.legend)
  })
})

describe('overlay values', () => {
  it('reads values from state and marks unsimulated model outputs as no-data', () => {
    const frame = makeFrame(4, 4)
    expect(Array.from(overlayValues('runoff', frame)).every(Number.isNaN)).toBe(true)
    expect(Array.from(overlayValues('soil', frame)).every((v) => Math.abs(v - 0.7) < 1e-6)).toBe(true)
    const ready = { ...frame, fieldsReady: true }
    ready.fields.erosion.fill(0.3)
    expect(overlayValues('erosion', ready)[5]).toBeCloseTo(0.3)
  })

  it('productivity only covers farmland', () => {
    const frame = withLayers({ ...makeFrame(4, 4), fieldsReady: true }, (l) => {
      l.cover[0] = coverCode('cropland')
      l.cover[1] = coverCode('agroforestry')
    })
    frame.fields.yieldT.fill(2)
    const v = overlayValues('productivity', frame)
    expect(v[0]).toBe(2)
    expect(v[1]).toBe(2)
    expect(Number.isNaN(v[2])).toBe(true)
  })

  it('sensitivity, erosion risk and urban development are the simulation\'s own indicators, for live and snapshot frames', () => {
    const state = createInitialState(generateProceduralWorld(7), 7)
    const live = frameFromSim(state)
    const snap = frameFromSnapshot(makeSnapshot(state, 1, 'wet'), state.terrain)
    const sens = environmentalSensitivity(state)
    const sus = erosionSusceptibility(state)
    const urb = urbanIntensity(state)
    const isWater = (i: number) => state.terrain.channel[i] === 1 || state.layers.cover[i] === coverCode('water') || state.layers.structure[i] === structureCode('reservoir')
    for (const frame of [live, snap]) {
      const v = overlayValues('sensitivity', frame)
      const e = overlayValues('susceptibility', frame)
      const u = overlayValues('urban', frame)
      let water = 0
      for (let i = 0; i < v.length; i++) {
        if (isWater(i)) {
          water++
          expect(Number.isNaN(v[i])).toBe(true)
          expect(Number.isNaN(e[i])).toBe(true)
        } else {
          expect(v[i]).toBeCloseTo(sens[i], 6)
          expect(e[i]).toBeCloseTo(sus[i], 6)
        }
        if (urb[i] > 0) expect(u[i]).toBeCloseTo(urb[i], 6)
        else expect(Number.isNaN(u[i])).toBe(true)
      }
      expect(water).toBeGreaterThan(0)
    }
    // the village is on the urban map, and some land is highly sensitive (river banks, wetland)
    expect(Array.from(overlayValues('urban', live)).filter(Number.isFinite).length).toBeGreaterThan(10)
    expect(Math.max(...Array.from(overlayValues('sensitivity', live)).filter(Number.isFinite))).toBeGreaterThanOrEqual(0.7)
    // the definitions say where the values come from
    for (const id of ['sensitivity', 'susceptibility', 'urban'] as const) expect(OVERLAYS[id].source).toBe('derived-indicator')
    expect(OVERLAYS.sensitivity.description).toMatch(/flood/)
  })

  it('erosion risk falls when a bare slope is restored (it follows land use, not the weather)', () => {
    const state = createInitialState(generateProceduralWorld(7), 7)
    const frame = frameFromSim(state)
    const bare = coverCode('bare')
    let i = -1
    for (let k = 0; k < state.layers.cover.length; k++) if (state.layers.cover[k] === bare && state.terrain.slope[k] > 0.05) i = k
    expect(i).toBeGreaterThanOrEqual(0)
    const restored = withLayers(frame, (l) => {
      l.cover[i] = coverCode('forest')
      l.vegetation[i] = 0.9
    })
    expect(overlayValues('susceptibility', restored)[i]).toBeLessThan(overlayValues('susceptibility', frame)[i])
  })

  it('packs textures with a no-data flag and cue levels', () => {
    const values = Float32Array.from([0, 0.5, 1, NaN])
    const tex = buildOverlayTextures('erosion', values, [0, 1])
    expect(tex.color[3]).toBe(255)
    expect(tex.color[15]).toBe(0)
    expect(tex.cue[0]).toBe(0)
    expect(tex.cue[8]).toBe(255)
    expect(tex.cue[14]).toBe(0)
    const cat = buildOverlayTextures('landcover', Float32Array.from([5]), [0, 7])
    expect(cat.cue[1]).toBe(5)
  })
})

describe('game tonnes are labelled as game units', () => {
  it('no overlay shows bare tonnes; erosion and harvest say game t', () => {
    for (const id of OVERLAY_IDS) expect(OVERLAYS[id].unit, id).not.toMatch(/^t(\/ha)?$/)
    expect(OVERLAYS.erosion.unit).toBe('game t/ha')
    expect(OVERLAYS.susceptibility.unit).toBe('game t/ha')
    expect(OVERLAYS.productivity.unit).toBe('game t')
  })
})
