// Terrain mesh data: a shared-vertex heightfield subdivided SUB times per cell, plus a
// "diorama" skirt down the edges. Colors are bilinear blends of per-cell ground colors, so
// neighbouring land covers fade into each other instead of forming hard squares.
import { BufferAttribute, BufferGeometry } from 'three'
import { coverCode, structureCode, type Terrain } from '../../simulation/types'
import { sampleBilinear, type GridDims } from '../core/coords'
import { lookOf, type WorldFrame } from '../core/frame'
import { hash01 } from '../core/hash'
import { PALETTE, clamp01, seasonDryness, surfaceColor } from '../core/palette'
import { EROSION_VISUAL_REF } from '../core/visualRefs'

export const SKIRT_DEPTH = 3.5

export interface TerrainGrid {
  sub: number
  /** vertices per row/column of the surface grid */
  vx: number
  vz: number
  /** number of surface vertices (skirt vertices follow) */
  surfaceCount: number
  /** brightness jitter per surface vertex (stylised low-poly variation) */
  jitter: Float32Array
  /** per-cell scratch channels (r, g, b) reused by writeVertexColors on every blend frame */
  channels: [Float32Array, Float32Array, Float32Array]
}

/** Build the terrain BufferGeometry (positions, indices, normals; colors start neutral). */
export function buildTerrainGeometry(terrain: Terrain, heights: Float32Array, sub: number): { geometry: BufferGeometry; grid: TerrainGrid } {
  const dims: GridDims = terrain
  const vx = terrain.width * sub + 1
  const vz = terrain.height * sub + 1
  const surfaceCount = vx * vz
  const perimeter = 2 * (vx - 1) + 2 * (vz - 1)
  const total = surfaceCount + perimeter * 2
  const pos = new Float32Array(total * 3)
  const jitter = new Float32Array(surfaceCount)
  let minY = Infinity
  for (let j = 0; j < vz; j++) {
    for (let k = 0; k < vx; k++) {
      const v = j * vx + k
      const x = -terrain.width / 2 + k / sub
      const z = -terrain.height / 2 + j / sub
      const y = sampleBilinear(heights, dims, x, z)
      pos[v * 3] = x
      pos[v * 3 + 1] = y
      pos[v * 3 + 2] = z
      if (y < minY) minY = y
      jitter[v] = (hash01(k, j, 991) - 0.5) * 0.09
    }
  }
  const indices: number[] = []
  for (let j = 0; j < vz - 1; j++) {
    for (let k = 0; k < vx - 1; k++) {
      const a = j * vx + k
      const b = a + 1
      const c = a + vx
      const d = c + 1
      // alternate the diagonal for a less regular low-poly look
      if ((k + j) % 2 === 0) indices.push(a, c, b, b, c, d)
      else indices.push(a, c, d, a, d, b)
    }
  }
  // skirt: walk the perimeter clockwise (seen from above), duplicate top and bottom vertices
  const ring: number[] = []
  for (let k = 0; k < vx - 1; k++) ring.push(k) // north edge (z min), west->east
  for (let j = 0; j < vz - 1; j++) ring.push(j * vx + (vx - 1)) // east edge
  for (let k = vx - 1; k > 0; k--) ring.push((vz - 1) * vx + k) // south edge
  for (let j = vz - 1; j > 0; j--) ring.push(j * vx) // west edge
  const bottomY = (Number.isFinite(minY) ? minY : 0) - SKIRT_DEPTH
  for (let r = 0; r < ring.length; r++) {
    const src = ring[r]
    const top = surfaceCount + r * 2
    const bot = top + 1
    pos[top * 3] = pos[src * 3]
    pos[top * 3 + 1] = pos[src * 3 + 1]
    pos[top * 3 + 2] = pos[src * 3 + 2]
    pos[bot * 3] = pos[src * 3]
    pos[bot * 3 + 1] = bottomY
    pos[bot * 3 + 2] = pos[src * 3 + 2]
  }
  for (let r = 0; r < ring.length; r++) {
    const t0 = surfaceCount + r * 2
    const b0 = t0 + 1
    const t1 = surfaceCount + ((r + 1) % ring.length) * 2
    const b1 = t1 + 1
    indices.push(t0, t1, b0, b0, t1, b1)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(pos, 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(total * 3).fill(0.6), 3))
  // 1 on the playable surface, 0 on the skirt: the overlay and its cue stay off the map's sides
  const surface = new Float32Array(total)
  surface.fill(1, 0, surfaceCount)
  geometry.setAttribute('aSurface', new BufferAttribute(surface, 1))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  const n = terrain.width * terrain.height
  return { geometry, grid: { sub, vx, vz, surfaceCount, jitter, channels: [new Float32Array(n), new Float32Array(n), new Float32Array(n)] } }
}

const ROAD = structureCode('road')
const WATER = coverCode('water')

/** Per-cell ground colors (linear RGB, 3 floats per cell) for a frame. */
export function computeCellColors(frame: WorldFrame, out?: Float32Array, colorblind = false): Float32Array {
  const { terrain, layers, fields } = frame
  const n = terrain.width * terrain.height
  const res = out && out.length === n * 3 ? out : new Float32Array(n * 3)
  let eLo = Infinity
  let eHi = -Infinity
  for (let i = 0; i < n; i++) {
    const e = terrain.elevationM[i]
    if (e < eLo) eLo = e
    if (e > eHi) eHi = e
  }
  const eSpan = eHi > eLo ? eHi - eLo : 1
  const look = lookOf(frame)
  const dryness = seasonDryness(look.season, look.weather)
  for (let i = 0; i < n; i++) {
    const cover = terrain.channel[i] ? WATER : layers.cover[i]
    const c = surfaceColor({
      cover,
      soilHealth: layers.soilHealth[i],
      vegetation: layers.vegetation[i],
      waterFactor: frame.fieldsReady ? fields.waterFactor[i] : null,
      erosionNorm: frame.fieldsReady ? clamp01(fields.erosion[i] / EROSION_VISUAL_REF) : 0,
      slope: terrain.slope[i],
      elevationNorm: (terrain.elevationM[i] - eLo) / eSpan,
      dryness,
      // a bridge spans the water; the river bed under it is not paved
      isRoad: layers.structure[i] === ROAD && cover !== WATER,
      colorblind,
    })
    res[i * 3] = c[0]
    res[i * 3 + 1] = c[1]
    res[i * 3 + 2] = c[2]
  }
  return res
}

/** Write vertex colors from per-cell colors (bilinear blend + jitter + strata on the skirt). */
export function writeVertexColors(geometry: BufferGeometry, grid: TerrainGrid, dims: GridDims, cellColors: Float32Array): void {
  const attr = geometry.getAttribute('color') as BufferAttribute
  const pos = geometry.getAttribute('position') as BufferAttribute
  const col = attr.array as Float32Array
  const p = pos.array as Float32Array
  const n = dims.width * dims.height
  const ch = grid.channels[0].length === n ? grid.channels : [new Float32Array(n), new Float32Array(n), new Float32Array(n)]
  for (let i = 0; i < n; i++) {
    ch[0][i] = cellColors[i * 3]
    ch[1][i] = cellColors[i * 3 + 1]
    ch[2][i] = cellColors[i * 3 + 2]
  }
  for (let v = 0; v < grid.surfaceCount; v++) {
    const x = p[v * 3]
    const z = p[v * 3 + 2]
    const j = 1 + grid.jitter[v]
    col[v * 3] = sampleBilinear(ch[0], dims, x, z) * j
    col[v * 3 + 1] = sampleBilinear(ch[1], dims, x, z) * j
    col[v * 3 + 2] = sampleBilinear(ch[2], dims, x, z) * j
  }
  // skirt: earthy strata, lighter at the top
  const total = attr.count
  for (let v = grid.surfaceCount; v < total; v++) {
    const isBottom = (v - grid.surfaceCount) % 2 === 1
    const c = isBottom ? PALETTE.skirtBottom : PALETTE.skirtTop
    col[v * 3] = c[0]
    col[v * 3 + 1] = c[1]
    col[v * 3 + 2] = c[2]
  }
  attr.needsUpdate = true
}
