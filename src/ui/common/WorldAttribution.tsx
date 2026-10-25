// Data credits that the source licences require wherever a real-data map is shown
// (Copernicus DEM notice, ESA WorldCover CC BY 4.0, OpenStreetMap ODbL). One component for
// the game screen, the title screen and Compare Futures.
import { useEffect, useState } from 'react'
import type { WorldInput } from '../../simulation/types'
import { loadWorldNotes, worldNotes } from '../../state/worlds'

interface Props {
  /** A loaded world (game and compare screens). */
  world?: WorldInput | null
  /** A world id to load notes for when no world is loaded yet (title screen). */
  worldId?: string | null
  className?: string
}

const BASE = 'rounded bg-ink/75 px-1.5 py-0.5 text-[0.68rem] leading-snug text-muted'

export function WorldAttribution({ world, worldId, className = '' }: Props) {
  const [loaded, setLoaded] = useState<{ id: string; lines: string[] } | null>(null)
  const direct = world ? (worldNotes(world)?.attribution ?? []) : null
  useEffect(() => {
    if (world || !worldId) return
    let alive = true
    void loadWorldNotes(worldId).then((n) => {
      if (alive) setLoaded({ id: worldId, lines: n?.attribution ?? [] })
    })
    return () => {
      alive = false
    }
  }, [world, worldId])
  const lines = direct ?? (loaded && loaded.id === worldId ? loaded.lines : [])
  if (!lines.length) return null
  return (
    <p className={`${BASE} ${className}`} aria-label="Map data credits" data-testid="map-credits">
      Map data: {lines.join(' · ')}
    </p>
  )
}
