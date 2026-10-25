// Helpers for showing stored snapshots.
import { useGame } from '../../state/store'
import type { OverlayId } from '../core/overlays'
import type { HistoryPoint, Snapshot, Terrain, WeatherSeason } from '../../simulation/types'
import { frameFromSnapshot, snapshotReservoirFill } from '../core/frame'
import { overlayDomain, overlayValues } from '../core/overlays'

let nextId = 1
const ids = new WeakMap<Snapshot, number>()

/** Stable key per snapshot object (used to snap visuals when switching snapshots). */
export function snapshotKey(s: Snapshot): string {
  let id = ids.get(s)
  if (!id) {
    id = nextId++
    ids.set(s, id)
  }
  return `snap-${id}`
}

/**
 * Index into the weather sequence of the season labelled (year, season): year 1 wet is 0 and
 * each season adds one. Snapshots from step() carry the label of the season that was just
 * simulated, so this is also the step that produced them.
 */
export function seasonIndex(year: number, season: 'wet' | 'dry'): number {
  return (year - 1) * 2 + (season === 'dry' ? 1 : 0)
}

/**
 * True for the pre-game snapshot (snapshots[0]: the world before any season was played). It
 * carries the same year 1 wet label as the first simulated season, so it is told apart by its
 * index when the caller passes one, or else by identity with the store's run snapshots.
 */
export function isInitialSnapshot(s: Snapshot, index?: number): boolean {
  if (index !== undefined) return index === 0
  const g = useGame.getState()
  return g.snapshots[0] === s || g.compare.A?.snapshots[0] === s || g.compare.B?.snapshots[0] === s
}

/**
 * Weather of the season a snapshot shows, if the sequence covers it. The pre-game snapshot has
 * no simulated season yet, so it gets null (a calm view of the starting season). Pass `index`
 * (the snapshot's position in the run, which equals the steps simulated) when you have it.
 */
export function weatherForSnapshot(weather: readonly WeatherSeason[] | undefined, s: Snapshot, index?: number): WeatherSeason | null {
  if (!weather || !weather.length || isInitialSnapshot(s, index)) return null
  const k = index !== undefined ? index - 1 : seasonIndex(s.year, s.season)
  return k >= 0 && k < weather.length ? (weather[k] ?? null) : null
}

/**
 * Reservoir fill for the season a snapshot shows: the snapshot's own storage over capacity when
 * it carries them (every engine snapshot does), else the fill recorded in history. The pre-game
 * snapshot falls back to the starting fill (the step 0 history point).
 */
export function reservoirFillForSnapshot(history: readonly HistoryPoint[] | undefined, s: Snapshot, index?: number): number | null {
  const own = snapshotReservoirFill(s)
  if (own !== null) return own
  if (!history) return null
  const finite = (v: number) => (Number.isFinite(v) ? v : null)
  if (isInitialSnapshot(s, index)) {
    const start = history.find((h) => h.step === 0)
    return start ? finite(start.reservoirFillFrac) : null
  }
  if (index !== undefined) {
    const h = history.find((p) => p.step === index)
    if (h) return finite(h.reservoirFillFrac)
  }
  for (let k = history.length - 1; k >= 0; k--) {
    const h = history[k]
    if (h.year === s.year && h.season === s.season && h.step > 0) return finite(h.reservoirFillFrac)
  }
  return null
}

/** One overlay scale shared by several snapshots, so compare views use the same colors. */
export function sharedOverlayDomain(id: OverlayId, snapshots: readonly Snapshot[], terrain: Terrain): [number, number] {
  const values = snapshots.map((s) => overlayValues(id, frameFromSnapshot(s, terrain)))
  return overlayDomain(id, ...values)
}
