// Cell inspector data: everything the right-side inspector shows for one parcel, taken from
// state, plus which interventions are possible here with their cost or the reason they are not.
import { validateAction } from '../engine'
import { maturity } from '../models/vegetation'
import { soilCapacityMm } from '../models/hydrology'
import { treeProductRamp } from '../models/agriculture'
import { C, S } from '../models/cells'
import { coverName, structureName, INTENSITIES, type ActionType, type LandCover, type PlayerAction, type SimulationState, type Structure } from '../types'
import { environmentalSensitivity, erosionSusceptibility, floodExposure, productivity } from './overlays'

export interface InterventionOption {
  type: ActionType
  ok: boolean
  cost: number
  revenue: number
  reason: string
}

export interface CellReport {
  index: number
  x: number
  z: number
  cover: LandCover
  baselineCover: LandCover
  structure: Structure
  structureLevel: number
  intensity: (typeof INTENSITIES)[number] | null
  irrigated: boolean
  conservation: boolean
  protected: boolean
  channel: boolean
  terrain: { elevationM: number; slope: number; heightAboveRiverM: number; distanceToRiverCells: number; upstreamCells: number }
  soil: { health: number; moistureMm: number; capacityMm: number; erosionLastSeason: number; erosionSusceptibility: number; sedimentDeposited: number }
  water: { infiltrationMm: number; runoffMm: number; flowThroughMm: number; waterFactor: number; irrigationMm: number; floodedLastSeason: boolean; floodExposure: number }
  vegetation: { cover: number; ageSeasons: number; maturity: number }
  economy: { yieldLastSeasonT: number; treeProductMaturity: number; productivity: number }
  sensitivity: number
  interventions: InterventionOption[]
}

const CELL_ACTIONS: ActionType[] = ['road', 'housing', 'cropland', 'set-intensity', 'toggle-irrigation', 'agroforestry', 'clear', 'reforest', 'wetland', 'conservation', 'reservoir', 'waterworks', 'market', 'demolish']

function actionFor(type: ActionType, i: number, s: SimulationState): PlayerAction {
  if (type === 'cropland') return { type, cells: [i], intensity: 'medium', irrigated: false }
  if (type === 'set-intensity') return { type, cells: [i], intensity: s.layers.intensity[i] === 2 ? 'medium' : 'high' }
  return { type, cells: [i] } as PlayerAction
}

export function inspectCell(s: SimulationState, i: number): CellReport {
  const t = s.terrain
  const L = s.layers
  const F = s.fields
  const c = L.cover[i]
  const options = CELL_ACTIONS.map((type) => {
    const v = validateAction(s, actionFor(type, i, s))
    return { type, ok: v.ok, cost: v.cost, revenue: v.revenue ?? 0, reason: v.ok ? '' : (v.cellReasons?.[0] || v.reasons[0] || '') }
  })
  return {
    index: i,
    x: i % t.width,
    z: Math.floor(i / t.width),
    cover: coverName(c),
    baselineCover: coverName(L.baselineCover[i]),
    structure: structureName(L.structure[i]),
    structureLevel: L.structureLevel[i],
    intensity: c === C.cropland ? INTENSITIES[L.intensity[i]] : null,
    irrigated: c === C.cropland && L.irrigated[i] === 1,
    conservation: L.conservation[i] === 1,
    protected: t.protected[i] === 1,
    channel: t.channel[i] === 1,
    terrain: {
      elevationM: t.elevationM[i],
      slope: t.slope[i],
      heightAboveRiverM: t.heightAboveChannelM[i],
      distanceToRiverCells: t.channelDistance[i],
      upstreamCells: t.flowAccumulation[i],
    },
    soil: {
      health: L.soilHealth[i],
      moistureMm: L.soilMoistureMm[i],
      capacityMm: t.channel[i] || L.structure[i] === S.reservoir ? 0 : soilCapacityMm(c, L.soilHealth[i], L.coverAge[i]),
      erosionLastSeason: F.erosion[i],
      erosionSusceptibility: erosionSusceptibility(s)[i],
      sedimentDeposited: F.sedimentIn[i],
    },
    water: {
      infiltrationMm: F.infiltrationMm[i],
      runoffMm: F.runoffMm[i],
      flowThroughMm: F.flowMm[i],
      waterFactor: F.waterFactor[i],
      irrigationMm: F.irrigationMm[i],
      floodedLastSeason: F.flooded[i] === 1,
      floodExposure: floodExposure(s)[i],
    },
    vegetation: { cover: L.vegetation[i], ageSeasons: L.coverAge[i], maturity: maturity(c, L.coverAge[i]) },
    economy: { yieldLastSeasonT: F.yieldT[i], treeProductMaturity: c === C.agroforestry ? treeProductRamp(L.coverAge[i]) : 0, productivity: productivity(s)[i] },
    sensitivity: environmentalSensitivity(s)[i],
    interventions: options,
  }
}
