// Deterministic placement of every instanced prop (trees, plants, crop rows, terraces,
// gullies, roads, buildings). Each cell owns a fixed number of "slots"; a slot is either
// empty (kind -1) or holds one prop with a transform and color. Placement depends only on
// the frame and the cell/slot index, so the same state always produces the same world and a
// change to one cell never moves props elsewhere. The animator tweens between targets.
import { maturity as modelMaturity } from '../../simulation/models/vegetation'
import { VEG } from '../../simulation/params'
import { coverCode, structureCode, type Season } from '../../simulation/types'
import { cellGradient, cellToWorld, heightAt, type GridDims } from './coords'
import { EMBANKMENT_MIN_HEIGHT, embankmentCrest, reservoirBasins, type ReservoirBasins } from './reservoir'
import { lookOf, type WorldFrame } from './frame'
import { hash01, hashRange } from './hash'
import { COLORBLIND_TINTS, FOLIAGE, PALETTE, ROOFS, AWNINGS, clamp01, linear, mix, seasonDryness, smoothstep, type RGB } from './palette'
import { overlayDomain } from './overlays'
import { EROSION_VISUAL_REF, SILT_FAN_MIN, SILT_VISUAL_REF } from './visualRefs'
import { riverDepthForStage } from '../water/waterData'

export interface SlotTargets {
  slotsPerCell: number
  /** Prop kind per slot, -1 = empty. Kind meaning depends on the layer. */
  kind: Int8Array
  /** x, y, z per slot. */
  pos: Float32Array
  /** yaw, pitch per slot (radians). Local +X is the prop's length axis. */
  rot: Float32Array
  /** x, y, z scale per slot. */
  scale: Float32Array
  /** linear RGB per slot. */
  color: Float32Array
}

export function createSlotTargets(cells: number, slotsPerCell: number): SlotTargets {
  const n = cells * slotsPerCell
  return {
    slotsPerCell,
    kind: new Int8Array(n).fill(-1),
    pos: new Float32Array(n * 3),
    rot: new Float32Array(n * 2),
    scale: new Float32Array(n * 3),
    color: new Float32Array(n * 3),
  }
}

function setSlot(t: SlotTargets, s: number, kind: number, x: number, y: number, z: number, yaw: number, pitch: number, sx: number, sy: number, sz: number, c: RGB) {
  t.kind[s] = kind
  t.pos[s * 3] = x
  t.pos[s * 3 + 1] = y
  t.pos[s * 3 + 2] = z
  t.rot[s * 2] = yaw
  t.rot[s * 2 + 1] = pitch
  t.scale[s * 3] = sx
  t.scale[s * 3 + 1] = sy
  t.scale[s * 3 + 2] = sz
  t.color[s * 3] = c[0]
  t.color[s * 3 + 1] = c[1]
  t.color[s * 3 + 2] = c[2]
}

/** Number of non-empty slots of a given kind (or all kinds when kind is omitted). */
export function countKind(t: SlotTargets, kind?: number): number {
  let n = 0
  for (let s = 0; s < t.kind.length; s++) if (kind === undefined ? t.kind[s] >= 0 : t.kind[s] === kind) n++
  return n
}

const C = {
  forest: coverCode('forest'),
  grassland: coverCode('grassland'),
  cropland: coverCode('cropland'),
  agroforestry: coverCode('agroforestry'),
  urban: coverCode('urban'),
  wetland: coverCode('wetland'),
  water: coverCode('water'),
  bare: coverCode('bare'),
}
const S = {
  none: structureCode('none'),
  road: structureCode('road'),
  housing: structureCode('housing'),
  reservoir: structureCode('reservoir'),
  waterworks: structureCode('waterworks'),
  market: structureCode('market'),
}

/**
 * Restoration maturity 0..1 straight from the vegetation model (VEG.matureSeasons: forest 20
 * seasons, agroforestry 12, wetland 6), so a planting looks full grown exactly when the model
 * counts it as mature.
 */
export const maturity = (cover: number, coverAge: number) => clamp01(modelMaturity(cover, coverAge))

function elevationRange(elev: Float32Array): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < elev.length; i++) {
    if (elev[i] < lo) lo = elev[i]
    if (elev[i] > hi) hi = elev[i]
  }
  return [lo, hi > lo ? hi : lo + 1]
}

/** Row direction for a farm cell: along contours when conservation is applied, else a patchwork. */
export function rowAxes(frame: WorldFrame, heights: Float32Array, i: number): { ax: number; az: number; bx: number; bz: number } {
  const dims = frame.terrain
  if (frame.layers.conservation[i]) {
    const g = cellGradient(heights, dims, i)
    if (g.mag > 1e-4) {
      // contour direction is perpendicular to the gradient
      return { ax: -g.gz, az: g.gx, bx: g.gx, bz: g.gz }
    }
  }
  const x = i % dims.width
  const z = Math.floor(i / dims.width)
  const alongX = hash01(x >> 2, z >> 2, 77) < 0.5
  return alongX ? { ax: 1, az: 0, bx: 0, bz: 1 } : { ax: 0, az: 1, bx: 1, bz: 0 }
}

const yawOf = (dx: number, dz: number) => Math.atan2(-dz, dx)

/** Place a thin segment from (x0,z0) to (x1,z1) draped on the terrain. */
function setSegment(
  t: SlotTargets,
  s: number,
  kind: number,
  heights: Float32Array,
  dims: GridDims,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  lift: number,
  width: number,
  height: number,
  c: RGB,
) {
  const y0 = heightAt(heights, dims, x0, z0)
  const y1 = heightAt(heights, dims, x1, z1)
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2
  // the bilinear surface bulges between endpoints; use the max of the midpoint and the chord
  const ym = Math.max(heightAt(heights, dims, cx, cz), (y0 + y1) / 2)
  const dx = x1 - x0
  const dz = z1 - z0
  const horiz = Math.hypot(dx, dz)
  const pitch = Math.atan2(y1 - y0, horiz)
  const len = Math.hypot(horiz, y1 - y0)
  setSlot(t, s, kind, cx, ym + lift, cz, yawOf(dx, dz), pitch, len, height, width, c)
}

// ---------------------------------------------------------------- vegetation

export const VEG_KIND = {
  conifer: 0,
  pineTall: 1,
  broadleaf: 2,
  oak: 3,
  poplar: 4,
  fruit: 5,
  bush: 6,
  shrub: 7,
  reed: 8,
  stump: 9,
  rock: 10,
  lily: 11,
  pineRound: 12,
} as const
export const VEG_KIND_COUNT = 13
export const VEG_SLOTS = 6

const FOREST_OFFSETS: [number, number][] = [
  [-0.24, -0.22],
  [0.25, -0.25],
  [0.02, 0.02],
  [-0.26, 0.25],
  [0.24, 0.24],
]

export interface VegetationOptions {
  /** Max trees per forest cell (4 on high quality, 2 on low; up to 5). */
  forestSlots: number
  /** Colorblind-friendly stress tints (see COLORBLIND_TINTS). */
  colorblind?: boolean
}

export interface MarkOptions {
  /** Colorblind-friendly crop stress and gully tints (see COLORBLIND_TINTS). */
  colorblind?: boolean
}

/**
 * Foliage tint from water limitation, season and soil. Trees are drawn as deep-rooted: the
 * ordinary dry-season water limit only dulls them a little, and severe limitation (waterFactor
 * near zero, as in a drought) browns them.
 */
function treeTint(base: RGB, stress: number, dryness: number, soil: number, colorblind = false): RGB {
  const stressed = colorblind ? COLORBLIND_TINTS.foliageStressed : FOLIAGE.stressed
  const dead = colorblind ? COLORBLIND_TINTS.foliageDead : FOLIAGE.dead
  let c = mix(base, stressed, clamp01(stress * 0.4 + smoothstep(0.75, 1, stress) * 0.4 + dryness * 0.3))
  c = mix(c, dead, smoothstep(0.85, 1, stress) * (colorblind ? 0.6 : 0.45))
  c = mix(c, stressed, smoothstep(0.45, 0.1, soil) * 0.3)
  return c
}

const FOLIAGE_OF: Record<number, RGB> = {
  [VEG_KIND.conifer]: FOLIAGE.conifer,
  [VEG_KIND.pineTall]: FOLIAGE.conifer,
  [VEG_KIND.pineRound]: FOLIAGE.conifer,
  [VEG_KIND.broadleaf]: FOLIAGE.broadleaf,
  [VEG_KIND.oak]: FOLIAGE.oak,
  [VEG_KIND.poplar]: FOLIAGE.poplar,
  [VEG_KIND.fruit]: FOLIAGE.fruit,
  [VEG_KIND.bush]: FOLIAGE.shrub,
  [VEG_KIND.shrub]: FOLIAGE.shrub,
}

/** Base model scale per kind so trees are about 0.5 to 0.8 world units tall. */
export const VEG_BASE_SCALE: Record<number, number> = {
  [VEG_KIND.conifer]: 0.46,
  [VEG_KIND.pineTall]: 0.44,
  [VEG_KIND.pineRound]: 0.45,
  [VEG_KIND.broadleaf]: 0.4,
  [VEG_KIND.oak]: 0.5,
  [VEG_KIND.poplar]: 0.4,
  [VEG_KIND.fruit]: 0.42,
  [VEG_KIND.bush]: 0.85,
  [VEG_KIND.shrub]: 0.8,
  [VEG_KIND.reed]: 1,
  [VEG_KIND.stump]: 0.55,
  [VEG_KIND.rock]: 0.6,
  [VEG_KIND.lily]: 1.1,
}

/**
 * Vegetation with the normal wet/dry swing removed, as a wet-season equivalent. The model
 * moves every cover toward a season-specific target (forest 0.92 wet, 0.88 dry; grassland
 * 0.68 and 0.45), so raw cover dips each dry season without any plant being lost. Dividing by
 * the season's target and multiplying by the wet target cancels that swing; what is left
 * changes only with soil, water stress, maturity and land-use changes. Covers without a
 * seasonal target (or with the same target in both seasons) pass through unchanged.
 */
export function seasonFreeVegetation(cover: number, veg: number, season: Season): number {
  const key = cover === C.forest ? 'forest' : cover === C.grassland ? 'grassland' : cover === C.agroforestry ? 'agroforestry' : cover === C.wetland ? 'wetland' : cover === C.bare ? 'bare' : null
  if (!key) return veg
  const t = VEG.target.value[key]
  const here = t[season]
  return here > 0 ? clamp01((veg * t.wet) / here) : veg
}

/**
 * Season-free vegetation at which a stand is drawn with its full number of plants. Healthy
 * mature stands sit well above these (valley and Kaani, seed 7: forest 0.75 to 0.80, grassland
 * 0.56 to 0.59), so ordinary seasons and small wobbles never add or remove a tree or bush;
 * only real decline (poor soil, long water stress, dieback) thins a stand below them.
 */
export const FULL_STAND_VEG = { forest: 0.66, grassland: 0.5, wetland: 0.7 } as const

/** Number of trees drawn on a forest cell for a season-free vegetation value. */
export function forestTreeCount(seasonFreeVeg: number, maxTrees: number): number {
  if (seasonFreeVeg < 0.04) return 0
  const fill = clamp01(seasonFreeVeg / FULL_STAND_VEG.forest)
  return Math.max(1, Math.min(maxTrees, Math.round(fill * maxTrees)))
}

export function computeVegetation(frame: WorldFrame, heights: Float32Array, opts: VegetationOptions = { forestSlots: 4 }): SlotTargets {
  const { terrain, layers, fields } = frame
  const dims = terrain
  const n = terrain.width * terrain.height
  const t = createSlotTargets(n, VEG_SLOTS)
  const [eLo, eHi] = elevationRange(terrain.elevationM)
  const look = lookOf(frame)
  const dryness = seasonDryness(look.season, look.weather)
  const cb = opts.colorblind === true
  const stressedFoliage = cb ? COLORBLIND_TINTS.foliageStressed : FOLIAGE.stressed
  const dryReed = cb ? COLORBLIND_TINTS.parched : PALETTE.reedDry
  const maxForest = Math.max(1, Math.min(FOREST_OFFSETS.length, opts.forestSlots))
  // fewer, larger trees keep the canopy closed when quality lowers the count
  const lowDensityBoost = maxForest >= 5 ? 1 : maxForest === 4 ? 1.1 : maxForest === 3 ? 1.25 : 1.4

  for (let i = 0; i < n; i++) {
    if (terrain.channel[i]) continue
    const cover = layers.cover[i]
    const structure = layers.structure[i]
    const veg = clamp01(layers.vegetation[i])
    // presence (how many plants) follows the season-free value; size and tint keep the swing
    const stand = seasonFreeVegetation(cover, veg, frame.season)
    const stress = frame.fieldsReady ? 1 - clamp01(fields.waterFactor[i]) : 0
    const soil = layers.soilHealth[i]
    const { x: cx, z: cz } = cellToWorld(i, dims)
    const base = i * VEG_SLOTS
    const elevN = (terrain.elevationM[i] - eLo) / (eHi - eLo)
    const place = (slot: number, kind: number, ox: number, oz: number, scale: number, color: RGB, sink = 0.02) => {
      const x = cx + ox
      const z = cz + oz
      const y = heightAt(heights, dims, x, z) - sink
      const yaw = hashRange(0, Math.PI * 2, i, slot, 3)
      setSlot(t, base + slot, kind, x, y, z, yaw, 0, scale, scale, scale, color)
    }
    const jitter = (slot: number, k: number, amt: number) => hashRange(-amt, amt, i, slot, k)

    if (cover === C.forest) {
      const grow = 0.35 + 0.65 * maturity(cover, layers.coverAge[i])
      const visible = forestTreeCount(stand, maxForest)
      const conifer = smoothstep(0.3, 0.8, elevN)
      for (let k = 0; k < maxForest; k++) {
        // per-cell shuffled order so thinning looks natural
        const order = (k + Math.floor(hash01(i, 11) * maxForest)) % maxForest
        if (order >= visible) continue
        const r = hash01(i, k, 5)
        const kind = r < conifer ? [VEG_KIND.conifer, VEG_KIND.pineTall, VEG_KIND.pineRound][Math.floor(hash01(i, k, 6) * 3)] : [VEG_KIND.broadleaf, VEG_KIND.oak, VEG_KIND.poplar, VEG_KIND.broadleaf][Math.floor(hash01(i, k, 6) * 4)]
        const off = maxForest >= 5 ? FOREST_OFFSETS[k] : FOREST_OFFSETS[[0, 4, 2, 1, 3][k]]
        const s = VEG_BASE_SCALE[kind] * grow * lowDensityBoost * hashRange(0.8, 1.2, i, k, 7) * (0.85 + 0.15 * veg)
        place(k, kind, off[0] + jitter(k, 8, 0.09), off[1] + jitter(k, 9, 0.09), s, treeTint(FOLIAGE_OF[kind], stress, dryness, soil, cb))
      }
      if (stand > 0.45 && hash01(i, 5, 12) < 0.7) place(5, VEG_KIND.shrub, jitter(5, 8, 0.35), jitter(5, 9, 0.35), VEG_BASE_SCALE[VEG_KIND.shrub] * 0.8, treeTint(FOLIAGE.shrub, stress, dryness, soil, cb))
    } else if (cover === C.agroforestry) {
      const grow = 0.2 + 0.8 * maturity(cover, layers.coverAge[i])
      const { ax, az, bx, bz } = rowAxes(frame, heights, i)
      const across = 0.12
      const visible = veg < 0.05 ? 1 : 3
      for (let k = 0; k < visible; k++) {
        const along = (k - 1) * 0.3
        const kind = hash01(i, k, 5) < 0.6 ? VEG_KIND.fruit : VEG_KIND.oak
        const s = VEG_BASE_SCALE[kind] * 0.85 * grow * hashRange(0.85, 1.1, i, k, 7)
        place(k, kind, ax * along + bx * across, az * along + bz * across, s, treeTint(FOLIAGE_OF[kind], stress, dryness, soil, cb))
      }
    } else if (cover === C.grassland) {
      const dry = clamp01(dryness * 0.6 + stress * 0.6)
      const fill = clamp01(stand / FULL_STAND_VEG.grassland)
      if (hash01(i, 0, 12) < 0.25 + fill * 0.5) place(0, VEG_KIND.bush, jitter(0, 8, 0.38), jitter(0, 9, 0.38), VEG_BASE_SCALE[VEG_KIND.bush] * (0.6 + 0.5 * veg), mix(FOLIAGE.shrub, stressedFoliage, dry))
      if (hash01(i, 1, 12) < fill * 0.6) place(1, VEG_KIND.shrub, jitter(1, 8, 0.38), jitter(1, 9, 0.38), VEG_BASE_SCALE[VEG_KIND.shrub] * (0.6 + 0.4 * veg), mix(FOLIAGE.shrub, stressedFoliage, dry))
      if (hash01(i, 2, 12) < 0.05 + fill * 0.12) {
        const kind = hash01(i, 2, 5) < 0.5 ? VEG_KIND.poplar : VEG_KIND.broadleaf
        place(2, kind, jitter(2, 8, 0.3), jitter(2, 9, 0.3), VEG_BASE_SCALE[kind] * hashRange(0.75, 1.05, i, 2, 7), treeTint(FOLIAGE_OF[kind], stress, dryness, soil, cb))
      }
    } else if (cover === C.wetland) {
      const grow = 0.35 + 0.65 * maturity(cover, layers.coverAge[i])
      const reeds = Math.round(clamp01(stand / FULL_STAND_VEG.wetland) * 5)
      const reedColor = mix(PALETTE.reed, dryReed, clamp01(dryness * 0.8 + stress * 0.6))
      for (let k = 0; k < reeds; k++) {
        const s = grow * hashRange(0.7, 1.15, i, k, 7)
        place(k, VEG_KIND.reed, jitter(k, 8, 0.4), jitter(k, 9, 0.4), s, reedColor, 0.01)
      }
      if (stand > 0.3 && hash01(i, 5, 12) < 0.6) place(5, VEG_KIND.lily, jitter(5, 8, 0.3), jitter(5, 9, 0.3), VEG_BASE_SCALE[VEG_KIND.lily], PALETTE.lily, -0.005)
    } else if (cover === C.bare) {
      const wasWooded = layers.baselineCover[i] === C.forest || layers.baselineCover[i] === C.agroforestry
      if (wasWooded) {
        for (let k = 0; k < 3; k++) if (hash01(i, k, 12) < 0.75) place(k, VEG_KIND.stump, jitter(k, 8, 0.35), jitter(k, 9, 0.35), VEG_BASE_SCALE[VEG_KIND.stump] * hashRange(0.8, 1.2, i, k, 7), PALETTE.bark, 0.01)
      }
      // stones stay exposed once topsoil is lost, so they follow soil loss (persistent), not this
      // season's erosion, which comes and goes with the rains
      const soilLoss = clamp01(1 - soil)
      if (hash01(i, 3, 12) < 0.3 + soilLoss * 0.5 + terrain.slope[i]) place(3, VEG_KIND.rock, jitter(3, 8, 0.35), jitter(3, 9, 0.35), VEG_BASE_SCALE[VEG_KIND.rock] * hashRange(0.7, 1.3, i, 3, 7), PALETTE.stone, 0.03)
      if (stand > 0.15 && hash01(i, 4, 12) < stand) place(4, VEG_KIND.shrub, jitter(4, 8, 0.35), jitter(4, 9, 0.35), VEG_BASE_SCALE[VEG_KIND.shrub] * 0.6, mix(FOLIAGE.shrub, stressedFoliage, 0.5))
    } else if (cover === C.cropland) {
      // occasional hedge shrub on a field corner, and stumps where a forest was cleared for the field
      if (hash01(i, 0, 12) < 0.12) place(0, VEG_KIND.bush, 0.42 * Math.sign(jitter(0, 8, 1)), 0.42 * Math.sign(jitter(0, 9, 1)), VEG_BASE_SCALE[VEG_KIND.bush] * 0.8, treeTint(FOLIAGE.shrub, stress, dryness, soil, cb))
      if (layers.baselineCover[i] === C.forest && hash01(i, 4, 12) < 0.5) place(4, VEG_KIND.stump, 0.4 * Math.sign(jitter(4, 8, 1)), jitter(4, 9, 0.4), VEG_BASE_SCALE[VEG_KIND.stump] * 0.8, PALETTE.bark, 0.01)
    } else if (cover === C.urban) {
      if (structure === S.housing && hash01(i, 5, 12) < 0.45) {
        const kind = hash01(i, 5, 5) < 0.5 ? VEG_KIND.broadleaf : VEG_KIND.fruit
        place(5, kind, jitter(5, 8, 0.1), jitter(5, 9, 0.1), VEG_BASE_SCALE[kind] * 0.7, treeTint(FOLIAGE_OF[kind], stress * 0.5, dryness, 0.7, cb))
      } else if (structure === S.none && hash01(i, 0, 12) < 0.4) {
        place(0, VEG_KIND.broadleaf, jitter(0, 8, 0.3), jitter(0, 9, 0.3), VEG_BASE_SCALE[VEG_KIND.broadleaf] * 0.75, treeTint(FOLIAGE.broadleaf, stress * 0.5, dryness, 0.7, cb))
      }
    }
  }
  return t
}

// ---------------------------------------------------------------- ground marks (crops, terraces, ditches, gullies)

export const MARK_KIND = { cropRow: 0, strip: 1 } as const
export const MARK_SLOTS = 18
const ROWS_START = 0
const DITCH_SLOT = 10
const TERRACE_START = 11
const GULLY_START = 14
const SILT_SLOT = 17

export const CROP_COLORS = {
  sprout: linear('#8fa648'),
  lush: linear('#6f9634'),
  deep: linear('#557f2a'),
  ripe: linear('#d4b04e'),
  stubble: linear('#c8a865'),
  stressed: linear('#b39a5e'),
  failed: linear('#9c7a52'),
}

/** Display reference for "a strong harvest" when no harvest has been simulated yet. */
export function yieldReference(frame: WorldFrame): number {
  if (!frame.fieldsReady) return 1
  return overlayDomain('productivity', frame.fields.yieldT)[1]
}

export function computeGroundMarks(frame: WorldFrame, heights: Float32Array, opts: MarkOptions = {}): SlotTargets {
  const { terrain, layers, fields } = frame
  const cb = opts.colorblind === true
  const cropStressed = cb ? COLORBLIND_TINTS.cropStressed : CROP_COLORS.stressed
  const cropFailed = cb ? COLORBLIND_TINTS.cropFailed : CROP_COLORS.failed
  const gully = cb ? COLORBLIND_TINTS.gully : PALETTE.gully
  const eroded = cb ? COLORBLIND_TINTS.eroded : PALETTE.eroded
  const dims = terrain
  const n = terrain.width * terrain.height
  const t = createSlotTargets(n, MARK_SLOTS)
  const look = lookOf(frame)
  const dryness = seasonDryness(look.season, look.weather)
  const yieldRef = yieldReference(frame)

  for (let i = 0; i < n; i++) {
    if (terrain.channel[i]) continue
    const cover = layers.cover[i]
    const { x: cx, z: cz } = cellToWorld(i, dims)
    const base = i * MARK_SLOTS
    const isCrop = cover === C.cropland
    const isAgro = cover === C.agroforestry
    const axes = isCrop || isAgro || layers.conservation[i] ? rowAxes(frame, heights, i) : null

    if ((isCrop || isAgro) && axes) {
      const intensity = isAgro ? 0 : layers.intensity[i]
      // a simulated season with zero harvest means the field was not cropped (e.g. rainfed
      // land in the dry season) or failed: draw stubble instead of a standing crop
      const fallow = frame.fieldsReady && fields.yieldT[i] <= 0
      const wf = frame.fieldsReady ? clamp01(fields.waterFactor[i]) : 0.85
      const yieldN = frame.fieldsReady ? clamp01(fields.yieldT[i] / yieldRef) : 0.75
      const health = fallow ? 0 : clamp01(0.55 * wf + 0.45 * yieldN)
      const seasonal = look.season === 'dry' ? mix(CROP_COLORS.lush, CROP_COLORS.ripe, 0.75) : intensity === 2 ? CROP_COLORS.deep : intensity === 0 ? CROP_COLORS.sprout : CROP_COLORS.lush
      let color = mix(cropFailed, mix(cropStressed, seasonal, smoothstep(0.25, 0.8, health)), smoothstep(0.05, 0.35, health))
      if (look.weather === 'drought') color = mix(color, cropStressed, 0.3 * (1 - wf))
      color = mix(color, CROP_COLORS.stubble, smoothstep(0.6, 0.2, layers.soilHealth[i]) * 0.25)
      if (fallow) color = mix(CROP_COLORS.stubble, cropFailed, smoothstep(0.5, 0.15, layers.soilHealth[i]) * 0.6)
      const rows = isAgro ? [-0.3, -0.1, 0.32] : intensity === 0 ? [-0.27, 0, 0.27] : intensity === 1 ? [-0.3, -0.1, 0.1, 0.3] : [-0.32, -0.16, 0, 0.16, 0.32]
      const width = isAgro ? 0.11 : [0.1, 0.12, 0.13][intensity] ?? 0.12
      const h = fallow ? 0.025 : (0.04 + 0.09 * clamp01(0.35 + 0.65 * health)) * (dryness > 0.8 ? 0.8 : 1)
      const { ax, az, bx, bz } = axes
      let slot = ROWS_START
      for (let r = 0; r < rows.length; r++) {
        for (let seg = 0; seg < 2; seg++) {
          const s = slot++
          // low-intensity fields are patchy
          if (intensity === 0 && !isAgro && hash01(i, s, 21) < 0.22) continue
          const a0 = seg === 0 ? -0.42 : 0.01
          const a1 = seg === 0 ? -0.01 : 0.42
          const off = rows[r]
          const tint = mix(color, CROP_COLORS.sprout, hashRange(0, 0.12, i, s, 22))
          setSegment(t, base + s, MARK_KIND.cropRow, heights, dims, cx + ax * a0 + bx * off, cz + az * a0 + bz * off, cx + ax * a1 + bx * off, cz + az * a1 + bz * off, 0.0, width, h, tint)
        }
      }
      if (isCrop && layers.irrigated[i]) {
        const off = 0.44
        setSegment(t, base + DITCH_SLOT, MARK_KIND.strip, heights, dims, cx - ax * 0.46 + bx * off, cz - az * 0.46 + bz * off, cx + ax * 0.46 + bx * off, cz + az * 0.46 + bz * off, 0.01, 0.06, 0.03, PALETTE.irrigation)
      }
    }

    if (layers.conservation[i] && axes && cover !== C.water && cover !== C.urban) {
      const { ax, az, bx, bz } = axes
      const offs = isCrop || isAgro ? [-0.4, -0.2, 0.21] : [-0.3, 0, 0.3]
      for (let k = 0; k < 3; k++) {
        const off = offs[k]
        setSegment(t, base + TERRACE_START + k, MARK_KIND.strip, heights, dims, cx - ax * 0.48 + bx * off, cz - az * 0.48 + bz * off, cx + ax * 0.48 + bx * off, cz + az * 0.48 + bz * off, 0.0, 0.05, 0.06, PALETTE.terraceRidge)
      }
    }

    if (cover !== C.water && cover !== C.urban && cover !== C.wetland) {
      // this season's erosion pressure, or lasting damage: badly degraded soil on a slope
      const seasonal = frame.fieldsReady ? clamp01(fields.erosion[i] / EROSION_VISUAL_REF) : 0
      const scarred = smoothstep(0.45, 0.15, layers.soilHealth[i]) * smoothstep(0.08, 0.3, terrain.slope[i])
      const e = Math.max(seasonal, scarred)
      if (e > 0.45) {
        const count = e > 0.8 ? 3 : e > 0.6 ? 2 : 1
        const to = terrain.flowTo[i]
        let dx = 0
        let dz = 1
        if (to >= 0) {
          const p = cellToWorld(to, dims)
          dx = p.x - cx
          dz = p.z - cz
          const l = Math.hypot(dx, dz) || 1
          dx /= l
          dz /= l
        }
        const len = 0.3 + 0.5 * e
        for (let k = 0; k < count; k++) {
          const across = hashRange(-0.32, 0.32, i, k, 31)
          const along = hashRange(-0.15, 0.15, i, k, 32)
          const sx = cx - dz * across + dx * (along - len / 2)
          const sz = cz + dx * across + dz * (along - len / 2)
          const color = mix(gully, eroded, hashRange(0, cb ? 0.15 : 0.4, i, k, 33))
          setSegment(t, base + GULLY_START + k, MARK_KIND.strip, heights, dims, sx, sz, sx + dx * len, sz + dz * len, -0.005, 0.045 + 0.04 * e, 0.025, color)
        }
      }
    }

    // silt fan: sediment from upslope that settled here last season (fields.sedimentIn)
    if (frame.fieldsReady && cover !== C.water && cover !== C.urban && layers.structure[i] === S.none) {
      const silt = clamp01((fields.sedimentIn?.[i] ?? 0) / SILT_VISUAL_REF)
      if (silt > SILT_FAN_MIN) {
        const to = terrain.flowTo[i]
        let dx = 0
        let dz = 1
        if (to >= 0) {
          const p = cellToWorld(to, dims)
          dx = p.x - cx
          dz = p.z - cz
          const l = Math.hypot(dx, dz) || 1
          dx /= l
          dz /= l
        }
        const k = (silt - SILT_FAN_MIN) / (1 - SILT_FAN_MIN)
        const len = 0.35 + 0.45 * k
        const sx = cx - dx * len * 0.3
        const sz = cz - dz * len * 0.3
        setSegment(t, base + SILT_SLOT, MARK_KIND.strip, heights, dims, sx, sz, sx + dx * len, sz + dz * len, -0.006, 0.22 + 0.4 * k, 0.02, mix(PALETTE.silt, PALETTE.eroded, 0.15 * (1 - k)))
      }
    }
  }
  return t
}

// ---------------------------------------------------------------- roads

/**
 * Slots per road cell: the centre, a segment toward each of the 8 neighbours, and on a bridge a
 * pier plus a pair of railings along up to 4 of its links.
 */
export const ROAD_SLOTS = 18
const BRIDGE_PIER_SLOT = 9
const BRIDGE_RAIL_SLOT = 10
const BRIDGE_RAIL_LINKS = 4
const ROAD_DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]
export const ROAD_WIDTH = 0.34
/** Deck clearance above the highest river stage the view can draw. */
export const BRIDGE_CLEARANCE = 0.1
const BRIDGE_RAIL_HEIGHT = 0.05
const BRIDGE_RAIL_WIDTH = 0.025
const BRIDGE_PIER_WIDTH = 0.1

/** True if structure at index is a road. */
const isRoadAt = (structure: Uint8Array, i: number) => structure[i] === S.road

/** Indices of road neighbors this road cell connects to (diagonals only when no orthogonal link exists). */
export function roadLinks(structure: Uint8Array, width: number, height: number, i: number): number[] {
  const x = i % width
  const z = Math.floor(i / width)
  const links: number[] = []
  const has = (dx: number, dz: number) => {
    const nx = x + dx
    const nz = z + dz
    return nx >= 0 && nz >= 0 && nx < width && nz < height && isRoadAt(structure, nz * width + nx)
  }
  for (let d = 0; d < 8; d++) {
    const [dx, dz] = ROAD_DIRS[d]
    if (!has(dx, dz)) continue
    if (d >= 4 && (has(dx, 0) || has(0, dz))) continue
    links.push(d)
  }
  return links
}

/** Road on a river channel or open water: drawn as a bridge deck above the water. */
function bridgeCell(frame: WorldFrame, i: number): boolean {
  return isRoadAt(frame.layers.structure, i) && (frame.terrain.channel[i] === 1 || frame.layers.cover[i] === C.water)
}

/**
 * Surface height of each road cell centre: the ground for a road, and for a bridge a level deck
 * above the highest river the view draws and at least as high as the dry banks around it.
 */
export function roadDeckHeights(frame: WorldFrame, heights: Float32Array): Float32Array {
  const { terrain, layers } = frame
  const dims = terrain
  const { width, height } = terrain
  const n = width * height
  const out = new Float32Array(n).fill(NaN)
  const flood = riverDepthForStage(1) + BRIDGE_CLEARANCE
  for (let i = 0; i < n; i++) {
    if (!isRoadAt(layers.structure, i)) continue
    const { x: cx, z: cz } = cellToWorld(i, dims)
    const ground = heightAt(heights, dims, cx, cz)
    if (!bridgeCell(frame, i)) {
      out[i] = ground
      continue
    }
    let deck = ground + flood
    const x = i % width
    const z = Math.floor(i / width)
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        const nz = z + dz
        if ((dx === 0 && dz === 0) || nx < 0 || nz < 0 || nx >= width || nz >= height) continue
        const j = nz * width + nx
        if (terrain.channel[j] === 1 || layers.cover[j] === C.water) continue
        const bank = cellToWorld(j, dims)
        deck = Math.max(deck, heightAt(heights, dims, bank.x, bank.z))
      }
    out[i] = deck
  }
  return out
}

/** A road piece between two explicit heights (bridge decks and the ramps onto them). */
function setRamp(t: SlotTargets, s: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, width: number, thick: number, c: RGB) {
  const dx = x1 - x0
  const dz = z1 - z0
  const horiz = Math.hypot(dx, dz)
  setSlot(t, s, 0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, yawOf(dx, dz), Math.atan2(y1 - y0, horiz), Math.hypot(horiz, y1 - y0), thick, width, c)
}

export function computeRoads(frame: WorldFrame, heights: Float32Array): SlotTargets {
  const { terrain, layers } = frame
  const dims = terrain
  const n = terrain.width * terrain.height
  const t = createSlotTargets(n, ROAD_SLOTS)
  const deckY = roadDeckHeights(frame, heights)
  for (let i = 0; i < n; i++) {
    if (!isRoadAt(layers.structure, i)) continue
    const { x: cx, z: cz } = cellToWorld(i, dims)
    const base = i * ROAD_SLOTS
    const bridge = bridgeCell(frame, i)
    const y = deckY[i]
    const tint = bridge ? PALETTE.bridgeDeck : mix(PALETTE.roadSurface, PALETTE.roadEdge, hashRange(0, 0.15, i, 0, 41))
    setSlot(t, base, 0, cx, y - 0.015, cz, 0, 0, ROAD_WIDTH, 0.06, ROAD_WIDTH, tint)
    let rails = 0
    for (const d of roadLinks(layers.structure, terrain.width, terrain.height, i)) {
      const [dx, dz] = ROAD_DIRS[d]
      const j = i + dz * terrain.width + dx
      const ex = cx + dx * 0.52
      const ez = cz + dz * 0.52
      if (!bridge && !bridgeCell(frame, j)) {
        setSegment(t, base + 1 + d, 0, heights, dims, cx, cz, ex, ez, -0.015, ROAD_WIDTH, 0.06, tint)
        continue
      }
      // onto or along a bridge: meet the neighbour half way between the two surface heights
      const ey = (y + deckY[j]) / 2
      setRamp(t, base + 1 + d, cx, y - 0.015, cz, ex, ey - 0.015, ez, ROAD_WIDTH, 0.06, tint)
      if (!bridge || rails >= BRIDGE_RAIL_LINKS) continue
      const len = Math.hypot(dx, dz)
      const ox = (-dz / len) * (ROAD_WIDTH / 2)
      const oz = (dx / len) * (ROAD_WIDTH / 2)
      for (const side of [1, -1]) {
        setRamp(t, base + BRIDGE_RAIL_SLOT + rails * 2 + (side > 0 ? 0 : 1), cx + side * ox, y + 0.045, cz + side * oz, ex + side * ox, ey + 0.045, ez + side * oz, BRIDGE_RAIL_WIDTH, BRIDGE_RAIL_HEIGHT, PALETTE.bridgeRail)
      }
      rails++
    }
    if (bridge) {
      // one pier from the river bed up to the deck
      const bed = heightAt(heights, dims, cx, cz) - 0.05
      setSlot(t, base + BRIDGE_PIER_SLOT, 0, cx, bed, cz, 0, 0, BRIDGE_PIER_WIDTH, Math.max(0.05, y - bed - 0.02), BRIDGE_PIER_WIDTH, PALETTE.bridgeRail)
    }
  }
  return t
}

// ---------------------------------------------------------------- buildings and infrastructure

export const BUILD_KIND = {
  house1: 0,
  house2: 1,
  block: 2,
  worksHall: 3,
  tank: 4,
  stall: 5,
  plaza: 6,
  embankment: 7,
} as const
export const BUILD_KIND_COUNT = 8
export const BUILD_SLOTS = 6

const HOUSE_OFFSETS: [number, number][] = [
  [-0.21, -0.2],
  [0.22, -0.19],
  [-0.2, 0.21],
  [0.22, 0.22],
]
const HOUSE_LAYOUT: number[][] = [[], [BUILD_KIND.house1, BUILD_KIND.house1], [BUILD_KIND.house2, BUILD_KIND.house1, BUILD_KIND.house2], [BUILD_KIND.block, BUILD_KIND.house2, BUILD_KIND.block, BUILD_KIND.house2]]
const FOOTPRINT: Record<number, [number, number]> = {
  [BUILD_KIND.house1]: [0.26, 0.21],
  [BUILD_KIND.house2]: [0.27, 0.22],
  [BUILD_KIND.block]: [0.28, 0.26],
}

/** Number of houses drawn for a housing level (0 for non-housing). */
export const housesForLevel = (level: number) => HOUSE_LAYOUT[Math.max(0, Math.min(3, level))].length

function footprintMinHeight(heights: Float32Array, dims: GridDims, x: number, z: number, r: number) {
  return Math.min(heightAt(heights, dims, x - r, z - r), heightAt(heights, dims, x + r, z - r), heightAt(heights, dims, x - r, z + r), heightAt(heights, dims, x + r, z + r), heightAt(heights, dims, x, z))
}

const SIDE_DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/** Grid directions (dx, dz) from cell i to its 4-neighbors that carry a road. */
function roadSides(frame: WorldFrame, i: number): [number, number][] {
  const { width, height } = frame.terrain
  const x = i % width
  const z = Math.floor(i / width)
  const out: [number, number][] = []
  for (const [dx, dz] of SIDE_DIRS) {
    const nx = x + dx
    const nz = z + dz
    if (nx >= 0 && nz >= 0 && nx < width && nz < height && frame.layers.structure[nz * width + nx] === S.road) out.push([dx, dz])
  }
  return out
}

/**
 * Yaw that turns a building's front (local +Z: door and front windows) toward world (dx, dz).
 * three's rotation.y = yaw maps local (0, 0, 1) to (sin yaw, 0, cos yaw).
 */
export const frontYaw = (dx: number, dz: number) => Math.atan2(dx, dz)

/**
 * Yaw for a building at offset (ox, oz) from its cell centre: front toward the road side
 * nearest to it (so on a corner lot each house faces the street it stands by), or a stable
 * quarter turn when no road touches the cell.
 */
function facingYaw(frame: WorldFrame, i: number, ox = 0, oz = 0): number {
  const sides = roadSides(frame, i)
  if (sides.length === 0) return Math.floor(hash01(i, 0, 51) * 4) * (Math.PI / 2)
  let best = sides[0]
  let bestDot = -Infinity
  for (const sd of sides) {
    const d = sd[0] * ox + sd[1] * oz
    if (d > bestDot + 1e-9) {
      bestDot = d
      best = sd
    }
  }
  return frontYaw(best[0], best[1])
}

export function computeBuildings(frame: WorldFrame, heights: Float32Array): SlotTargets {
  const { terrain, layers } = frame
  const dims = terrain
  const { width, height } = terrain
  const n = width * height
  const t = createSlotTargets(n, BUILD_SLOTS)
  let basins: ReservoirBasins | null = null
  for (let i = 0; i < n; i++) {
    const st = layers.structure[i]
    if (st === S.none || st === S.road) continue
    const { x: cx, z: cz } = cellToWorld(i, dims)
    const base = i * BUILD_SLOTS
    if (st === S.housing) {
      const level = Math.max(1, Math.min(3, layers.structureLevel[i] || 1))
      const layout = HOUSE_LAYOUT[level]
      for (let k = 0; k < layout.length; k++) {
        const kind = layout[k]
        const [ox, oz] = HOUSE_OFFSETS[k]
        const face = facingYaw(frame, i, ox, oz)
        const x = cx + ox + hashRange(-0.04, 0.04, i, k, 52)
        const z = cz + oz + hashRange(-0.04, 0.04, i, k, 53)
        const y = footprintMinHeight(heights, dims, x, z, 0.14)
        const [fw, fd] = FOOTPRINT[kind]
        const j = hashRange(0.9, 1.08, i, k, 54)
        const yaw = face + hashRange(-0.12, 0.12, i, k, 55)
        const roof = ROOFS[Math.floor(hash01(i, k, 57) * ROOFS.length)]
        setSlot(t, base + k, kind, x, y, z, yaw, 0, fw * j, hashRange(0.92, 1.1, i, k, 58), fd * j, roof)
      }
    } else if (st === S.waterworks) {
      const y = footprintMinHeight(heights, dims, cx, cz, 0.3)
      const yaw = facingYaw(frame, i, -0.12, 0.05)
      setSlot(t, base, BUILD_KIND.worksHall, cx - 0.12, y, cz + 0.05, yaw, 0, 0.36, 1, 0.28, PALETTE.pipe)
      setSlot(t, base + 1, BUILD_KIND.tank, cx + 0.22, y, cz - 0.18, 0, 0, 0.2, 1, 0.2, PALETTE.tank)
      setSlot(t, base + 2, BUILD_KIND.tank, cx + 0.24, y, cz + 0.2, 0, 0, 0.16, 0.8, 0.16, PALETTE.tank)
    } else if (st === S.market) {
      const y = footprintMinHeight(heights, dims, cx, cz, 0.38)
      setSlot(t, base, BUILD_KIND.plaza, cx, y, cz, 0, 0, 0.86, 1, 0.86, PALETTE.concrete)
      const spots: [number, number][] = [
        [-0.22, -0.2],
        [0.2, -0.22],
        [-0.2, 0.2],
        [0.22, 0.2],
      ]
      for (let k = 0; k < 4; k++) {
        const [ox, oz] = spots[k]
        const awning = AWNINGS[Math.floor(hash01(i, k, 61) * AWNINGS.length)]
        setSlot(t, base + 1 + k, BUILD_KIND.stall, cx + ox, y, cz + oz, (k % 2) * (Math.PI / 2) + hashRange(-0.1, 0.1, i, k, 62), 0, 0.2, 1, 0.16, awning)
      }
    } else if (st === S.reservoir) {
      const x = i % width
      const z = Math.floor(i / width)
      const edges: [number, number, number, number][] = [
        [1, 0, 0.48, 0],
        [-1, 0, -0.48, 0],
        [0, 1, 0, 0.48],
        [0, -1, 0, -0.48],
      ]
      for (let k = 0; k < 4; k++) {
        const [dx, dz, ox, oz] = edges[k]
        const nx = x + dx
        const nz = z + dz
        const inside = nx >= 0 && nz >= 0 && nx < width && nz < height && layers.structure[nz * width + nx] === S.reservoir
        if (inside) continue
        const ex = cx + ox
        const ez = cz + oz
        // wall runs along the edge, perpendicular to the outward direction
        const ax = dz !== 0 ? 1 : 0
        const az = dx !== 0 ? 1 : 0
        // the crest sits above the highest ground in the basin, so a full reservoir stays inside
        basins ??= reservoirBasins(layers.structure, S.reservoir, heights, dims)
        const crest = embankmentCrest(basins.rim[basins.basin[i]])
        const x0 = ex - ax * 0.52
        const z0 = ez - az * 0.52
        const x1 = ex + ax * 0.52
        const z1 = ez + az * 0.52
        const lift = -0.02
        const lowBase = Math.min(heightAt(heights, dims, x0, z0), heightAt(heights, dims, x1, z1), heightAt(heights, dims, ex, ez)) + lift
        const wall = Math.max(EMBANKMENT_MIN_HEIGHT, crest - lowBase)
        setSegment(t, base + k, BUILD_KIND.embankment, heights, dims, x0, z0, x1, z1, lift, 0.14, wall, PALETTE.embankment)
      }
    }
  }
  return t
}
