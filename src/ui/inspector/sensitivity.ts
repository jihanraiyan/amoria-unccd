// The simulation's environmental sensitivity for one parcel, the same index the
// "Environmental sensitivity" overlay draws, plus its parts. Values and the deciding part come
// from sensitivityParts in src/simulation/derived/overlays.ts; the UI only picks out one cell.
// Whole-map arrays are cached per layers object, so scrubbing and hovering stay cheap.
import { SENSITIVITY_DRIVERS, erosionSusceptibility, sensitivityParts, type SensitivityParts } from '../../simulation/derived/overlays'
import { coverCode, structureCode, type SimulationState, type Snapshot } from '../../simulation/types'

export type SensitivityDriver = 'erosion' | 'flood' | 'stream-bank' | 'wetland'

export interface CellSensitivity {
  /** 0..1, the overlay's value for this parcel. Null on water (the overlay leaves it plain). */
  index: number | null
  /** Soil this parcel would lose in a normal wet season with its current cover (game t/ha). */
  erosionRisk: number
  /** 0..1, how little river rise it takes to flood the parcel. */
  flood: number
  /** The part that set the index (the highest of the four), or null on water or when all are zero. */
  driver: SensitivityDriver | null
}

export const DRIVER_TEXT: Record<SensitivityDriver, string> = {
  erosion: 'how fast its soil would wash away if it were bare',
  flood: 'how easily the river floods it',
  'stream-bank': 'it sits on a stream bank',
  wetland: 'it is wetland',
}

interface DerivedLayers {
  parts: SensitivityParts
  risk: Float32Array
}

const cache = new WeakMap<object, DerivedLayers>()

/** The state the derived helpers read: the live run, or the live terrain with a past snapshot's land. */
function stateFor(sim: SimulationState, view: Snapshot | null): SimulationState {
  return view ? { ...sim, layers: view.layers, fields: view.fields } : sim
}

function derivedFor(sim: SimulationState, view: Snapshot | null): DerivedLayers {
  const key = view ? view.layers : sim.layers
  const hit = cache.get(key)
  if (hit) return hit
  const s = stateFor(sim, view)
  const out = { parts: sensitivityParts(s), risk: erosionSusceptibility(s) }
  cache.set(key, out)
  return out
}

export function cellSensitivity(sim: SimulationState, view: Snapshot | null, cell: number): CellSensitivity {
  const s = stateFor(sim, view)
  const { parts, risk } = derivedFor(sim, view)
  const water = s.terrain.channel[cell] === 1 || s.layers.cover[cell] === coverCode('water') || s.layers.structure[cell] === structureCode('reservoir')
  if (water) return { index: null, erosionRisk: 0, flood: 0, driver: null }
  const name = SENSITIVITY_DRIVERS[parts.driver[cell]]
  const driver: SensitivityDriver | null = name === 'none' || name === undefined ? null : name
  return { index: parts.max[cell], erosionRisk: risk[cell], flood: parts.flood[cell], driver }
}
