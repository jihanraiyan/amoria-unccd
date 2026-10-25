// Water surface geometry: rivers and lakes on channel/water cells, shallow pools on wetlands,
// reservoirs, and flood water where the simulation reports it.
//
// Rivers, pools and floods share one surface. Its level field is extended one cell past the
// water, but each extended (dry) cell is held just below its own ground, so the shoreline
// falls between the water cell and the bank centre and dry land never shows standing water.
// Reservoirs are flat per basin (see core/reservoir.ts) and get their own quads.
//
// River stage follows last season's flow against bankfull capacity (drought lowers the river,
// heavy rain raises it) and the water color follows the sediment it carries (sedimentFlux over
// the volume of water passing), so upstream clearing shows up as muddy water downstream.
// Every vertex carries the ground height below it (depth color, shoreline foam), its turbidity,
// and the level and turbidity it had in the previous build, so the shader can tween changes.
import { BufferAttribute, BufferGeometry } from 'three'
import { coverCode, structureCode } from '../../simulation/types'
import { cellToWorld, sampleBilinear, type GridDims } from '../core/coords'
import type { WorldFrame } from '../core/frame'
import { clamp01 } from '../core/palette'
import { cellGroundRange, reservoirBasins, reservoirLevel } from '../core/reservoir'
import { FLOOD_VISUAL_REF_M, FLOW_STAGE_REF, TURBIDITY_CLEAR, TURBIDITY_MIN_FLOW_MM, TURBIDITY_MUDDY, WETLAND_POOL_REF_MM } from '../core/visualRefs'

export const WATER_KIND = { none: 0, river: 1, wetland: 2, reservoir: 3, flood: 4 } as const

/** How far the river surface sits above the channel bed at a normal stage (world units). */
export const RIVER_DEPTH = 0.17
/** River depth factor at stage 0 (a dry bed with a trickle) and stage 1 (a full river). */
const STAGE_MIN = 0.3
const STAGE_MAX = 1.2
/** Stage shown before any season has been simulated. */
const NEUTRAL_STAGE = 0.5
/** Dry cells next to water hold the surface this far below their own ground. */
export const BANK_CLEARANCE = 0.03
/** Level given to cells with no water, so interpolation dips under the bank. */
const DRY_DEPTH = 0.4

const WATER = coverCode('water')
const WETLAND = coverCode('wetland')
const RESERVOIR = structureCode('reservoir')

export interface WaterCells {
  kind: Uint8Array
  /** world-space water level per cell (NaN where no water) */
  level: Float32Array
  /** 0 clear .. 1 muddy, per cell (0 where there is no water) */
  turbidity: Float32Array
}

/**
 * River stage 0..1 per channel or lake cell (NaN elsewhere): last season's flow over the
 * channel's bankfull capacity, against a fixed display reference, averaged over neighbouring
 * channel cells so the surface does not step. Lake cells without a bankfull value take the
 * mean stage of the channel. Neutral before the first season.
 */
export function riverStage(frame: WorldFrame): Float32Array {
  const { terrain, layers, fields } = frame
  const { width, height } = terrain
  const n = width * height
  const raw = new Float32Array(n).fill(NaN)
  const isRiver = (i: number) => terrain.channel[i] === 1 || layers.cover[i] === WATER
  let sum = 0
  let cnt = 0
  for (let i = 0; i < n; i++) {
    if (!isRiver(i)) continue
    if (!frame.fieldsReady) {
      raw[i] = NEUTRAL_STAGE
      continue
    }
    const bf = terrain.bankfullMm?.[i] ?? 0
    const flow = fields.flowMm?.[i] ?? 0
    if (bf > 0 && Number.isFinite(flow)) {
      raw[i] = clamp01(flow / bf / FLOW_STAGE_REF)
      sum += raw[i]
      cnt++
    }
  }
  const lake = cnt ? sum / cnt : NEUTRAL_STAGE
  for (let i = 0; i < n; i++) if (isRiver(i) && !Number.isFinite(raw[i])) raw[i] = lake
  const out = new Float32Array(n).fill(NaN)
  for (let i = 0; i < n; i++) {
    if (!isRiver(i)) continue
    const x = i % width
    const z = Math.floor(i / width)
    let s = 0
    let c = 0
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        const nz = z + dz
        if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue
        const j = nz * width + nx
        if (!isRiver(j)) continue
        s += raw[j]
        c++
      }
    out[i] = s / c
  }
  return out
}

/** River depth above the bed for a stage 0..1 (world units). Never above the bank clearance cap. */
export const riverDepthForStage = (stage: number) => RIVER_DEPTH * (STAGE_MIN + (STAGE_MAX - STAGE_MIN) * clamp01(stage))

/**
 * Turbidity 0..1 per cell: sediment leaving the cell (fields.sedimentFlux, game tonnes) over the
 * water passing through it (fields.flowMm over the cell area), mapped on a log scale between
 * fixed clear and muddy references. Pure display mapping of model outputs.
 */
export function waterTurbidity(frame: WorldFrame): Float32Array {
  const { terrain, fields } = frame
  const n = terrain.width * terrain.height
  const out = new Float32Array(n)
  if (!frame.fieldsReady || !fields.sedimentFlux || !fields.flowMm) return out
  const area = terrain.cellSizeM * terrain.cellSizeM
  const span = Math.log(TURBIDITY_MUDDY / TURBIDITY_CLEAR)
  for (let i = 0; i < n; i++) {
    const sed = fields.sedimentFlux[i]
    if (!(sed > 0)) continue
    const volumeM3 = (Math.max(TURBIDITY_MIN_FLOW_MM, fields.flowMm[i]) / 1000) * area
    const conc = (sed / volumeM3) * 1e6
    out[i] = clamp01(Math.log(Math.max(conc, TURBIDITY_CLEAR) / TURBIDITY_CLEAR) / span)
  }
  return out
}

/** Fraction 0..1 of reservoir capacity to show; a neutral 0.6 when the level is unknown. */
export function reservoirFill(frame: WorldFrame): number {
  return frame.reservoirFill === null ? 0.6 : clamp01(frame.reservoirFill)
}

/** Per-cell water kind and level for a frame. */
export function computeWaterCells(frame: WorldFrame, heights: Float32Array): WaterCells {
  const { terrain, layers, fields } = frame
  const dims: GridDims = terrain
  const n = terrain.width * terrain.height
  const kind = new Uint8Array(n)
  const level = new Float32Array(n).fill(NaN)
  const turbidity = waterTurbidity(frame)
  const stage = riverStage(frame)
  const fill = reservoirFill(frame)
  const basins = reservoirBasins(layers.structure, RESERVOIR, heights, dims)
  const flooded = frame.fieldsReady ? fields.flooded : undefined
  const floodDepth = frame.fieldsReady ? fields.floodDepthM : undefined
  for (let i = 0; i < n; i++) {
    const h = heights[i]
    const b = basins.basin[i]
    if (b >= 0) {
      kind[i] = WATER_KIND.reservoir
      level[i] = reservoirLevel(basins.bed[b], basins.rim[b], fill)
    } else if (terrain.channel[i] || layers.cover[i] === WATER) {
      kind[i] = WATER_KIND.river
      level[i] = h + riverDepthForStage(stage[i])
    } else if (flooded && flooded[i]) {
      kind[i] = WATER_KIND.flood
      const d = floodDepth ? clamp01((floodDepth[i] ?? 0) / FLOOD_VISUAL_REF_M) : 0.3
      level[i] = h + 0.04 + 0.2 * d
    } else if (layers.cover[i] === WETLAND) {
      const store = layers.wetlandStoreMm?.[i] ?? 0
      if (store > 1) {
        kind[i] = WATER_KIND.wetland
        level[i] = h + 0.008 + 0.06 * clamp01(store / WETLAND_POOL_REF_MM)
      }
    }
  }
  for (let i = 0; i < n; i++) if (!kind[i]) turbidity[i] = 0
  return { kind, level, turbidity }
}

/** Per-cell level fields of one water build, kept so the next build can tween from them. */
export interface WaterLevelField {
  /** shared surface level per cell centre (below ground where there is no water) */
  ext: Float32Array
  /** what ext was when this build started its tween */
  extFrom: Float32Array
  /** cells with shared-surface water in this build */
  include: Uint8Array
  /** water kind per cell used for coloring */
  kind: Uint8Array
  /** flat reservoir level per cell (NaN elsewhere) */
  flat: Float32Array
  flatFrom: Float32Array
  /** turbidity per cell (shared surface spread one cell onto the banks, as the level is) */
  turb: Float32Array
  turbFrom: Float32Array
}

/** The field as displayed part way (e = 0..1, eased) through its tween. */
export function blendWaterField(f: WaterLevelField, e: number): WaterLevelField {
  if (e >= 1) return { ...f, extFrom: f.ext, flatFrom: f.flat, turbFrom: f.turb }
  const lerp = (a: Float32Array, b: Float32Array) => {
    const out = new Float32Array(b.length)
    for (let i = 0; i < b.length; i++) {
      const x = a[i]
      const y = b[i]
      out[i] = Number.isFinite(x) && Number.isFinite(y) ? x + (y - x) * e : y
    }
    return out
  }
  const ext = lerp(f.extFrom, f.ext)
  const flat = lerp(f.flatFrom, f.flat)
  const turb = lerp(f.turbFrom, f.turb)
  return { ...f, ext, extFrom: ext, flat, flatFrom: flat, turb, turbFrom: turb }
}

export interface WaterMeshData {
  positions: Float32Array
  /** level of each vertex at the start of the tween */
  levelFrom: Float32Array
  ground: Float32Array
  /** turbidity 0..1 of each vertex now and at the start of the tween */
  turbidity: Float32Array
  turbidityFrom: Float32Array
  flow: Float32Array
  kind: Float32Array
  indices: Uint32Array
  vertexCount: number
  field: WaterLevelField
}

/**
 * Builds the water surface on a SUB-times subdivided grid. Shared-surface quads cover water
 * cells and their 8 neighbours; reservoirs get flat quads over their exact footprint. With
 * `prev` (the previous build's field, see blendWaterField) every vertex also gets the level it
 * had before, and cells that just lost their water stay in the mesh so they can drain away.
 */
export function buildWaterMesh(frame: WorldFrame, heights: Float32Array, cells: WaterCells, sub: number, prev: WaterLevelField | null = null): WaterMeshData {
  const { terrain } = frame
  const dims: GridDims = terrain
  const { width, height } = terrain
  const n = width * height
  const ext = new Float32Array(n).fill(NaN)
  const extKind = new Uint8Array(n)
  const include = new Uint8Array(n)
  const flat = new Float32Array(n).fill(NaN)
  const turb = new Float32Array(n)
  const isShared = (k: number) => k !== WATER_KIND.none && k !== WATER_KIND.reservoir
  for (let i = 0; i < n; i++) {
    const k = cells.kind[i]
    if (k === WATER_KIND.reservoir) {
      // not part of the shared surface, but rivers flowing in meet the reservoir level
      flat[i] = cells.level[i]
      ext[i] = cells.level[i]
      extKind[i] = k
      turb[i] = cells.turbidity[i]
      continue
    }
    if (isShared(k)) {
      ext[i] = cells.level[i]
      extKind[i] = k
      turb[i] = cells.turbidity[i]
      include[i] = 1
      continue
    }
    const x = i % width
    const z = Math.floor(i / width)
    let sum = 0
    let tsum = 0
    let cnt = 0
    let nk = 0
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        const nz = z + dz
        if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue
        const j = nz * width + nx
        if (!isShared(cells.kind[j])) continue
        sum += cells.level[j]
        tsum += cells.turbidity[j]
        cnt++
        nk = cells.kind[j]
      }
    if (cnt) {
      // a dry bank never holds water at its centre: the shoreline falls before it
      ext[i] = Math.min(sum / cnt, heights[i] - BANK_CLEARANCE)
      extKind[i] = nk
      turb[i] = tsum / cnt
      include[i] = 1
    }
  }
  for (let i = 0; i < n; i++) if (!Number.isFinite(ext[i])) ext[i] = heights[i] - DRY_DEPTH
  // cells with water now; cells that only drain away are added below for this build only
  const own = include.slice()
  const ownKind = extKind.slice()
  if (prev && prev.ext.length === n) {
    for (let i = 0; i < n; i++) {
      if (prev.include[i] && !include[i] && cells.kind[i] !== WATER_KIND.reservoir) {
        include[i] = 1
        if (!extKind[i]) extKind[i] = prev.kind[i]
      }
    }
  }
  const extFrom = prev && prev.ext.length === n ? prev.ext : ext
  const turbFrom = prev && prev.turb?.length === n ? prev.turb : turb
  const prevFlat = prev && prev.flat.length === n ? prev.flat : null

  const vx = width * sub + 1
  const vz = height * sub + 1
  const vertIndex = new Int32Array(vx * vz).fill(-1)
  const positions: number[] = []
  const from: number[] = []
  const ground: number[] = []
  const turbNow: number[] = []
  const turbStart: number[] = []
  const flow: number[] = []
  const kind: number[] = []
  const indices: number[] = []
  const flowDir = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    const to = terrain.flowTo[i]
    if (to < 0 || cells.kind[i] !== WATER_KIND.river) continue
    const a = cellToWorld(i, dims)
    const b = cellToWorld(to, dims)
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1
    flowDir[i * 2] = (b.x - a.x) / l
    flowDir[i * 2 + 1] = (b.z - a.z) / l
  }
  const push = (x: number, y: number, z: number, y0: number, fx: number, fz: number, k: number, tb: number, tb0: number) => {
    const idx = positions.length / 3
    positions.push(x, y, z)
    from.push(y0)
    // the terrain's own vertex heights, so aGround matches the drawn ground at every vertex
    ground.push(sampleBilinear(heights, dims, x, z))
    turbNow.push(tb)
    turbStart.push(tb0)
    flow.push(fx, fz)
    kind.push(k)
    return idx
  }
  const vertex = (k: number, j: number) => {
    const id = j * vx + k
    if (vertIndex[id] >= 0) return vertIndex[id]
    const x = -width / 2 + k / sub
    const z = -height / 2 + j / sub
    const cx = Math.min(width - 1, Math.max(0, Math.floor(x + width / 2 - (k === vx - 1 ? 1e-6 : 0))))
    const cz = Math.min(height - 1, Math.max(0, Math.floor(z + height / 2 - (j === vz - 1 ? 1e-6 : 0))))
    const c = cz * width + cx
    const idx = push(
      x,
      sampleBilinear(ext, dims, x, z),
      z,
      sampleBilinear(extFrom, dims, x, z),
      flowDir[c * 2],
      flowDir[c * 2 + 1],
      extKind[c],
      sampleBilinear(turb, dims, x, z),
      sampleBilinear(turbFrom, dims, x, z),
    )
    vertIndex[id] = idx
    return idx
  }
  for (let cz = 0; cz < height; cz++) {
    for (let cx = 0; cx < width; cx++) {
      if (!include[cz * width + cx]) continue
      for (let sj = 0; sj < sub; sj++) {
        for (let sk = 0; sk < sub; sk++) {
          const k = cx * sub + sk
          const j = cz * sub + sj
          const a = vertex(k, j)
          const b = vertex(k + 1, j)
          const c = vertex(k, j + 1)
          const d = vertex(k + 1, j + 1)
          // same diagonal rule as the terrain, so aGround interpolates to the drawn ground
          if ((k + j) % 2 === 0) indices.push(a, c, b, b, c, d)
          else indices.push(a, c, d, a, d, b)
        }
      }
    }
  }
  // flat reservoir quads (own vertices: the level is constant over the basin)
  for (let i = 0; i < n; i++) {
    const now = flat[i]
    const before = prevFlat ? prevFlat[i] : NaN
    if (!Number.isFinite(now) && !Number.isFinite(before)) continue
    const [lo] = cellGroundRange(heights, dims, i)
    const empty = lo - 0.05
    const target = Number.isFinite(now) ? now : empty
    const start = prev ? (Number.isFinite(before) ? before : empty) : target
    const { x: cx, z: cz } = cellToWorld(i, dims)
    const x0 = i % width
    const z0 = Math.floor(i / width)
    const base = positions.length / 3
    for (let sj = 0; sj <= sub; sj++)
      for (let sk = 0; sk <= sub; sk++) push(cx - 0.5 + sk / sub, target, cz - 0.5 + sj / sub, start, 0, 0, WATER_KIND.reservoir, turb[i], turbFrom[i])
    for (let sj = 0; sj < sub; sj++)
      for (let sk = 0; sk < sub; sk++) {
        const a = base + sj * (sub + 1) + sk
        const b = a + 1
        const c = a + sub + 1
        const d = c + 1
        // the quad's position on the terrain's vertex grid decides its diagonal, as there
        if ((x0 * sub + sk + z0 * sub + sj) % 2 === 0) indices.push(a, c, b, b, c, d)
        else indices.push(a, c, d, a, d, b)
      }
  }
  const field: WaterLevelField = {
    ext,
    extFrom,
    include: own,
    kind: ownKind,
    flat,
    flatFrom: prevFlat ?? flat,
    turb,
    turbFrom,
  }
  return {
    positions: Float32Array.from(positions),
    levelFrom: Float32Array.from(from),
    ground: Float32Array.from(ground),
    turbidity: Float32Array.from(turbNow),
    turbidityFrom: Float32Array.from(turbStart),
    flow: Float32Array.from(flow),
    kind: Float32Array.from(kind),
    indices: Uint32Array.from(indices),
    vertexCount: positions.length / 3,
    field,
  }
}

export function waterGeometry(data: WaterMeshData): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(data.positions, 3))
  g.setAttribute('aLevelFrom', new BufferAttribute(data.levelFrom, 1))
  g.setAttribute('aGround', new BufferAttribute(data.ground, 1))
  g.setAttribute('aTurbidity', new BufferAttribute(data.turbidity, 1))
  g.setAttribute('aTurbidityFrom', new BufferAttribute(data.turbidityFrom, 1))
  g.setAttribute('aFlow', new BufferAttribute(data.flow, 2))
  g.setAttribute('aKind', new BufferAttribute(data.kind, 1))
  g.setIndex(new BufferAttribute(data.indices, 1))
  g.computeBoundingSphere()
  // levels move in the vertex shader; pad the bounds so the tween is never culled
  if (g.boundingSphere) g.boundingSphere.radius += 1
  return g
}
