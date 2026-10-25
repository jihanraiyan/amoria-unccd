// Geometry for cell highlights: draped tiles (tool preview) and region outlines (hover,
// selection). Pure builders over the height field so they follow the terrain exactly.
import { TERRAIN_SUB, cellToWorld, heightAt, type GridDims } from '../core/coords'

/**
 * Tiles are built on the terrain mesh's own vertex grid (same subdivision, same alternating
 * diagonal), so every tile face lies exactly on a drawn terrain facet plus the lift and never
 * dips under a ridge crease. The visual inset is done in the shader from the local coordinate.
 */
export const TILE_SUB = TERRAIN_SUB

/** Inset of the drawn tile from the cell border, in local 0..1 units (applied in the shader). */
export const TILE_INSET = 0.03

/** Per-tile states read by the preview tile shader (anything at or below 0.25 is drawn blocked). */
export const TILE_STATE = { valid: 1, pending: 0.5, actionBlocked: 0.25, invalid: 0 } as const

/**
 * Tile states for a tool preview. A parcel shows valid only when it passes on its own AND the
 * whole action passes: when the action as a whole is refused (for example the player cannot
 * afford it) every tile is drawn blocked, so the world never says go while the commit says no.
 */
export function previewTileStates(validation: { ok: boolean; cellOk: readonly (boolean | undefined)[] }, count: number): number[] {
  const out: number[] = []
  for (let k = 0; k < count; k++) {
    const ok = validation.cellOk[k]
    if (ok === false) out.push(TILE_STATE.invalid)
    else if (!validation.ok) out.push(TILE_STATE.actionBlocked)
    else out.push(ok === undefined ? TILE_STATE.pending : TILE_STATE.valid)
  }
  return out
}

export interface TileData {
  positions: Float32Array
  /** per-vertex: 1 valid, 0 invalid, 0.25 parcel fine but the whole action refused, 0.5 not yet validated */
  state: Float32Array
  /** per-vertex local cell coordinates 0..1 */
  local: Float32Array
  indices: Uint32Array
}

/**
 * Draped tiles for a set of cells, lifted slightly above the ground. Vertices are the terrain
 * mesh vertices of each cell (TERRAIN_SUB per side, heights from the drawn surface) and the
 * triangles use the terrain's (k + j) % 2 diagonal rule in global vertex indices, so each tile
 * triangle is a terrain triangle raised by `lift`.
 */
export function buildTiles(cells: readonly number[], states: readonly number[], heights: ArrayLike<number>, dims: GridDims, lift = 0.05): TileData {
  const vpc = (TILE_SUB + 1) * (TILE_SUB + 1)
  const positions = new Float32Array(cells.length * vpc * 3)
  const state = new Float32Array(cells.length * vpc)
  const local = new Float32Array(cells.length * vpc * 2)
  const indices = new Uint32Array(cells.length * TILE_SUB * TILE_SUB * 6)
  let v = 0
  let t = 0
  for (let c = 0; c < cells.length; c++) {
    const { x: cx, z: cz } = cellToWorld(cells[c], dims)
    const gx = (cells[c] % dims.width) * TILE_SUB
    const gz = Math.floor(cells[c] / dims.width) * TILE_SUB
    const base = v
    for (let j = 0; j <= TILE_SUB; j++) {
      for (let k = 0; k <= TILE_SUB; k++) {
        const u = k / TILE_SUB
        const w = j / TILE_SUB
        const x = cx - 0.5 + u
        const z = cz - 0.5 + w
        positions[v * 3] = x
        positions[v * 3 + 1] = heightAt(heights, dims, x, z) + lift
        positions[v * 3 + 2] = z
        state[v] = states[c]
        local[v * 2] = u
        local[v * 2 + 1] = w
        v++
      }
    }
    for (let j = 0; j < TILE_SUB; j++) {
      for (let k = 0; k < TILE_SUB; k++) {
        const a = base + j * (TILE_SUB + 1) + k
        const b = a + 1
        const d = a + TILE_SUB + 1
        const e = d + 1
        // same winding and diagonal as buildTerrainGeometry (a, b top row; d, e next row)
        if ((gx + k + gz + j) % 2 === 0) {
          indices[t++] = a
          indices[t++] = d
          indices[t++] = b
          indices[t++] = b
          indices[t++] = d
          indices[t++] = e
        } else {
          indices[t++] = a
          indices[t++] = d
          indices[t++] = e
          indices[t++] = a
          indices[t++] = e
          indices[t++] = b
        }
      }
    }
  }
  return { positions, state, local, indices }
}

/**
 * Ribbon outline around the boundary of a cell region (edges shared with cells outside the
 * set). Each boundary edge becomes a strip of quads draped on the terrain, inset into the region.
 */
export function buildOutline(cells: readonly number[], heights: ArrayLike<number>, dims: GridDims, width = 0.07, lift = 0.07, segments = 4): Float32Array {
  const set = new Set(cells)
  const out: number[] = []
  const { width: W, height: H } = dims
  const inSet = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < H && set.has(z * W + x)
  const pushQuad = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number) => {
    // edge from a to b, inward normal n
    for (let s = 0; s < segments; s++) {
      const t0 = s / segments
      const t1 = (s + 1) / segments
      const p0x = ax + (bx - ax) * t0
      const p0z = az + (bz - az) * t0
      const p1x = ax + (bx - ax) * t1
      const p1z = az + (bz - az) * t1
      const q0x = p0x + nx * width
      const q0z = p0z + nz * width
      const q1x = p1x + nx * width
      const q1z = p1z + nz * width
      const y = (x: number, z: number) => heightAt(heights, dims, x, z) + lift
      out.push(p0x, y(p0x, p0z), p0z, q0x, y(q0x, q0z), q0z, p1x, y(p1x, p1z), p1z)
      out.push(p1x, y(p1x, p1z), p1z, q0x, y(q0x, q0z), q0z, q1x, y(q1x, q1z), q1z)
    }
  }
  for (const i of set) {
    const x = i % W
    const z = Math.floor(i / W)
    const { x: cx, z: cz } = cellToWorld(i, dims)
    const x0 = cx - 0.5
    const x1 = cx + 0.5
    const z0 = cz - 0.5
    const z1 = cz + 0.5
    if (!inSet(x, z - 1)) pushQuad(x0, z0, x1, z0, 0, 1)
    if (!inSet(x, z + 1)) pushQuad(x1, z1, x0, z1, 0, -1)
    if (!inSet(x - 1, z)) pushQuad(x0, z1, x0, z0, 1, 0)
    if (!inSet(x + 1, z)) pushQuad(x1, z0, x1, z1, -1, 0)
  }
  return Float32Array.from(out)
}
