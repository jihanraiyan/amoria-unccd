// Per-cell derived layers for overlays and the inspector. The renderer must not compute
// environmental models, so these pure helpers live in the simulation core. Each returns a new
// Float32Array (length width*height) computed only from current state.
import { SOIL, HYDRO } from '../params'
import { referenceSeason } from '../engine'
import { coverFactor, erodibility, lsFactor, practiceFactor, softCapErosion } from '../models/soil'
import { soilFactor } from '../models/agriculture'
import { C, S, clamp } from '../models/cells'
import type { SimulationState } from '../types'

const isWater = (s: SimulationState, i: number) => s.terrain.channel[i] === 1 || s.layers.cover[i] === C.water || s.layers.structure[i] === S.reservoir

/**
 * Erosion susceptibility: the RUSLE-style index this cell would have in a normal wet season with
 * its current cover and management (game tonnes per ha). Independent of this step's weather.
 */
export function erosionSusceptibility(s: SimulationState): Float32Array {
  const n = s.layers.cover.length
  const out = new Float32Array(n)
  const r = SOIL.erosivityPerMm.value * referenceSeason('wet').rainfallMm
  for (let i = 0; i < n; i++) {
    if (isWater(s, i)) continue
    out[i] = softCapErosion(
      r *
        erodibility(s.layers.soilHealth[i]) *
        lsFactor(s.terrain.slope[i], s.terrain.flowAccumulation[i], s.terrain.cellSizeM) *
        coverFactor(s.layers.cover[i], s.layers.structure[i], s.layers.intensity[i], s.layers.vegetation[i], s.layers.structureLevel[i]) *
        practiceFactor(s.layers.cover[i], s.layers.conservation[i], s.terrain.slope[i]),
    )
  }
  return out
}

/** Flood exposure 0..1: how little extra river rise it takes to flood the cell (HAND based). */
export function floodExposure(s: SimulationState): Float32Array {
  const n = s.layers.cover.length
  const out = new Float32Array(n)
  const fp = HYDRO.flood.value
  for (let i = 0; i < n; i++) {
    if (isWater(s, i) || s.terrain.nearestChannel[i] < 0 || s.terrain.channelDistance[i] > fp.maxDistanceCells) continue
    out[i] = clamp(1 - s.terrain.heightAboveChannelM[i] / fp.maxDepthM, 0, 1)
  }
  return out
}

/** The four parts of environmental sensitivity, per cell (each 0..1), and the index itself. */
export interface SensitivityParts {
  /** Bare-soil erosion potential on the cell's slope and soil, over a third of SOIL.maxErosion. */
  erosion: Float32Array
  /** Flood exposure (see floodExposure). */
  flood: Float32Array
  /** 0.7 next to a stream (where buffers matter most), else 0. */
  streamBank: Float32Array
  /** 0.9 on existing wetland, else 0. */
  wetland: Float32Array
  /** The index: the largest of the four parts (0 on water). */
  max: Float32Array
  /** Which part set the index: 0 none, 1 erosion, 2 flood, 3 stream bank, 4 wetland (ties go to the first in this order). */
  driver: Uint8Array
}

export const SENSITIVITY_DRIVERS = ['none', 'erosion', 'flood', 'stream-bank', 'wetland'] as const

/**
 * Environmental sensitivity and its parts: how much damage disturbing each cell would do. The
 * index is the larger of (a) bare-soil erosion potential on its slope, (b) flood exposure,
 * (c) riparian position, (d) existing wetland. Water cells are left at 0 with driver 0.
 */
export function sensitivityParts(s: SimulationState): SensitivityParts {
  const n = s.layers.cover.length
  const erosion = new Float32Array(n)
  const streamBank = new Float32Array(n)
  const wetland = new Float32Array(n)
  const max = new Float32Array(n)
  const driver = new Uint8Array(n)
  const flood = floodExposure(s)
  const r = SOIL.erosivityPerMm.value * referenceSeason('wet').rainfallMm
  const bareRef = SOIL.maxErosion.value / 3
  for (let i = 0; i < n; i++) {
    if (isWater(s, i)) continue
    const bare = r * erodibility(s.layers.soilHealth[i]) * lsFactor(s.terrain.slope[i], s.terrain.flowAccumulation[i], s.terrain.cellSizeM)
    erosion[i] = clamp(bare / bareRef, 0, 1)
    streamBank[i] = s.terrain.channelDistance[i] <= 1 ? 0.7 : 0
    wetland[i] = s.layers.cover[i] === C.wetland ? 0.9 : 0
    const parts = [erosion[i], flood[i], streamBank[i], wetland[i]]
    let k = 0
    for (let j = 1; j < 4; j++) if (parts[j] > parts[k]) k = j
    max[i] = parts[k]
    driver[i] = parts[k] > 0 ? k + 1 : 0
  }
  return { erosion, flood, streamBank, wetland, max, driver }
}

/** Environmental sensitivity 0..1 (the index of sensitivityParts). */
export function environmentalSensitivity(s: SimulationState): Float32Array {
  return sensitivityParts(s).max
}

/** Agricultural productivity 0..1: soil factor times last season's water factor (land suitability if farmed). */
export function productivity(s: SimulationState): Float32Array {
  const n = s.layers.cover.length
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    if (isWater(s, i) || s.layers.structure[i] !== S.none) continue
    out[i] = clamp(soilFactor(s.layers.soilHealth[i]) * clamp(s.fields.waterFactor[i], 0, 1), 0, 1)
  }
  return out
}

/** Urban development intensity 0..1 (roads 0.4, homes by density, services 0.8). */
export function urbanIntensity(s: SimulationState): Float32Array {
  const n = s.layers.cover.length
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const st = s.layers.structure[i]
    if (st === S.road) out[i] = 0.4
    else if (st === S.housing) out[i] = 0.3 + 0.23 * s.layers.structureLevel[i]
    else if (st === S.market || st === S.waterworks) out[i] = 0.8
  }
  return out
}
