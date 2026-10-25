// Fix round 6: buildings face their road, preview tiles lie on the drawn facets, weather
// particles start on the ground, runoff chevrons read bigger = faster, rotate orbits.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Euler, Vector3 } from 'three'
import { parseWorldText } from '../../data/worldFile'
import { deriveTerrain } from '../../simulation/engine/terrain'
import { structureCode } from '../../simulation/types'
import type { Terrain } from '../../simulation/types'
import { TERRAIN_SUB, heightAt, meshHeightAt, terrainHeights } from '../core/coords'
import { BUILD_KIND, BUILD_SLOTS, computeBuildings, frontYaw } from '../core/placement'
import { TILE_SUB, buildTiles } from '../controls/highlightData'
import { DUST_LIFT, easeBase, particleBases } from '../effects/atmosphereData'
import { arrowSize, arrowSpeed, arrowWorldSpeed, arrowWorldTravel } from '../effects/runoffArrowData'
import { orbitAt } from '../controls/cameraMath'
import { OVERLAYS, type OverlayId } from '../core/overlays'
import { makeFrame, withLayers } from './fixtures'

const kaani = (): Terrain => deriveTerrain(parseWorldText(readFileSync(resolve(__dirname, '../../../public/world-data/kaani-machakos.json'), 'utf8')))

/** World direction local +Z points to after the slot's yaw (pitch 0), as SlotAnimator applies it. */
function front(yaw: number): [number, number] {
  const v = new Vector3(0, 0, 1).applyEuler(new Euler(0, yaw, 0, 'YZX'))
  return [v.x, v.z]
}

describe('buildings face the road', () => {
  it('frontYaw turns local +Z (door side) toward the given direction', () => {
    for (const [dx, dz] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      const [fx, fz] = front(frontYaw(dx, dz))
      expect(fx).toBeCloseTo(dx, 6)
      expect(fz).toBeCloseTo(dz, 6)
    }
  })

  it('every house and the waterworks hall points its door at an adjacent road cell', () => {
    const W = 9
    const house = structureCode('housing')
    const road = structureCode('road')
    const works = structureCode('waterworks')
    // a cross of roads with lots on every side and on corners
    const frame = withLayers(makeFrame(W, W), (l) => {
      for (let k = 0; k < W; k++) {
        l.structure[4 * W + k] = road
        l.structure[k * W + 4] = road
      }
      const lots: [number, number, number][] = [
        [3, 3, 3],
        [5, 3, 2],
        [3, 5, 1],
        [5, 5, 3],
        [2, 4, 2],
        [4, 6, 3],
        [6, 4, 1],
        [4, 2, 2],
      ]
      for (const [x, z, lvl] of lots) {
        if (l.structure[z * W + x] === road) continue
        l.structure[z * W + x] = house
        l.structureLevel[z * W + x] = lvl
      }
      l.structure[3 * W + 2] = works
      l.structure[3 * W + 6] = house
      l.structureLevel[3 * W + 6] = 3
    })
    const t = computeBuildings(frame, terrainHeights(frame.terrain))
    let checked = 0
    for (let i = 0; i < W * W; i++) {
      const st = frame.layers.structure[i]
      if (st !== house && st !== works) continue
      const x = i % W
      const z = Math.floor(i / W)
      const roadDirs: [number, number][] = []
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as [number, number][]) {
        const nx = x + dx
        const nz = z + dz
        if (nx >= 0 && nz >= 0 && nx < W && nz < W && frame.layers.structure[nz * W + nx] === road) roadDirs.push([dx, dz])
      }
      expect(roadDirs.length).toBeGreaterThan(0)
      for (let s = i * BUILD_SLOTS; s < (i + 1) * BUILD_SLOTS; s++) {
        const kind = t.kind[s]
        if (kind !== BUILD_KIND.house1 && kind !== BUILD_KIND.house2 && kind !== BUILD_KIND.block && kind !== BUILD_KIND.worksHall) continue
        const [fx, fz] = front(t.rot[s * 2])
        // within the small placement jitter of one of the cell's road sides
        const best = Math.max(...roadDirs.map(([dx, dz]) => fx * dx + fz * dz))
        expect(best).toBeGreaterThan(Math.cos(0.15))
        checked++
      }
    }
    expect(checked).toBeGreaterThan(15)
  })

  it('on a corner lot each house faces the street it stands nearest to', () => {
    const W = 5
    const road = structureCode('road')
    const frame = withLayers(makeFrame(W, W), (l) => {
      l.structure[2 * W + 3] = road // east of (2,2)
      l.structure[3 * W + 2] = road // south of (2,2)
      l.structure[2 * W + 2] = structureCode('housing')
      l.structureLevel[2 * W + 2] = 3
    })
    const t = computeBuildings(frame, terrainHeights(frame.terrain))
    const base = (2 * W + 2) * BUILD_SLOTS
    const dirs = [0, 1, 2, 3].map((k) => front(t.rot[(base + k) * 2]))
    // house 0 sits north-west (offset -x, -z): nearer neither road, faces one of them
    // house 3 sits south-east (offset +x, +z): both roads; houses 1 (north-east) and 2 (south-west)
    // face east and south respectively
    expect(dirs[1][0]).toBeGreaterThan(0.95)
    expect(dirs[2][1]).toBeGreaterThan(0.95)
  })
})

describe('preview tiles lie on the drawn terrain facets', () => {
  function worstFaceGap(h: Float32Array, t: Terrain, cells: number[], lift: number) {
    const tiles = buildTiles(cells, cells.map(() => 1), h, t, lift)
    const pos = tiles.positions
    const idx = tiles.indices
    let worst = Infinity
    for (let tri = 0; tri < idx.length / 3; tri++) {
      // sample the face centre and the three edge midpoints against the drawn surface
      const v = [0, 1, 2].map((k) => idx[tri * 3 + k])
      const pts: [number, number, number][] = [
        [1 / 3, 1 / 3, 1 / 3],
        [0.5, 0.5, 0],
        [0, 0.5, 0.5],
        [0.5, 0, 0.5],
      ]
      for (const w of pts) {
        let x = 0
        let y = 0
        let z = 0
        for (let k = 0; k < 3; k++) {
          x += pos[v[k] * 3] * w[k]
          y += pos[v[k] * 3 + 1] * w[k]
          z += pos[v[k] * 3 + 2] * w[k]
        }
        worst = Math.min(worst, y - meshHeightAt(h, t, TERRAIN_SUB, x, z))
      }
    }
    return worst
  }

  it('uses the terrain subdivision and covers the whole cell', () => {
    expect(TILE_SUB).toBe(TERRAIN_SUB)
    const f = makeFrame(4, 4)
    const tiles = buildTiles([5], [1], terrainHeights(f.terrain), f.terrain)
    const xs = Array.from({ length: tiles.positions.length / 3 }, (_, v) => tiles.positions[v * 3])
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1, 6)
  })

  it('every tile face sits exactly its lift above the terrain on the default real world (Kaani)', () => {
    const t = kaani()
    const h = terrainHeights(t)
    const all = Array.from({ length: t.width * t.height }, (_, i) => i)
    const gap = worstFaceGap(h, t, all, 0.05)
    expect(gap).toBeGreaterThan(0.05 - 1e-3)
    // and the tile triangles are the terrain triangles: face centres match the surface plus lift
    const tiles = buildTiles(all, all.map(() => 1), h, t, 0.05)
    for (let tri = 0; tri < tiles.indices.length / 3; tri += 97) {
      let x = 0
      let y = 0
      let z = 0
      for (let k = 0; k < 3; k++) {
        const v = tiles.indices[tri * 3 + k]
        x += tiles.positions[v * 3] / 3
        y += tiles.positions[v * 3 + 1] / 3
        z += tiles.positions[v * 3 + 2] / 3
      }
      expect(y - 0.05).toBeCloseTo(meshHeightAt(h, t, TERRAIN_SUB, x, z), 3)
    }
  })
})

describe('weather particles start on the ground', () => {
  it('rain and dust bases follow the ground height under the view', () => {
    const t = kaani()
    const h = terrainHeights(t)
    let hi = 0
    let hiCell = 0
    for (let i = 0; i < h.length; i++)
      if (h[i] > hi) {
        hi = h[i]
        hiCell = i
      }
    const x = (hiCell % t.width) - t.width / 2 + 0.5
    const z = Math.floor(hiCell / t.width) - t.height / 2 + 0.5
    const g = heightAt(h, t, x, z)
    expect(g).toBeGreaterThan(5)
    const b = particleBases(g)
    expect(b.rainY).toBeCloseTo(g, 6)
    expect(b.dustY).toBeCloseTo(g + DUST_LIFT, 6)
    expect(particleBases(null)).toEqual({ rainY: 0, dustY: DUST_LIFT })
  })

  it('the base eases toward a new ground height and snaps when told to', () => {
    expect(easeBase(Number.NaN, 7, 0.016, false)).toBe(7)
    expect(easeBase(0, 7, 0.016, true)).toBe(7)
    const mid = easeBase(0, 7, 0.1, false)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(7)
  })
})

describe('runoff chevrons', () => {
  it('bigger flows are larger and faster, and every chevron stays on its own half cell', () => {
    let prevSize = 0
    let prevSpeed = 0
    for (let k = 0; k <= 10; k++) {
      const st = k / 10
      expect(arrowSize(st)).toBeGreaterThan(prevSize)
      expect(arrowWorldSpeed(st)).toBeGreaterThan(prevSpeed)
      expect(arrowWorldTravel(st)).toBeCloseTo(arrowWorldTravel(0), 9)
      expect(arrowWorldTravel(st)).toBeLessThanOrEqual(0.5)
      prevSize = arrowSize(st)
      prevSpeed = arrowWorldSpeed(st)
    }
    expect(arrowSpeed(1)).toBeGreaterThan(arrowSpeed(0.1))
  })
})

describe('rotate command orbits the target', () => {
  it('keeps distance and height constant through the turn', () => {
    const from = { target: [2, 1, -3] as [number, number, number], position: [2 + 20, 1 + 18, -3 + 5] as [number, number, number] }
    const dist = (s: typeof from) => Math.hypot(s.position[0] - s.target[0], s.position[1] - s.target[1], s.position[2] - s.target[2])
    const d0 = dist(from)
    for (const e of [0, 0.25, 0.5, 0.75, 1]) {
      const s = orbitAt(from, Math.PI / 4, e)
      expect(dist(s)).toBeCloseTo(d0, 6)
      expect(s.position[1]).toBeCloseTo(from.position[1], 6)
      expect(s.target).toEqual(from.target)
    }
    // the end state is the 45 degree turn the old code computed
    const end = orbitAt(from, Math.PI / 4, 1)
    const ox = 20 * Math.cos(Math.PI / 4) - 5 * Math.sin(Math.PI / 4)
    expect(end.position[0]).toBeCloseTo(2 + ox, 6)
  })
})

describe('overlay ids', () => {
  it('OVERLAYS covers the store OverlayId, including urban and susceptibility', () => {
    const ids: OverlayId[] = ['urban', 'susceptibility']
    for (const id of ids) expect(OVERLAYS[id].id).toBe(id)
  })
})
