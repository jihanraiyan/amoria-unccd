// Shared cell codes and small spatial helpers used by every model.
import { coverCode, structureCode, type LandCover, type Terrain } from '../types'

export const C = {
  forest: coverCode('forest'),
  grassland: coverCode('grassland'),
  cropland: coverCode('cropland'),
  agroforestry: coverCode('agroforestry'),
  urban: coverCode('urban'),
  wetland: coverCode('wetland'),
  water: coverCode('water'),
  bare: coverCode('bare'),
} as const

export const S = {
  none: structureCode('none'),
  road: structureCode('road'),
  housing: structureCode('housing'),
  reservoir: structureCode('reservoir'),
  waterworks: structureCode('waterworks'),
  market: structureCode('market'),
} as const

export const I_LOW = 0
export const I_MEDIUM = 1
export const I_HIGH = 2
export const INTENSITY_KEYS = ['low', 'medium', 'high'] as const

export const COVER_KEYS: LandCover[] = ['forest', 'grassland', 'cropland', 'agroforestry', 'urban', 'wetland', 'water', 'bare']

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

const DX = [-1, 0, 1, -1, 1, -1, 0, 1]
const DZ = [-1, -1, -1, 0, 0, 1, 1, 1]

/** Calls fn for each 8-neighbour of cell i inside the grid. */
export function forNeighbors(width: number, height: number, i: number, fn: (j: number) => void): void {
  const x = i % width
  const z = (i - x) / width
  for (let k = 0; k < 8; k++) {
    const nx = x + DX[k]
    const nz = z + DZ[k]
    if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue
    fn(nz * width + nx)
  }
}

/** True if any cell within Chebyshev radius r satisfies pred. */
export function anyWithin(width: number, height: number, i: number, r: number, pred: (j: number) => boolean): boolean {
  const x = i % width
  const z = (i - x) / width
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      if (!dx && !dz) continue
      const nx = x + dx
      const nz = z + dz
      if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue
      if (pred(nz * width + nx)) return true
    }
  }
  return false
}

/** m3 of water per mm over one cell. */
export const m3PerMm = (t: Terrain): number => (t.cellSizeM * t.cellSizeM) / 1000

/** Cell area in hectares. */
export const cellHa = (t: Terrain): number => (t.cellSizeM * t.cellSizeM) / 10_000

/**
 * Cells whose D8 flow path reaches a target cell (targets included). Processes cells from
 * downstream to upstream, so each cell inherits its receiver's answer: O(n).
 */
export function upstreamMask(terrain: Pick<Terrain, 'flowTo' | 'flowOrder'>, isTarget: (i: number) => boolean): Uint8Array {
  const n = terrain.flowOrder.length
  const out = new Uint8Array(n)
  for (let o = n - 1; o >= 0; o--) {
    const i = terrain.flowOrder[o]
    const t = terrain.flowTo[i]
    out[i] = isTarget(i) || (t >= 0 && out[t] === 1) ? 1 : 0
  }
  return out
}

/**
 * The village's contributing area: every cell that drains through a home or through the river
 * reach next to homes on the floodplain (within maxDistanceCells of a channel).
 */
export function villageContributingArea(
  terrain: Pick<Terrain, 'flowTo' | 'flowOrder' | 'nearestChannel' | 'channelDistance'>,
  structure: Uint8Array,
  maxDistanceCells: number,
): Uint8Array {
  const targets = new Uint8Array(structure.length)
  for (let i = 0; i < structure.length; i++) {
    if (structure[i] !== S.housing) continue
    targets[i] = 1
    const d = terrain.nearestChannel[i]
    if (d >= 0 && terrain.channelDistance[i] <= maxDistanceCells) targets[d] = 1
  }
  return upstreamMask(terrain, (i) => targets[i] === 1)
}
