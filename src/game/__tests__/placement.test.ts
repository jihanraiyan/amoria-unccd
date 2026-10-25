import { describe, expect, it } from 'vitest'
import {
  BUILD_KIND,
  BUILD_SLOTS,
  MARK_KIND,
  MARK_SLOTS,
  BRIDGE_CLEARANCE,
  ROAD_SLOTS,
  VEG_KIND,
  VEG_SLOTS,
  computeBuildings,
  computeGroundMarks,
  computeRoads,
  computeVegetation,
  countKind,
  housesForLevel,
  roadDeckHeights,
  roadLinks,
  type SlotTargets,
} from '../core/placement'
import { terrainHeights } from '../core/coords'
import { coverCode, structureCode } from '../../simulation/types'
import { makeFrame, withLayers } from './fixtures'
import { riverDepthForStage } from '../water/waterData'

const TREE_KINDS = [VEG_KIND.conifer, VEG_KIND.pineTall, VEG_KIND.pineRound, VEG_KIND.broadleaf, VEG_KIND.oak, VEG_KIND.poplar, VEG_KIND.fruit]
const trees = (t: SlotTargets, cell?: number) => {
  let n = 0
  const from = cell === undefined ? 0 : cell * t.slotsPerCell
  const to = cell === undefined ? t.kind.length : from + t.slotsPerCell
  for (let s = from; s < to; s++) if ((TREE_KINDS as number[]).includes(t.kind[s])) n++
  return n
}
const cellScale = (t: SlotTargets, cell: number) => {
  let m = 0
  for (let s = cell * t.slotsPerCell; s < (cell + 1) * t.slotsPerCell; s++) if ((TREE_KINDS as number[]).includes(t.kind[s])) m = Math.max(m, t.scale[s * 3])
  return m
}

const forestFrame = (veg: number, age = 40) =>
  withLayers(makeFrame(8, 8), (l) => {
    l.cover.fill(coverCode('forest'))
    l.baselineCover.fill(coverCode('forest'))
    l.vegetation.fill(veg)
    l.coverAge.fill(age)
  })

describe('vegetation placement', () => {
  it('is deterministic for identical state', () => {
    const f = forestFrame(0.8)
    const h = terrainHeights(f.terrain)
    const a = computeVegetation(f, h)
    const b = computeVegetation(f, h)
    expect(Array.from(a.kind)).toEqual(Array.from(b.kind))
    expect(Array.from(a.pos)).toEqual(Array.from(b.pos))
    expect(Array.from(a.scale)).toEqual(Array.from(b.scale))
    expect(a.kind.length).toBe(64 * VEG_SLOTS)
  })

  it('tree density follows the vegetation layer', () => {
    const sparse = computeVegetation(forestFrame(0.2), terrainHeights(forestFrame(0.2).terrain))
    const dense = computeVegetation(forestFrame(0.95), terrainHeights(forestFrame(0.95).terrain))
    expect(trees(dense)).toBeGreaterThan(trees(sparse))
    expect(trees(sparse)).toBeGreaterThan(0)
  })

  it('young restoration is smaller and grows with cover age', () => {
    const young = forestFrame(0.6, 1)
    const old = forestFrame(0.6, 30)
    const a = computeVegetation(young, terrainHeights(young.terrain))
    const b = computeVegetation(old, terrainHeights(old.terrain))
    expect(cellScale(a, 10)).toBeLessThan(cellScale(b, 10))
  })

  it('clearing a cell removes its trees and leaves the rest untouched', () => {
    const base = forestFrame(0.9)
    const cleared = withLayers(base, (l) => {
      l.cover[20] = coverCode('bare')
      l.vegetation[20] = 0.02
    })
    const h = terrainHeights(base.terrain)
    const a = computeVegetation(base, h)
    const b = computeVegetation(cleared, h)
    expect(trees(a, 20)).toBeGreaterThan(0)
    expect(trees(b, 20)).toBe(0)
    // stumps show where the forest was cleared
    let stumps = 0
    for (let s = 20 * VEG_SLOTS; s < 21 * VEG_SLOTS; s++) if (b.kind[s] === VEG_KIND.stump) stumps++
    expect(stumps).toBeGreaterThan(0)
    for (let s = 0; s < a.kind.length; s++) {
      if (Math.floor(s / VEG_SLOTS) === 20) continue
      expect(b.kind[s]).toBe(a.kind[s])
      expect(b.pos[s * 3]).toBe(a.pos[s * 3])
    }
  })

  it('places trees inside their own cell and on the terrain surface', () => {
    const f = forestFrame(0.9)
    const h = terrainHeights(f.terrain)
    const t = computeVegetation(f, h)
    for (let s = 0; s < t.kind.length; s++) {
      if (t.kind[s] < 0) continue
      const cell = Math.floor(s / VEG_SLOTS)
      const cx = (cell % 8) - 4 + 0.5
      const cz = Math.floor(cell / 8) - 4 + 0.5
      expect(Math.abs(t.pos[s * 3] - cx)).toBeLessThan(0.5)
      expect(Math.abs(t.pos[s * 3 + 2] - cz)).toBeLessThan(0.5)
      expect(Number.isFinite(t.pos[s * 3 + 1])).toBe(true)
    }
  })

  it('drought stress shifts foliage toward straw tones', () => {
    const f = { ...forestFrame(0.9), fieldsReady: true }
    f.fields.waterFactor.fill(1)
    const h = terrainHeights(f.terrain)
    const healthy = computeVegetation(f, h)
    const dry = { ...f, fields: { ...f.fields, waterFactor: new Float32Array(64).fill(0.1) } }
    const stressed = computeVegetation(dry, h)
    const s = healthy.kind.findIndex((k) => k >= 0)
    // stressed foliage is less green relative to red
    const ratio = (t: SlotTargets) => t.color[s * 3 + 1] / t.color[s * 3]
    expect(ratio(stressed)).toBeLessThan(ratio(healthy))
  })

  it('wetlands grow reeds, low quality uses fewer forest trees', () => {
    const wet = withLayers(makeFrame(4, 4), (l) => {
      l.cover.fill(coverCode('wetland'))
      l.vegetation.fill(0.8)
    })
    expect(countKind(computeVegetation(wet, terrainHeights(wet.terrain)), VEG_KIND.reed)).toBeGreaterThan(0)
    const f = forestFrame(1)
    const h = terrainHeights(f.terrain)
    expect(trees(computeVegetation(f, h, { forestSlots: 3 }))).toBeLessThan(trees(computeVegetation(f, h, { forestSlots: 5 })))
  })
})

describe('ground marks', () => {
  const farm = (edit: (l: ReturnType<typeof makeFrame>['layers']) => void) => withLayers(makeFrame(6, 6), edit)

  it('crop rows count follows intensity', () => {
    const rows = (intensity: number) => {
      const f = farm((l) => {
        l.cover.fill(coverCode('cropland'))
        l.intensity.fill(intensity)
      })
      return countKind(computeGroundMarks(f, terrainHeights(f.terrain)), MARK_KIND.cropRow)
    }
    expect(rows(2)).toBeGreaterThan(rows(1))
    expect(rows(1)).toBeGreaterThan(rows(0))
    expect(rows(0)).toBeGreaterThan(0)
  })

  it('conservation adds terraces and irrigation adds a ditch', () => {
    const f = farm((l) => {
      l.cover[7] = coverCode('cropland')
      l.conservation[7] = 1
      l.irrigated[7] = 1
    })
    const t = computeGroundMarks(f, terrainHeights(f.terrain))
    let strips = 0
    for (let s = 7 * MARK_SLOTS; s < 8 * MARK_SLOTS; s++) if (t.kind[s] === MARK_KIND.strip) strips++
    expect(strips).toBe(4)
  })

  it('high erosion draws gullies only once the season has been simulated', () => {
    const f = farm((l) => l.cover.fill(coverCode('bare')))
    f.fields.erosion.fill(0.5)
    f.fields.erosion[10] = 40
    const h = terrainHeights(f.terrain)
    expect(countKind(computeGroundMarks(f, h), MARK_KIND.strip)).toBe(0)
    const ready = computeGroundMarks({ ...f, fieldsReady: true }, h)
    let gullies = 0
    for (let s = 10 * MARK_SLOTS; s < 11 * MARK_SLOTS; s++) if (ready.kind[s] === MARK_KIND.strip) gullies++
    expect(gullies).toBeGreaterThan(0)
    expect(countKind(ready, MARK_KIND.strip)).toBe(gullies)
  })

  it('rainfed fields with no harvest this season show low stubble, not a standing crop', () => {
    const f = { ...farm((l) => l.cover.fill(coverCode('cropland'))), fieldsReady: true }
    f.fields.waterFactor.fill(0.9)
    f.fields.yieldT.fill(1)
    const h = terrainHeights(f.terrain)
    const growing = computeGroundMarks(f, h)
    const fallow = computeGroundMarks({ ...f, season: 'dry' as const, fields: { ...f.fields, yieldT: new Float32Array(36) } }, h)
    const s = growing.kind.findIndex((k) => k === MARK_KIND.cropRow)
    expect(fallow.kind[s]).toBe(MARK_KIND.cropRow)
    expect(fallow.scale[s * 3 + 1]).toBeLessThan(growing.scale[s * 3 + 1] * 0.5)
  })

  it('badly degraded slopes keep gully scars even in a calm season', () => {
    const f = farm((l) => {
      l.cover.fill(coverCode('bare'))
      l.soilHealth[14] = 0.1
    })
    f.terrain.slope[14] = 0.4
    const t = computeGroundMarks(f, terrainHeights(f.terrain))
    let gullies = 0
    for (let s = 14 * MARK_SLOTS; s < 15 * MARK_SLOTS; s++) if (t.kind[s] === MARK_KIND.strip) gullies++
    expect(gullies).toBeGreaterThan(0)
  })

  it('crop color reflects water limitation', () => {
    const f = { ...farm((l) => l.cover.fill(coverCode('cropland'))), fieldsReady: true }
    f.fields.waterFactor.fill(1)
    f.fields.yieldT.fill(1)
    const h = terrainHeights(f.terrain)
    const good = computeGroundMarks(f, h)
    const bad = computeGroundMarks({ ...f, fields: { ...f.fields, waterFactor: new Float32Array(36).fill(0.05), yieldT: new Float32Array(36).fill(0.05) } }, h)
    const s = good.kind.findIndex((k) => k === MARK_KIND.cropRow)
    const greenness = (t: typeof good) => t.color[s * 3 + 1] - t.color[s * 3]
    expect(greenness(bad)).toBeLessThan(greenness(good))
    // healthier crops stand taller
    expect(bad.scale[s * 3 + 1]).toBeLessThan(good.scale[s * 3 + 1])
  })
})

describe('roads and buildings', () => {
  it('road pieces connect neighbouring road cells', () => {
    const f = withLayers(makeFrame(5, 5), (l) => {
      for (const i of [6, 7, 8, 13]) l.structure[i] = structureCode('road')
    })
    expect(roadLinks(f.layers.structure, 5, 5, 7).length).toBe(2)
    const t = computeRoads(f, terrainHeights(f.terrain))
    // 4 pads + arms: 6<->7, 7<->8, 8<->13 (diagonal allowed: no orthogonal link between them)
    expect(countKind(t)).toBe(4 + 2 + 2 + 2)
    expect(t.kind.length).toBe(25 * ROAD_SLOTS)
  })

  it('a road across a river is drawn as a bridge deck above the highest water, with rails and a pier', () => {
    // a north-south river in column 2, a road across it along row 2
    const f = withLayers(
      { ...makeFrame(5, 5), terrain: { ...makeFrame(5, 5).terrain, channel: Uint8Array.from({ length: 25 }, (_, i) => (i % 5 === 2 ? 1 : 0)) } },
      (l) => {
        for (let z = 0; z < 5; z++) l.cover[z * 5 + 2] = coverCode('water')
        for (const i of [11, 12, 13]) l.structure[i] = structureCode('road')
      },
    )
    const h = terrainHeights(f.terrain)
    const deck = roadDeckHeights(f, h)
    const ground = h[12]
    expect(deck[12]).toBeGreaterThanOrEqual(ground + riverDepthForStage(1) + BRIDGE_CLEARANCE - 1e-6)
    // the roads on the banks stay on the ground
    expect(deck[11]).toBeCloseTo(h[11], 3)
    const t = computeRoads(f, h)
    const used = (cell: number) => t.kind.slice(cell * ROAD_SLOTS, (cell + 1) * ROAD_SLOTS).filter((k) => k >= 0).length
    // pad + 2 arms + pier + 2 rails on each arm
    expect(used(12)).toBe(1 + 2 + 1 + 4)
    // a plain road cell has only its pad and arm
    expect(used(11)).toBe(2)
    // the deck pad sits at deck height, not down in the river
    expect(t.pos[12 * ROAD_SLOTS * 3 + 1]).toBeGreaterThan(ground + riverDepthForStage(1))
  })

  it('house count and height follow structureLevel', () => {
    expect(housesForLevel(0)).toBe(0)
    expect(housesForLevel(1)).toBeLessThan(housesForLevel(3))
    const make = (level: number) => {
      const f = withLayers(makeFrame(3, 3), (l) => {
        l.structure[4] = structureCode('housing')
        l.structureLevel[4] = level
      })
      return computeBuildings(f, terrainHeights(f.terrain))
    }
    expect(countKind(make(1))).toBe(2)
    expect(countKind(make(3))).toBe(4)
    expect(countKind(make(1), BUILD_KIND.block)).toBe(0)
    expect(countKind(make(3), BUILD_KIND.block)).toBeGreaterThan(0)
    expect(make(2).kind.length).toBe(9 * BUILD_SLOTS)
  })

  it('reservoirs get an embankment only on outer edges; markets and waterworks get their models', () => {
    const f = withLayers(makeFrame(4, 4), (l) => {
      l.structure[5] = structureCode('reservoir')
      l.structure[6] = structureCode('reservoir')
      l.structure[0] = structureCode('market')
      l.structure[15] = structureCode('waterworks')
    })
    const t = computeBuildings(f, terrainHeights(f.terrain))
    expect(countKind(t, BUILD_KIND.embankment)).toBe(6)
    expect(countKind(t, BUILD_KIND.stall)).toBe(4)
    expect(countKind(t, BUILD_KIND.tank)).toBe(2)
  })
})
