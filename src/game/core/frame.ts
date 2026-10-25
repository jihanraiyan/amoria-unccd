// A WorldFrame is everything the renderer needs to draw one moment of the world, taken
// either from the live simulation state or from a stored Snapshot. The renderer only maps
// these values to visuals; it never runs environmental models.
import type { Season, SimulationState, Snapshot, StepFields, Terrain, WeatherSeason, WorldLayers } from '../../simulation/types'

export type WeatherKind = WeatherSeason['kind']

export interface WorldFrame {
  terrain: Terrain
  layers: WorldLayers
  fields: StepFields
  /** False before the first simulated season (step fields are still all zero). */
  fieldsReady: boolean
  /** Season whose conditions the layers/fields describe (the most recently simulated one). */
  season: Season
  weather: WeatherKind
  /** Erosion peak multiplier of that season (1 = normal). */
  stormIntensity: number
  /** Reservoir fill 0..1 (storage / capacity), or null when unknown. */
  reservoirFill: number | null
}

/** True if any value of the array is non-zero. */
function anyNonZero(a: ArrayLike<number> | undefined): boolean {
  if (!a) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== 0) return true
  return false
}

export function fieldsAreReady(fields: StepFields): boolean {
  return anyNonZero(fields.waterFactor) || anyNonZero(fields.infiltrationMm) || anyNonZero(fields.runoffMm)
}

/**
 * Weather of the most recently simulated season. The weather array is indexed by step
 * (weather[k] is the season simulated by step k -> k+1), so after `step` steps the last
 * simulated season is weather[step - 1]. Before the first step nothing has happened yet,
 * so we show a calm view of the starting season.
 */
export function lastSimulatedWeather(sim: Pick<SimulationState, 'step' | 'weather'>): WeatherSeason | null {
  if (sim.step <= 0) return null
  return sim.weather[sim.step - 1] ?? sim.weather[sim.weather.length - 1] ?? null
}

export function frameFromSim(sim: SimulationState): WorldFrame {
  const w = lastSimulatedWeather(sim)
  const lastHistory = sim.history.length ? sim.history[sim.history.length - 1] : null
  const cap = sim.totals?.reservoirCapacityM3 ?? 0
  return {
    terrain: sim.terrain,
    layers: sim.layers,
    fields: sim.fields,
    fieldsReady: sim.step > 0 && fieldsAreReady(sim.fields),
    // before the first step the history only holds a baseline point, so use the current season
    season: w?.season ?? (sim.step > 0 ? lastHistory?.season : undefined) ?? sim.season,
    weather: w?.kind ?? (sim.step > 0 ? lastHistory?.weather : undefined) ?? 'normal',
    stormIntensity: w?.stormIntensity ?? 1,
    reservoirFill: cap > 0 && Number.isFinite(sim.reservoirM3) ? Math.min(1, Math.max(0, sim.reservoirM3 / cap)) : null,
  }
}

/** Reservoir fill 0..1 a snapshot carries itself (storage over capacity), or null. */
export function snapshotReservoirFill(snapshot: Snapshot): number | null {
  const cap = snapshot.totals?.reservoirCapacityM3 ?? 0
  const stored = snapshot.reservoirM3
  if (!(cap > 0) || typeof stored !== 'number' || !Number.isFinite(stored)) return null
  return Math.min(1, Math.max(0, stored / cap))
}

/**
 * Frame for a stored snapshot. Snapshots do not carry their weather, so callers that have it
 * (SimulationState.weather, see weatherForSnapshot) can pass it. The reservoir level comes from
 * the snapshot's own storage and capacity; `reservoirFill` overrides it when given.
 */
export function frameFromSnapshot(snapshot: Snapshot, terrain: Terrain, weather?: WeatherSeason | null, reservoirFill?: number | null): WorldFrame {
  return {
    terrain,
    layers: snapshot.layers,
    fields: snapshot.fields,
    fieldsReady: fieldsAreReady(snapshot.fields),
    season: weather?.season ?? snapshot.season,
    weather: weather?.kind ?? 'normal',
    stormIntensity: weather?.stormIntensity ?? 1,
    reservoirFill: reservoirFill ?? snapshotReservoirFill(snapshot),
  }
}
