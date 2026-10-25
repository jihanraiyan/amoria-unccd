// Small legend that stays on screen while an overlay recolors the map and the Overlays panel is
// closed, so the colors always have a name, a scale and a reading that does not need color.
import { Layers, X } from 'lucide-react'
import { useMemo } from 'react'
import { useGameExports } from '../../app/gameModules'
import { useGame } from '../../state/store'
import { OVERLAY_FALLBACK, OverlayLegendList, displayUnit } from '../panels/OverlaysPanel'

export function OverlayChip() {
  const overlay = useGame((s) => s.overlay)
  const panel = useGame((s) => s.panel)
  const sim = useGame((s) => s.sim)
  const worldView = useGame((s) => s.worldView)
  const setOverlay = useGame((s) => s.setOverlay)
  const openPanel = useGame((s) => s.openPanel)
  const game = useGameExports()
  const list = game?.overlays?.length ? game.overlays : OVERLAY_FALLBACK
  const meta = list.find((o) => o.id === overlay)
  const helpers = game?.helpers
  // numeric stops for the live map; recomputed only when the overlay or the world changes
  const stops = useMemo(() => {
    if (!meta || meta.id === 'none') return null
    return (sim && helpers?.legendFor?.(meta.id, sim)) || meta.legend || null
  }, [meta, sim, helpers])
  if (overlay === 'none' || panel === 'overlays' || !meta) return null
  const flat = worldView === 'flat'
  return (
    <section className="panel anim-rise pointer-events-auto w-[26rem] max-w-full px-3 py-2" aria-label={`Overlay on: ${meta.label}`}>
      <div className="flex items-center gap-2">
        <Layers size={14} className="shrink-0 text-marigold" aria-hidden />
        <p className="min-w-0 flex-1 text-xs">
          <span className="eyebrow mr-1">Overlay on</span>
          <span className="text-sm font-semibold">{meta.label}</span>
          {meta.unit && <span className="ml-1 text-dim">({displayUnit(meta.unit)})</span>}
        </p>
        <button type="button" className="btn !px-2 !py-0.5 text-xs" aria-label="Open the Overlays panel" onClick={() => openPanel('overlays')}>
          Overlays <span className="kbd ml-1" aria-hidden>1</span>
        </button>
        <button type="button" className="btn btn-ghost btn-icon !p-1" aria-label={`Turn off the ${meta.label} overlay`} onClick={() => setOverlay('none')}>
          <X size={14} aria-hidden />
        </button>
      </div>
      {/* the flat map says itself that it draws land cover only, under the map */}
      {!flat && (
        <>
          {stops && stops.length > 0 && (
            <div className="mt-1.5">
              <OverlayLegendList label={meta.label} stops={stops} inline />
            </div>
          )}
          {meta.cue?.description && (
            <p className="mt-1 text-[0.7rem] leading-snug text-parchment">
              <strong>Without color: </strong>
              {meta.cue.description}
            </p>
          )}
        </>
      )}
    </section>
  )
}
