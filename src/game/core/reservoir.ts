// Reservoir basins: connected groups of reservoir cells share one flat water level. The level
// runs from the lowest ground in the basin (empty: the bed is exposed) to just above the
// highest ground in it (full: the whole footprint is under water). The embankment crest is
// set relative to the same rim, so a full reservoir always sits inside its walls.
import { heightAt, type GridDims } from './coords'

/** How far a full reservoir sits above the highest ground inside its footprint. */
export const RESERVOIR_FREEBOARD = 0.03
/** How far the embankment crest sits above the highest ground inside the basin. */
export const EMBANKMENT_ABOVE_RIM = 0.09
/** Lowest embankment drawn, even on flat ground. */
export const EMBANKMENT_MIN_HEIGHT = 0.16

export interface ReservoirBasins {
  /** basin id per cell, -1 outside reservoirs */
  basin: Int32Array
  /** lowest ground (world units) inside each basin */
  bed: number[]
  /** highest ground inside each basin */
  rim: number[]
}

/** Lowest and highest terrain surface over a cell footprint. */
export function cellGroundRange(heights: ArrayLike<number>, dims: GridDims, i: number): [number, number] {
  // the bilinear surface is bilinear on each quarter of the cell, so its extremes over the
  // footprint lie on the corners, edge midpoints and centre
  const cx = (i % dims.width) - dims.width / 2 + 0.5
  const cz = Math.floor(i / dims.width) - dims.height / 2 + 0.5
  let lo = Infinity
  let hi = -Infinity
  for (let dz = -0.5; dz <= 0.5; dz += 0.5)
    for (let dx = -0.5; dx <= 0.5; dx += 0.5) {
      const h = heightAt(heights, dims, cx + dx, cz + dz)
      if (h < lo) lo = h
      if (h > hi) hi = h
    }
  return [lo, hi]
}

/** Groups 4-connected reservoir cells into basins with their bed and rim heights. */
export function reservoirBasins(structure: ArrayLike<number>, reservoirCode: number, heights: ArrayLike<number>, dims: GridDims): ReservoirBasins {
  const { width, height } = dims
  const n = width * height
  const basin = new Int32Array(n).fill(-1)
  const bed: number[] = []
  const rim: number[] = []
  const stack: number[] = []
  for (let start = 0; start < n; start++) {
    if (structure[start] !== reservoirCode || basin[start] >= 0) continue
    const id = bed.length
    let lo = Infinity
    let hi = -Infinity
    basin[start] = id
    stack.push(start)
    while (stack.length) {
      const i = stack.pop()!
      const [a, b] = cellGroundRange(heights, dims, i)
      if (a < lo) lo = a
      if (b > hi) hi = b
      const x = i % width
      const z = Math.floor(i / width)
      const near = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, z > 0 ? i - width : -1, z < height - 1 ? i + width : -1]
      for (const j of near) {
        if (j < 0 || basin[j] >= 0 || structure[j] !== reservoirCode) continue
        basin[j] = id
        stack.push(j)
      }
    }
    bed.push(lo)
    rim.push(hi)
  }
  return { basin, bed, rim }
}

/** Flat water level of a basin at a fill fraction 0..1. */
export function reservoirLevel(bed: number, rim: number, fill: number): number {
  const f = Math.min(1, Math.max(0, fill))
  return bed + (rim + RESERVOIR_FREEBOARD - bed) * f
}

/** World height of the embankment crest around a basin. */
export const embankmentCrest = (rim: number) => rim + EMBANKMENT_ABOVE_RIM
