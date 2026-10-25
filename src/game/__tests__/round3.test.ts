// Fix round 3: model maturity, river stage and turbidity, water diagonals, snapshot reservoir
// fill, camera follow vs focus, preallocated highlight buffers and colorblind tints.
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { VEG } from '../../simulation/params'
import { createInitialState, generateProceduralWorld, makeSnapshot, step } from '../../simulation'
import { coverCode, type SimulationState, type StepFields } from '../../simulation/types'
import { TERRAIN_SUB, meshHeightAt, terrainHeights } from '../core/coords'
import { frameFromSim, frameFromSnapshot, snapshotReservoirFill, type WorldFrame } from '../core/frame'
import { MARK_KIND, MARK_SLOTS, VEG_KIND, computeGroundMarks, computeVegetation, maturity } from '../core/placement'
import { COLORBLIND_TINTS, surfaceColor, type SurfaceInputs } from '../core/palette'
import { DynamicGeometry } from '../controls/dynamicGeometry'
import { FOCUS_MAX_DISTANCE, FOCUS_SAFE_NDC, planFocus, type CameraState } from '../controls/cameraMath'
import { buildTiles } from '../controls/highlightData'
import { reservoirFillForSnapshot } from '../scene/snapshotUtils'
import { WATER_KIND, buildWaterMesh, computeWaterCells, riverStage, waterTurbidity } from '../water/waterData'
import { makeFields, makeFrame, makeTerrain, withLayers } from './fixtures'

const TREE_KINDS: number[] = [VEG_KIND.conifer, VEG_KIND.pineTall, VEG_KIND.pineRound, VEG_KIND.broadleaf, VEG_KIND.oak, VEG_KIND.poplar, VEG_KIND.fruit, VEG_KIND.reed]
const maxScale = (t: ReturnType<typeof computeVegetation>, cell: number) => {
  let m = 0
  for (let s = cell * t.slotsPerCell; s < (cell + 1) * t.slotsPerCell; s++) if (TREE_KINDS.includes(t.kind[s])) m = Math.max(m, t.scale[s * 3])
  return m
}

describe('restoration maturity follows the vegetation model', () => {
  const covers = [
    ['forest', VEG.matureSeasons.value.forest],
    ['agroforestry', VEG.matureSeasons.value.agroforestry],
    ['wetland', VEG.matureSeasons.value.wetland],
  ] as const

  it.each(covers)('%s reaches full visual size exactly at the model maturity age (%i seasons)', (cover, seasons) => {
    const at = (age: number) => {
      const f = withLayers(makeFrame(4, 4), (l) => {
        l.cover.fill(coverCode(cover))
        l.vegetation.fill(0.9)
        l.coverAge.fill(age)
      })
      return maxScale(computeVegetation(f, terrainHeights(f.terrain)), 5)
    }
    const mature = at(seasons)
    expect(mature).toBeGreaterThan(0)
    expect(at(seasons + 30)).toBeCloseTo(mature, 6)
    expect(at(seasons - 1)).toBeLessThan(mature)
    expect(at(Math.round(seasons / 2))).toBeLessThan(at(seasons - 1))
    expect(maturity(coverCode(cover), seasons)).toBe(1)
    expect(maturity(coverCode(cover), seasons / 2)).toBeCloseTo(0.5)
  })
})

/** A straight channel down column 3 of a 7 x 12 valley, with bankfull capacity on it. */
function riverFrame(flowMm: number, sedimentT: number, patch: Partial<StepFields> = {}): WorldFrame {
  const terrain = makeTerrain(7, 12, (x, z) => 1000 + Math.abs(x - 3) * 6 - z * 2)
  const n = 7 * 12
  for (let z = 0; z < 12; z++) {
    terrain.channel[z * 7 + 3] = 1
    terrain.bankfullMm[z * 7 + 3] = 100
  }
  const fields = makeFields(n)
  fields.waterFactor.fill(0.8)
  for (let z = 0; z < 12; z++) {
    fields.flowMm[z * 7 + 3] = flowMm
    fields.sedimentFlux[z * 7 + 3] = sedimentT
  }
  Object.assign(fields, patch)
  return makeFrame(7, 12, { terrain, fields, fieldsReady: true })
}

describe('rivers follow flow and sediment', () => {
  it('river level rises with flow: drought below normal below heavy rain', () => {
    const level = (flow: number) => {
      const f = riverFrame(flow, 0)
      const h = terrainHeights(f.terrain)
      return computeWaterCells(f, h).level[5 * 7 + 3] - h[5 * 7 + 3]
    }
    const drought = level(10)
    const normal = level(160)
    const heavy = level(500)
    expect(drought).toBeGreaterThan(0)
    expect(normal).toBeGreaterThan(drought)
    expect(heavy).toBeGreaterThan(normal)
    // capped: more flow than the display reference does not raise it further
    expect(level(5000)).toBeCloseTo(heavy, 6)
  })

  it('muddier water where more sediment travels in the same flow, clear before the first season', () => {
    const clear = waterTurbidity(riverFrame(160, 0.5))[5 * 7 + 3]
    const muddy = waterTurbidity(riverFrame(160, 200))[5 * 7 + 3]
    expect(muddy).toBeGreaterThan(clear)
    expect(muddy).toBeLessThanOrEqual(1)
    expect(Array.from(waterTurbidity({ ...riverFrame(160, 200), fieldsReady: false })).every((v) => v === 0)).toBe(true)
    // a trickle carrying a little sediment is not drawn as mud
    expect(waterTurbidity(riverFrame(0.001, 0.01))[5 * 7 + 3]).toBeLessThan(0.5)
    // turbidity reaches the shader as a vertex attribute
    const f = riverFrame(160, 200)
    const h = terrainHeights(f.terrain)
    const mesh = buildWaterMesh(f, h, computeWaterCells(f, h), TERRAIN_SUB)
    expect(Math.max(...Array.from(mesh.turbidity))).toBeCloseTo(muddy, 3)
  })

  it('on the starter valley a drought season lowers the river and a heavy-rain season raises it', () => {
    let s: SimulationState = createInitialState(generateProceduralWorld(7), 7)
    const stageBy: Record<string, number[]> = {}
    for (let k = 0; k < 14; k++) {
      const w = s.weather[s.step]
      s = step(s).state
      const st = riverStage(frameFromSim(s))
      let sum = 0
      let cnt = 0
      for (let i = 0; i < st.length; i++)
        if (s.terrain.channel[i] && s.terrain.flowAccumulation[i] > 50) {
          sum += st[i]
          cnt++
        }
      const key = `${w.season}-${w.kind}`
      ;(stageBy[key] ??= []).push(sum / cnt)
    }
    const mean = (k: string) => stageBy[k].reduce((a, b) => a + b, 0) / stageBy[k].length
    expect(stageBy['wet-heavy-rain']).toBeDefined()
    expect(stageBy['dry-drought']).toBeDefined()
    expect(mean('wet-heavy-rain')).toBeGreaterThan(mean('wet-normal'))
    expect(mean('dry-drought')).toBeLessThan(mean('dry-normal'))
    expect(mean('wet-normal')).toBeGreaterThan(mean('dry-normal'))
  })

  it('clearing the forest upstream makes the river downstream muddier', () => {
    const base = createInitialState(generateProceduralWorld(7), 7)
    const cleared: SimulationState = { ...base, layers: { ...base.layers, cover: base.layers.cover.slice(), vegetation: base.layers.vegetation.slice(), coverAge: base.layers.coverAge.slice() } }
    const forest = coverCode('forest')
    const bare = coverCode('bare')
    let changed = 0
    for (let i = 0; i < cleared.layers.cover.length; i++)
      if (cleared.layers.cover[i] === forest) {
        cleared.layers.cover[i] = bare
        cleared.layers.vegetation[i] = 0.05
        cleared.layers.coverAge[i] = 0
        changed++
      }
    expect(changed).toBeGreaterThan(50)
    const a = step(base).state
    const b = step(cleared).state
    // the main river at its most downstream cells
    const main: number[] = []
    for (let i = 0; i < a.terrain.channel.length; i++) if (a.terrain.channel[i] && a.terrain.flowAccumulation[i] > 400) main.push(i)
    expect(main.length).toBeGreaterThan(3)
    const ta = waterTurbidity(frameFromSim(a))
    const tb = waterTurbidity(frameFromSim(b))
    const avg = (t: Float32Array) => main.reduce((sum, i) => sum + t[i], 0) / main.length
    expect(avg(tb)).toBeGreaterThan(avg(ta) + 0.02)
  })

  it('silt fans mark land where upslope sediment settled last season', () => {
    const base = makeFrame(6, 6, { fieldsReady: true })
    base.fields.waterFactor.fill(0.8)
    base.fields.sedimentIn[14] = 70
    const t = computeGroundMarks(base, terrainHeights(base.terrain))
    const silt = (cell: number) => t.kind[cell * MARK_SLOTS + MARK_SLOTS - 1]
    expect(silt(14)).toBe(MARK_KIND.strip)
    expect(silt(15)).toBe(-1)
    const before = computeGroundMarks({ ...base, fieldsReady: false }, terrainHeights(base.terrain))
    expect(before.kind[14 * MARK_SLOTS + MARK_SLOTS - 1]).toBe(-1)
  })
})

describe('water mesh diagonals', () => {
  it('aGround interpolated at every water quad centre equals the drawn terrain', () => {
    const state = createInitialState(generateProceduralWorld(7), 7)
    const f = frameFromSim(state)
    const h = terrainHeights(f.terrain)
    const mesh = buildWaterMesh(f, h, computeWaterCells(f, h), TERRAIN_SUB)
    const idx = mesh.indices
    let checked = 0
    for (let t = 0; t < idx.length; t += 6) {
      // the two triangles of a quad share its diagonal; the quad centre is the diagonal midpoint
      const tri = [idx[t], idx[t + 1], idx[t + 2], idx[t + 3], idx[t + 4], idx[t + 5]]
      const shared = tri.slice(0, 3).filter((v) => tri.slice(3).includes(v))
      expect(shared).toHaveLength(2)
      const [p, q] = shared
      const cx = (mesh.positions[p * 3] + mesh.positions[q * 3]) / 2
      const cz = (mesh.positions[p * 3 + 2] + mesh.positions[q * 3 + 2]) / 2
      const ground = (mesh.ground[p] + mesh.ground[q]) / 2
      expect(ground).toBeCloseTo(meshHeightAt(h, f.terrain, TERRAIN_SUB, cx, cz), 4)
      checked++
    }
    expect(checked).toBeGreaterThan(200)
    expect(Array.from(computeWaterCells(f, h).kind).some((k) => k === WATER_KIND.river)).toBe(true)
  })
})

describe('snapshot reservoir fill', () => {
  it('comes from the snapshot storage when the caller passes none; an explicit value overrides it', () => {
    const f = makeFrame(4, 4)
    const snap = { year: 3, season: 'dry' as const, layers: f.layers, fields: f.fields, community: {} as never, economy: {} as never, totals: { reservoirCapacityM3: 1000 } as never, reservoirM3: 250 }
    expect(snapshotReservoirFill(snap)).toBeCloseTo(0.25)
    expect(frameFromSnapshot(snap, f.terrain).reservoirFill).toBeCloseTo(0.25)
    expect(frameFromSnapshot(snap, f.terrain, null, 0.9).reservoirFill).toBeCloseTo(0.9)
    expect(reservoirFillForSnapshot([], snap)).toBeCloseTo(0.25)
    // no reservoirs: unknown, not a fake level
    expect(frameFromSnapshot({ ...snap, totals: { reservoirCapacityM3: 0 } as never }, f.terrain).reservoirFill).toBeNull()
    expect(frameFromSnapshot({ ...snap, reservoirM3: undefined }, f.terrain).reservoirFill).toBeNull()
  })

  it('engine snapshots carry the live fill', () => {
    const s = createInitialState(generateProceduralWorld(7), 7)
    const snap = makeSnapshot(s, 1, 'wet')
    expect(frameFromSnapshot(snap, s.terrain).reservoirFill).toEqual(frameFromSim(s).reservoirFill)
  })
})

describe('camera focus vs the keyboard cursor', () => {
  const far: CameraState = { target: [0, 0, 0], position: [0, 60, 60] }
  const dist = (s: CameraState) => Math.hypot(s.position[0] - s.target[0], s.position[1] - s.target[1], s.position[2] - s.target[2])

  it('a followed cell inside the safe area does not move the camera', () => {
    expect(planFocus(far, [2, 0, 1], { x: 0.2, y: -0.3, z: 0.9 }, 'follow')).toBeNull()
    expect(planFocus(far, [2, 0, 1], { x: FOCUS_SAFE_NDC, y: 0, z: 0.9 }, 'follow')).toBeNull()
  })

  it('a followed cell near the edge pans just enough and keeps the zoom', () => {
    const plan = planFocus(far, [30, 0, 0], { x: 0.9, y: 0, z: 0.9 }, 'follow')!
    expect(plan).not.toBeNull()
    expect(dist(plan)).toBeCloseTo(dist(far), 6)
    expect(plan.target[0]).toBeGreaterThan(0)
    expect(plan.target[0]).toBeLessThan(30)
    expect(plan.target[0]).toBeCloseTo(30 * (1 - FOCUS_SAFE_NDC / 0.9), 6)
    // behind the camera or off-screen: bring it all the way in, still at the same distance
    const behind = planFocus(far, [30, 0, 0], { x: 0.1, y: 0.1, z: 1.2 }, 'follow')!
    expect(behind.target[0]).toBeCloseTo(30)
    expect(dist(behind)).toBeCloseTo(dist(far), 6)
  })

  it('an explicit focus request centres the cell and comes in close', () => {
    const plan = planFocus(far, [5, 1, -4], { x: 0, y: 0, z: 0.5 }, 'focus')!
    expect(plan.target).toEqual([5, 1, -4])
    expect(dist(plan)).toBeCloseTo(FOCUS_MAX_DISTANCE, 6)
    // the viewing direction is kept
    const d0 = new Vector3(...far.position).sub(new Vector3(...far.target)).normalize()
    const d1 = new Vector3(...plan.position).sub(new Vector3(...plan.target)).normalize()
    expect(d0.dot(d1)).toBeCloseTo(1, 6)
  })
})

describe('highlight buffers are written in place', () => {
  it('reuses the same attribute buffers across hover changes and grows only by doubling', () => {
    const f = makeFrame(16, 16)
    const h = terrainHeights(f.terrain)
    const g = new DynamicGeometry({ position: 3, aState: 1, aLocal: 2 }, true, 64)
    const write = (cells: number[]) => {
      const t = buildTiles(cells, cells.map(() => 1), h, f.terrain)
      g.write({ position: t.positions, aState: t.state, aLocal: t.local }, t.state.length, t.indices)
      return t
    }
    write([3])
    const allocs = g.allocations
    const buf = g.geometry.getAttribute('position').array
    for (let k = 0; k < 50; k++) write([k % 200])
    expect(g.allocations).toBe(allocs)
    expect(g.geometry.getAttribute('position').array).toBe(buf)
    const big = write(Array.from({ length: 25 }, (_, i) => i))
    expect(g.allocations).toBe(allocs + 1)
    expect(g.capacity).toBeGreaterThanOrEqual(big.state.length)
    expect(g.capacity & (g.capacity - 1)).toBe(0)
    expect(g.geometry.drawRange.count).toBe(big.indices.length)
    const back = write([7])
    expect(g.geometry.drawRange.count).toBe(back.indices.length)
    expect(g.allocations).toBe(allocs + 1)
    // the written data is what the builder produced
    expect(Array.from((g.geometry.getAttribute('position').array as Float32Array).slice(0, back.positions.length))).toEqual(Array.from(back.positions))
    g.dispose()
  })

  it('outline geometry without an index uses the vertex count as its draw range', () => {
    const g = new DynamicGeometry({ position: 3 }, false, 4)
    g.write({ position: new Float32Array(9 * 3) }, 9)
    expect(g.geometry.drawRange.count).toBe(9)
    g.write({ position: new Float32Array(0) }, 0)
    expect(g.geometry.drawRange.count).toBe(0)
  })
})

describe('colorblind-friendly colors', () => {
  const lum = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  const base: SurfaceInputs = { cover: coverCode('grassland'), soilHealth: 0.8, vegetation: 0.7, waterFactor: 0.9, erosionNorm: 0, slope: 0.05, elevationNorm: 0.3, dryness: 0.05, isRoad: false }

  it('changes the world tints when the setting is on', () => {
    const degraded = { ...base, soilHealth: 0.15 }
    expect(surfaceColor({ ...degraded, colorblind: true })).not.toEqual(surfaceColor(degraded))
    // healthy, well-watered land keeps nearly its usual color
    expect(Math.abs(lum(surfaceColor({ ...base, colorblind: true })) - lum(surfaceColor(base)))).toBeLessThan(0.04)
  })

  it('separates healthy, degraded and gullied land by lightness, not by red versus green', () => {
    const healthy = lum(surfaceColor({ ...base, colorblind: true }))
    const degraded = lum(surfaceColor({ ...base, soilHealth: 0.15, colorblind: true }))
    const gullied = lum(surfaceColor({ ...base, soilHealth: 0.15, erosionNorm: 1, colorblind: true }))
    expect(degraded - healthy).toBeGreaterThan(0.08)
    expect(degraded - gullied).toBeGreaterThan(0.1)
    // the default palette's degraded tone is not much lighter than healthy grass
    const defaultGap = lum(surfaceColor({ ...base, soilHealth: 0.15 })) - lum(surfaceColor(base))
    expect(degraded - healthy).toBeGreaterThan(defaultGap)
    // gully tint leans blue, so it never reads as the red end of a red-green pair
    expect(COLORBLIND_TINTS.gully[2]).toBeGreaterThan(COLORBLIND_TINTS.gully[0])
  })

  it('drought-stressed trees and failed crops use the colorblind tints', () => {
    const f = withLayers({ ...makeFrame(4, 4), fieldsReady: true }, (l) => {
      l.cover.fill(coverCode('forest'))
      l.vegetation.fill(0.9)
    })
    f.fields.waterFactor.fill(0.02)
    const h = terrainHeights(f.terrain)
    const plain = computeVegetation(f, h)
    const cb = computeVegetation(f, h, { forestSlots: 4, colorblind: true })
    expect(Array.from(cb.color)).not.toEqual(Array.from(plain.color))
    const crop = withLayers({ ...makeFrame(4, 4), fieldsReady: true }, (l) => l.cover.fill(coverCode('cropland')))
    crop.fields.waterFactor.fill(0.05)
    crop.fields.yieldT.fill(0.01)
    const a = computeGroundMarks(crop, h)
    const b = computeGroundMarks(crop, h, { colorblind: true })
    expect(Array.from(b.color)).not.toEqual(Array.from(a.color))
  })
})
