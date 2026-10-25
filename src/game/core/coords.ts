// Cell <-> world coordinate mapping and terrain height sampling.
// World space: one grid cell = 1 world unit on x/z. The grid is centred on the origin, so
// cell (x, z) has its centre at (x - width/2 + 0.5, z - height/2 + 0.5). Grid index = z*width + x
// (same as the simulation contract). Heights are elevation relative to the lowest cell, in
// cell units, times a vertical exaggeration so a 64 x 64 valley reads as hills from above.
import type { Terrain } from '../../simulation/types'

export interface GridDims {
  width: number
  height: number
}

/** Vertical exaggeration applied to real elevation (metres / cellSizeM) for readability. */
export const VERTICAL_EXAGGERATION = 2.2

/**
 * Terrain mesh subdivisions per cell, on every quality level. Props, roads, highlights and
 * picking all sit on the bilinear surface (heightAt); at 2 subdivisions the rendered triangles
 * match it closely, at 1 they depart by up to 0.4 units, so low quality keeps 2 (the terrain is
 * only about 33k triangles on a 64 x 64 map).
 */
export const TERRAIN_SUB = 2

export const cellX = (i: number, width: number) => i % width
export const cellZ = (i: number, width: number) => Math.floor(i / width)
export const cellIndex = (x: number, z: number, width: number) => z * width + x

export function inBounds(x: number, z: number, dims: GridDims): boolean {
  return x >= 0 && z >= 0 && x < dims.width && z < dims.height
}

/** World-space x/z of a cell centre. */
export function cellToWorld(i: number, dims: GridDims): { x: number; z: number } {
  const cx = i % dims.width
  const cz = Math.floor(i / dims.width)
  return { x: cx - dims.width / 2 + 0.5, z: cz - dims.height / 2 + 0.5 }
}

/** Grid index of the cell containing world point (x, z), or -1 outside the grid. */
export function worldToCell(x: number, z: number, dims: GridDims): number {
  const cx = Math.floor(x + dims.width / 2)
  const cz = Math.floor(z + dims.height / 2)
  if (!inBounds(cx, cz, dims)) return -1
  return cz * dims.width + cx
}

/** World-space extents of the grid: [minX, maxX, minZ, maxZ]. */
export function worldBounds(dims: GridDims): [number, number, number, number] {
  return [-dims.width / 2, dims.width / 2, -dims.height / 2, dims.height / 2]
}

/** Per-cell world heights (cell-centre samples) from terrain elevation. */
export function computeCellHeights(elevationM: Float32Array, cellSizeM: number, exaggeration = VERTICAL_EXAGGERATION): Float32Array {
  let min = Infinity
  for (let i = 0; i < elevationM.length; i++) if (elevationM[i] < min) min = elevationM[i]
  if (!Number.isFinite(min)) min = 0
  const out = new Float32Array(elevationM.length)
  const k = exaggeration / (cellSizeM > 0 ? cellSizeM : 1)
  for (let i = 0; i < elevationM.length; i++) {
    const e = elevationM[i]
    out[i] = Number.isFinite(e) ? (e - min) * k : 0
  }
  return out
}

const heightCache = new WeakMap<Terrain, Float32Array>()

/** Cached per-cell world heights for a terrain object (terrain is static per world). */
export function terrainHeights(terrain: Terrain): Float32Array {
  let h = heightCache.get(terrain)
  if (!h) {
    h = computeCellHeights(terrain.elevationM, terrain.cellSizeM)
    heightCache.set(terrain, h)
  }
  return h
}

/**
 * Bilinear interpolation of a per-cell-centre field at world point (x, z).
 * Outside the grid the nearest edge value is used, so the surface never has gaps.
 */
export function sampleBilinear(field: ArrayLike<number>, dims: GridDims, x: number, z: number): number {
  const { width, height } = dims
  let u = x + width / 2 - 0.5
  let v = z + height / 2 - 0.5
  if (u < 0) u = 0
  else if (u > width - 1) u = width - 1
  if (v < 0) v = 0
  else if (v > height - 1) v = height - 1
  const x0 = Math.floor(u)
  const z0 = Math.floor(v)
  const x1 = x0 + 1 < width ? x0 + 1 : x0
  const z1 = z0 + 1 < height ? z0 + 1 : z0
  const tx = u - x0
  const tz = v - z0
  const a = field[z0 * width + x0]
  const b = field[z0 * width + x1]
  const c = field[z1 * width + x0]
  const d = field[z1 * width + x1]
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz
}

/**
 * Terrain surface height at world (x, z): the height of the drawn triangles, so props, roads,
 * highlights and picking sit exactly on what is rendered. At the mesh vertices this equals the
 * bilinear field (sampleBilinear); between them it follows the flat facets.
 */
export function heightAt(heights: ArrayLike<number>, dims: GridDims, x: number, z: number): number {
  return meshHeightAt(heights, dims, TERRAIN_SUB, x, z)
}

/** Downhill gradient direction (unit x/z) of the surface at a cell, from central differences. */
export function cellGradient(heights: ArrayLike<number>, dims: GridDims, i: number): { gx: number; gz: number; mag: number } {
  const { width, height } = dims
  const x = i % width
  const z = Math.floor(i / width)
  const xl = Math.max(0, x - 1)
  const xr = Math.min(width - 1, x + 1)
  const zu = Math.max(0, z - 1)
  const zd = Math.min(height - 1, z + 1)
  const dx = (heights[z * width + xr] - heights[z * width + xl]) / Math.max(1, xr - xl)
  const dz = (heights[zd * width + x] - heights[zu * width + x]) / Math.max(1, zd - zu)
  const mag = Math.hypot(dx, dz)
  if (mag < 1e-6) return { gx: 0, gz: 0, mag: 0 }
  return { gx: dx / mag, gz: dz / mag, mag }
}

/**
 * Height of the rendered terrain triangles (buildTerrainGeometry with `sub` subdivisions and
 * alternating diagonals) at world (x, z). Used to check that draped geometry stays on top.
 */
export function meshHeightAt(heights: ArrayLike<number>, dims: GridDims, sub: number, x: number, z: number): number {
  const vx = dims.width * sub
  const vz = dims.height * sub
  const grid = vertexHeights(heights, dims, sub)
  const u = Math.min(vx, Math.max(0, (x + dims.width / 2) * sub))
  const v = Math.min(vz, Math.max(0, (z + dims.height / 2) * sub))
  const k = Math.min(vx - 1, Math.floor(u))
  const j = Math.min(vz - 1, Math.floor(v))
  const fu = u - k
  const fv = v - j
  const row = vx + 1
  const ha = grid[j * row + k]
  const hb = grid[j * row + k + 1]
  const hc = grid[(j + 1) * row + k]
  const hd = grid[(j + 1) * row + k + 1]
  if ((k + j) % 2 === 0) {
    // diagonal b-c: triangles (a, c, b) and (b, c, d)
    if (fu + fv <= 1) return ha + (hb - ha) * fu + (hc - ha) * fv
    return hd + (hc - hd) * (1 - fu) + (hb - hd) * (1 - fv)
  }
  // diagonal a-d: triangles (a, c, d) and (a, d, b)
  if (fu >= fv) return ha + (hb - ha) * fu + (hd - hb) * fv
  return ha + (hc - ha) * fv + (hd - hc) * fu
}

interface VertexGrids {
  width: number
  height: number
  /** vertex grid per subdivision count (the renderer only uses TERRAIN_SUB) */
  bySub: (Float32Array | undefined)[]
}
const vertexCache = new WeakMap<object, VertexGrids>()

/**
 * Heights of the terrain mesh vertices (bilinear samples on the subdivided grid), cached per
 * heights array. Picking calls this hundreds of times per frame, so the lookup is one WeakMap
 * get, two number compares and an array index (no string keys).
 */
function vertexHeights(heights: ArrayLike<number>, dims: GridDims, sub: number): Float32Array {
  let entry = vertexCache.get(heights as object)
  if (!entry || entry.width !== dims.width || entry.height !== dims.height) {
    entry = { width: dims.width, height: dims.height, bySub: [] }
    vertexCache.set(heights as object, entry)
  }
  const hit = entry.bySub[sub]
  if (hit) return hit
  const vx = dims.width * sub + 1
  const vz = dims.height * sub + 1
  const grid = new Float32Array(vx * vz)
  for (let j = 0; j < vz; j++)
    for (let k = 0; k < vx; k++) grid[j * vx + k] = sampleBilinear(heights, dims, -dims.width / 2 + k / sub, -dims.height / 2 + j / sub)
  entry.bySub[sub] = grid
  return grid
}
