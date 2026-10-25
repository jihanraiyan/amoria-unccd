import { describe, expect, it } from 'vitest'
import { structureCode } from '../../simulation/types'
import { TERRAIN_SUB, heightAt, meshHeightAt, sampleBilinear, terrainHeights } from '../core/coords'
import { frameFromSim } from '../core/frame'
import { BUILD_KIND, computeBuildings } from '../core/placement'
import { cellGroundRange, reservoirBasins, reservoirLevel } from '../core/reservoir'
import { BANK_CLEARANCE, WATER_KIND, blendWaterField, buildWaterMesh, computeWaterCells } from '../water/waterData'
import { makeFrame, makeTerrain, withLayers } from './fixtures'

const RES = structureCode('reservoir')

/** A steep slope (about 0.9 and 0.55 world units of rise per cell) with a 2 x 2 reservoir. */
function slopedReservoir(fill: number) {
  const terrain = makeTerrain(8, 8, (x, z) => 1000 + 40 * x + 25 * z)
  const base = withLayers(makeFrame(8, 8, { terrain }), (l) => {
    for (const i of [27, 28, 35, 36]) l.structure[i] = RES
  })
  return { frame: { ...base, reservoirFill: fill }, cells: [27, 28, 35, 36] }
}

/** Share of points over the reservoir footprint where the water surface is above the ground. */
function coveredShare(fill: number): number {
  const { frame, cells } = slopedReservoir(fill)
  const h = terrainHeights(frame.terrain)
  const water = computeWaterCells(frame, h)
  let wet = 0
  let total = 0
  for (const i of cells) {
    const cx = (i % 8) - 4 + 0.5
    const cz = Math.floor(i / 8) - 4 + 0.5
    for (let a = 0; a <= 10; a++)
      for (let b = 0; b <= 10; b++) {
        const x = cx - 0.5 + a / 10
        const z = cz - 0.5 + b / 10
        total++
        if (water.level[i] > meshHeightAt(h, frame.terrain, TERRAIN_SUB, x, z)) wet++
      }
  }
  return wet / total
}

describe('reservoir water', () => {
  it('a full reservoir covers its whole sloped footprint; an empty one exposes its bed', () => {
    expect(coveredShare(1)).toBeGreaterThanOrEqual(0.95)
    expect(coveredShare(0.5)).toBeGreaterThan(coveredShare(0.1))
    expect(coveredShare(0)).toBeLessThan(0.05)
  })

  it('one flat level per connected basin, between its bed and rim', () => {
    const { frame } = slopedReservoir(0.5)
    const h = terrainHeights(frame.terrain)
    const b = reservoirBasins(frame.layers.structure, RES, h, frame.terrain)
    expect(b.bed.length).toBe(1)
    const water = computeWaterCells(frame, h)
    for (const i of [27, 28, 35, 36]) {
      expect(water.kind[i]).toBe(WATER_KIND.reservoir)
      expect(water.level[i]).toBeCloseTo(reservoirLevel(b.bed[0], b.rim[0], 0.5))
    }
    expect(b.rim[0]).toBeGreaterThan(b.bed[0])
    // the extremes really bound the bilinear surface over the cell
    const [lo, hi] = cellGroundRange(h, frame.terrain, 27)
    const cx = (27 % 8) - 4 + 0.5
    const cz = Math.floor(27 / 8) - 4 + 0.5
    for (let a = 0; a <= 10; a++)
      for (let c = 0; c <= 10; c++) {
        const y = heightAt(h, frame.terrain, cx - 0.5 + a / 10, cz - 0.5 + c / 10)
        expect(y).toBeGreaterThanOrEqual(lo - 1e-6)
        expect(y).toBeLessThanOrEqual(hi + 1e-6)
      }
    expect(hi).toBeGreaterThan(lo)
  })

  it('the mesh draws reservoir quads flat at the basin level over the footprint', () => {
    const { frame } = slopedReservoir(1)
    const h = terrainHeights(frame.terrain)
    const cells = computeWaterCells(frame, h)
    const mesh = buildWaterMesh(frame, h, cells, TERRAIN_SUB)
    let n = 0
    for (let v = 0; v < mesh.vertexCount; v++) {
      if (mesh.kind[v] !== WATER_KIND.reservoir) continue
      n++
      expect(mesh.positions[v * 3 + 1]).toBeCloseTo(cells.level[27])
      expect(mesh.positions[v * 3 + 1]).toBeGreaterThan(mesh.ground[v])
    }
    expect(n).toBe(4 * (TERRAIN_SUB + 1) ** 2)
  })

  it('embankment crests stand above a full reservoir even on a steep slope', () => {
    const { frame } = slopedReservoir(1)
    const h = terrainHeights(frame.terrain)
    const full = computeWaterCells(frame, h).level[27]
    const t = computeBuildings(frame, h)
    let walls = 0
    for (let s = 0; s < t.kind.length; s++) {
      if (t.kind[s] !== BUILD_KIND.embankment) continue
      walls++
      const pitch = t.rot[s * 2 + 1]
      const halfDrop = Math.abs(Math.sin(pitch)) * t.scale[s * 3] * 0.5
      expect(t.pos[s * 3 + 1] + t.scale[s * 3 + 1] - halfDrop).toBeGreaterThan(full)
    }
    expect(walls).toBe(8)
  })
})

describe('river banks', () => {
  it('dry cells never hold water at their centres (valley at the start and after a season)', async () => {
    const { generateProceduralWorld } = await import('../../simulation/world/procedural')
    const { createInitialState, step } = await import('../../simulation/engine')
    const s0 = createInitialState(generateProceduralWorld(1), 1)
    for (const sim of [s0, step(s0).state]) {
      const frame = frameFromSim(sim)
      const h = terrainHeights(frame.terrain)
      const cells = computeWaterCells(frame, h)
      const mesh = buildWaterMesh(frame, h, cells, TERRAIN_SUB)
      const { width, height } = frame.terrain
      let checked = 0
      for (let v = 0; v < mesh.vertexCount; v++) {
        const x = mesh.positions[v * 3]
        const z = mesh.positions[v * 3 + 2]
        const u = x + width / 2 - 0.5
        const w = z + height / 2 - 0.5
        if (Math.abs(u - Math.round(u)) > 1e-4 || Math.abs(w - Math.round(w)) > 1e-4) continue
        const i = Math.round(w) * width + Math.round(u)
        if (cells.kind[i] !== WATER_KIND.none) continue
        checked++
        expect(mesh.positions[v * 3 + 1]).toBeLessThanOrEqual(h[i] - BANK_CLEARANCE + 1e-5)
      }
      expect(checked).toBeGreaterThan(50)
    }
  })

  it('river water still reaches past the channel centre toward the bank', () => {
    const f = makeFrame(8, 8)
    for (let z = 0; z < 8; z++) f.terrain.channel[z * 8 + 3] = 1
    const h = terrainHeights(f.terrain)
    const cells = computeWaterCells(f, h)
    const mesh = buildWaterMesh(f, h, cells, 2)
    // the vertex on the channel's east edge (between the river and the bank) is wet
    const x = 3 - 4 + 1
    const z = 0.5
    let found = false
    for (let v = 0; v < mesh.vertexCount; v++) {
      if (Math.abs(mesh.positions[v * 3] - x) < 1e-6 && Math.abs(mesh.positions[v * 3 + 2] - z) < 1e-6) {
        found = true
        expect(mesh.positions[v * 3 + 1]).toBeGreaterThan(mesh.ground[v])
      }
    }
    expect(found).toBe(true)
  })
})

describe('water level tweening', () => {
  it('starts new flood water below ground, keeps draining cells for one build, and blends', () => {
    const f = { ...makeFrame(6, 6), fieldsReady: true }
    const h = terrainHeights(f.terrain)
    const dry = buildWaterMesh(f, h, computeWaterCells(f, h), 2)
    const flooded = { ...f, fields: { ...f.fields, flooded: f.fields.flooded.slice(), floodDepthM: f.fields.floodDepthM.slice() } }
    flooded.fields.flooded[14] = 1
    flooded.fields.floodDepthM[14] = 1
    const wet = buildWaterMesh(flooded, h, computeWaterCells(flooded, h), 2, dry.field)
    let rising = 0
    for (let v = 0; v < wet.vertexCount; v++) {
      if (wet.kind[v] !== WATER_KIND.flood) continue
      // starts at or below the ground, ends above it at the flooded cell
      expect(wet.levelFrom[v]).toBeLessThanOrEqual(wet.ground[v] + 1e-6)
      if (wet.positions[v * 3 + 1] > wet.ground[v]) rising++
    }
    expect(rising).toBeGreaterThan(0)
    // the flood recedes: the cells stay in the mesh, now draining from the flood level
    const after = buildWaterMesh(f, h, computeWaterCells(f, h), 2, wet.field)
    expect(after.indices.length).toBe(wet.indices.length)
    let draining = 0
    for (let v = 0; v < after.vertexCount; v++) if (after.levelFrom[v] > after.ground[v] && after.positions[v * 3 + 1] < after.ground[v]) draining++
    expect(draining).toBeGreaterThan(0)
    // and the build after that drops them
    const settled = buildWaterMesh(f, h, computeWaterCells(f, h), 2, after.field)
    expect(settled.indices.length).toBe(0)
    // half way through a tween the field sits between its endpoints
    const mid = blendWaterField(wet.field, 0.5)
    expect(mid.ext[14]).toBeCloseTo((wet.field.extFrom[14] + wet.field.ext[14]) / 2)
    expect(blendWaterField(wet.field, 1).extFrom).toBe(wet.field.ext)
  })

  it('a reservoir level change tweens from the old level', () => {
    const a = slopedReservoir(0.2).frame
    const b = { ...a, reservoirFill: 0.9 }
    const h = terrainHeights(a.terrain)
    const first = buildWaterMesh(a, h, computeWaterCells(a, h), 2)
    const second = buildWaterMesh(b, h, computeWaterCells(b, h), 2, first.field)
    const lowLevel = computeWaterCells(a, h).level[27]
    const highLevel = computeWaterCells(b, h).level[27]
    for (let v = 0; v < second.vertexCount; v++) {
      if (second.kind[v] !== WATER_KIND.reservoir) continue
      expect(second.levelFrom[v]).toBeCloseTo(lowLevel)
      expect(second.positions[v * 3 + 1]).toBeCloseTo(highLevel)
    }
    expect(sampleBilinear(second.field.ext, a.terrain, 0, 0)).toBeTypeOf('number')
  })
})
