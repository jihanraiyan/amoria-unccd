import { useGameExports, type OverlayLegendStop, type OverlayMeta } from '../../app/gameModules'
import { useGame } from '../../state/store'
import { KIND_LABEL } from '../metrics'
import { Panel } from '../common/Panel'
import { useRoving } from '../common/useRoving'

/** Labels used until the renderer's overlay catalogue has loaded (or if it is missing). */
export const OVERLAY_FALLBACK: OverlayMeta[] = [
  { id: 'none', label: 'No overlay', description: 'The landscape as it looks.' },
  { id: 'landcover', label: 'Land cover', description: 'What covers each parcel right now.' },
  { id: 'elevation', label: 'Elevation', description: 'Height of the land.' },
  { id: 'slope', label: 'Slope', description: 'How steep each parcel is.' },
  { id: 'runoff', label: 'Runoff and water flow', description: 'Where rain ran off last season and where it flowed.' },
  { id: 'soil', label: 'Soil health', description: 'The soil condition index.' },
  { id: 'erosion', label: 'Erosion pressure', description: 'Where soil was most at risk last season.' },
  { id: 'productivity', label: 'Farm productivity', description: 'Harvest on farmland last season.' },
  { id: 'moisture', label: 'Soil moisture', description: 'Water held in the soil.' },
  { id: 'sensitivity', label: 'Environmental sensitivity', description: 'Parcels most likely to suffer from careless use.' },
  { id: 'susceptibility', label: 'Erosion risk', description: 'Soil each parcel would lose in a normal wet season with its current cover.' },
  { id: 'urban', label: 'Urban development', description: 'How built up each parcel is: roads, homes and service buildings.' },
]

const SOURCE_LABEL: Record<string, string> = {
  state: 'Current state of the land',
  'model-output': 'Illustrative model output from the last season',
  'derived-indicator': 'Derived indicator computed by the simulation',
}

/**
 * Terrain is measured only on real-data maps, and only elevation itself: slope and other
 * terrain layers are computed by the game from the depression-filled heights. The inspector
 * uses the same wording.
 */
export function sourceLabel(source: string | undefined, mapKind: string | undefined, overlayId?: string): string | null {
  if (!source) return null
  if (source === 'terrain') {
    if (mapKind !== 'real-data-derived') return 'Fictional map terrain'
    return overlayId === undefined || overlayId === 'elevation' ? `${KIND_LABEL.observed} (elevation, depression-filled)` : 'Derived from observed elevation'
  }
  return SOURCE_LABEL[source] ?? null
}

/** Erosion and sediment figures are game tonnes (MODEL_ASSUMPTIONS section 5), never bare tonnes. */
export function displayUnit(text: string): string {
  return text.replace(/(^|[^\w/])(?<!game )t\/ha\b/g, '$1game t/ha')
}

/** The legend stops of an overlay: a swatch, its label and any map pattern drawn with it. */
export function OverlayLegendList({ label, stops, inline = false }: { label: string; stops: OverlayLegendStop[]; inline?: boolean }) {
  return (
    <ul className={inline ? 'flex flex-wrap gap-x-3 gap-y-1' : 'mt-2 space-y-1'} aria-label={`${label} legend`}>
      {stops.map((l, i) => (
        <li key={`${l.label}-${i}`} className="flex items-center gap-1.5 text-xs">
          <span className="inline-block h-3 w-5 shrink-0 rounded-sm border border-white/20" style={{ background: l.color }} aria-hidden />
          <span>{displayUnit(l.label)}</span>
          {l.pattern && l.pattern !== 'plain' && <span className="text-dim">({l.pattern})</span>}
        </li>
      ))}
    </ul>
  )
}

export function OverlaysPanel() {
  const overlay = useGame((s) => s.overlay)
  const setOverlay = useGame((s) => s.setOverlay)
  const close = useGame((s) => s.openPanel)
  const sim = useGame((s) => s.sim)
  const game = useGameExports()
  const list = game?.overlays?.length ? game.overlays : OVERLAY_FALLBACK
  const active = list.find((o) => o.id === overlay)
  // numeric legend labels for the current map when the renderer can provide them
  const overlayItem = useRoving(
    list.map((o) => o.id),
    overlay,
    setOverlay,
  )
  const legend = (active && sim && game?.helpers?.legendFor?.(active.id, sim)) || active?.legend
  const sourceText = sourceLabel(active?.source, sim?.meta.kind, active?.id)
  return (
    <Panel title="Overlays" eyebrow="See the hidden layers" onClose={() => close(null)} className="w-[21rem]">
      <div role="radiogroup" aria-label="Map overlay" className="grid grid-cols-2 gap-1">
        {list.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={overlay === o.id}
            {...overlayItem(o.id)}
            onClick={() => setOverlay(o.id)}
            className={`rounded-lg px-2 py-1.5 text-left text-xs font-semibold transition-colors ${
              overlay === o.id ? 'bg-cream text-ink' : 'bg-black/20 hover:bg-white/10'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {active && active.id !== 'none' && (
        <div className="mt-3 rounded-lg bg-black/20 p-3">
          <h3 className="text-base font-semibold">{active.label}</h3>
          {active.description && <p className="mt-1 text-xs leading-snug text-muted">{active.description}</p>}
          {legend && legend.length > 0 && <OverlayLegendList label={active.label} stops={legend} />}
          {active.unit && <p className="mt-2 text-[0.68rem] text-dim">Unit: {displayUnit(active.unit)}</p>}
          {active.noDataLabel && <p className="mt-1 text-[0.68rem] text-dim">Shown plain: {active.noDataLabel}</p>}
          {active.cue?.description && (
            <p className="mt-2 text-[0.7rem] leading-snug text-parchment">
              <strong>Without color: </strong>
              {active.cue.description}
            </p>
          )}
          {sourceText && <p className="mt-2 chip">{sourceText}</p>}
        </div>
      )}
      {!game && <p className="mt-2 text-xs text-dim">Loading map layers...</p>}
      <p className="mt-3 text-[0.68rem] text-dim">Overlays recolor the 3D map; keep building while one is on. Press 1 to open or close this panel.</p>
    </Panel>
  )
}
