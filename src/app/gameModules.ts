// Bridge to the render team's 3D world (src/game, public API in src/game/index.ts). It is
// code-split and loaded on demand so the title screen paints at once, and tests replace
// this module with stubs (jsdom has no WebGL).
import { useEffect, useState, type ComponentType } from 'react'
import type * as GameApi from '../game'
import type { SimulationState } from '../simulation/types'
import type { OverlayId } from '../state/store'

export type GameModule = typeof GameApi
export type SnapshotViewProps = GameApi.SnapshotViewProps

export interface OverlayLegendStop {
  color: string
  label: string
  /** Map pattern drawn for this stop, for color-independent reading. */
  pattern?: string
}

/** Subset of the render team's OverlayDef (src/game/core/overlays.ts) the UI reads. */
export interface OverlayMeta {
  id: OverlayId
  label: string
  description?: string
  legend?: OverlayLegendStop[]
  /** Unit of the underlying value, e.g. "m" or "%". */
  unit?: string
  /** Where values come from: terrain, state, model-output or display-index. */
  source?: string
  cue?: { description?: string }
  noDataLabel?: string
  higherIs?: 'better' | 'worse' | 'neutral'
}

/** Helpers from the game API used to show snapshots faithfully (weather, reservoir, shared scale). */
export type SnapshotHelpers = Pick<GameModule, 'weatherForSnapshot' | 'reservoirFillForSnapshot' | 'sharedOverlayDomain'> & {
  /** Legend with numeric labels for an overlay over a given value domain (e.g. the shared compare scale). */
  resolveLegend?(id: OverlayId, domain: [number, number]): OverlayLegendStop[]
  /** Legend with numeric labels for the overlay as the live world currently colors it. */
  legendFor?(id: OverlayId, sim: SimulationState): OverlayLegendStop[] | null
}

export interface GameExports {
  GameWorld: ComponentType | null
  /** Background scene for the title; `worldId` picks the world shown when no game is loaded. */
  LandingScene: ComponentType<{ worldId?: string }> | null
  SnapshotView: ComponentType<SnapshotViewProps> | null
  overlays: OverlayMeta[] | null
  helpers: SnapshotHelpers | null
}

const EMPTY: GameExports = { GameWorld: null, LandingScene: null, SnapshotView: null, overlays: null, helpers: null }

function isOverlayList(v: unknown): v is OverlayMeta[] {
  return Array.isArray(v) && v.every((o) => o && typeof o === 'object' && typeof (o as OverlayMeta).id === 'string')
}

/** Accepts the renderer's OVERLAYS as a list or as a record keyed by overlay id. */
export function normalizeOverlays(v: unknown): OverlayMeta[] | null {
  if (isOverlayList(v)) return v
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const list = Object.entries(v as Record<string, unknown>).map(([id, o]) => ({ id, ...(o as object) }))
    return isOverlayList(list) ? list : null
  }
  return null
}

let loaded: Promise<GameExports> | null = null

export function loadGameExports(): Promise<GameExports> {
  if (!loaded) {
    loaded = import('../game')
      .then(
        (m): GameExports => ({
          GameWorld: m.GameScene as ComponentType,
          LandingScene: m.LandingScene as ComponentType<{ worldId?: string }>,
          SnapshotView: m.SnapshotView,
          overlays: normalizeOverlays(m.OVERLAYS),
          helpers: {
            weatherForSnapshot: m.weatherForSnapshot,
            reservoirFillForSnapshot: m.reservoirFillForSnapshot,
            sharedOverlayDomain: m.sharedOverlayDomain,
            resolveLegend: (id, domain) => m.resolveLegend(id, domain),
            legendFor: (id, sim) => {
              try {
                const domain = m.overlayDomain(id, m.overlayValues(id, m.frameFromSim(sim)))
                return m.resolveLegend(id, domain)
              } catch {
                return null
              }
            },
          },
        }),
      )
      .catch((e: unknown) => {
        console.error('The 3D world module failed to load', e)
        return EMPTY
      })
  }
  return loaded
}

/** Resolves the game exports; null while loading. */
export function useGameExports(): GameExports | null {
  const [value, setValue] = useState<GameExports | null>(null)
  useEffect(() => {
    let alive = true
    loadGameExports().then((v) => {
      if (alive) setValue(v)
    })
    return () => {
      alive = false
    }
  }, [])
  return value
}
