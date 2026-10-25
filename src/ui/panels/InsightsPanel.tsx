import { AlertTriangle, CheckCircle2, Info, MapPin, OctagonAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Explanation } from '../../simulation/types'
import { useGame } from '../../state/store'
import { Panel } from '../common/Panel'
import { afterText, explainsStep } from '../timeline/history'

const TOPICS: { id: Explanation['topic'] | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'food', label: 'Food' },
  { id: 'water', label: 'Water' },
  { id: 'soil', label: 'Soil' },
  { id: 'flood', label: 'Floods' },
  { id: 'vegetation', label: 'Plants' },
  { id: 'budget', label: 'Money' },
  { id: 'population', label: 'People' },
  { id: 'event', label: 'Weather' },
]

export const SEVERITY_ICON = {
  info: Info,
  good: CheckCircle2,
  warning: AlertTriangle,
  critical: OctagonAlert,
} as const

export const SEVERITY_CLASS: Record<Explanation['severity'], string> = {
  info: 'text-info',
  good: 'text-good',
  warning: 'text-warn',
  critical: 'text-bad',
}

const SEVERITY_WORD: Record<Explanation['severity'], string> = {
  info: 'Note',
  good: 'Good news',
  warning: 'Warning',
  critical: 'Serious',
}

const num = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(2))

interface CardProps {
  e: Explanation
  active: boolean
  onOpen(): void
  /** Shows the place on the map (always opens, never toggles). Falls back to onOpen. */
  onShow?(): void
  /** Offer the "show on the map" button (off where there is no live map, as in Compare). */
  mapButton?: boolean
  /** Highlight entries from the season being viewed in history mode. */
  highlight?: boolean
}

export function ExplanationCard({ e, active, onOpen, onShow, mapButton = true, highlight = false }: CardProps) {
  const Icon = SEVERITY_ICON[e.severity]
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [active])
  return (
    <li ref={ref} className={`rounded-lg p-2.5 ${active ? 'bg-white/12 ring-1 ring-marigold/60' : highlight ? 'bg-white/8 ring-1 ring-river/50' : 'bg-black/20'}`}>
      <div className="flex items-start gap-2">
        <Icon size={16} className={`mt-0.5 shrink-0 ${SEVERITY_CLASS[e.severity]}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-[0.68rem] text-dim">
            <span className={`font-bold ${SEVERITY_CLASS[e.severity]}`}>{SEVERITY_WORD[e.severity]}</span> · Year {e.year}, {e.season} season
            {highlight && <span className="ml-1 font-bold text-river">· the season you are viewing</span>}
          </div>
          <button type="button" className="text-left text-sm leading-snug font-semibold hover:text-marigold" onClick={onOpen} aria-expanded={active}>
            {e.title}
          </button>
          <p className="mt-1 text-xs leading-snug text-parchment">{e.body}</p>
          {active && e.evidence.length > 0 && (
            <table className="mt-2 w-full text-[0.7rem]">
              <caption className="sr-only">Evidence</caption>
              <thead>
                <tr className="text-left text-dim">
                  <th scope="col" className="font-semibold">Simulated value</th>
                  <th scope="col" className="text-right font-semibold">Before</th>
                  <th scope="col" className="text-right font-semibold">After</th>
                </tr>
              </thead>
              <tbody>
                {e.evidence.map((ev, i) => (
                  <tr key={`${ev.label}-${i}`} className="border-t border-white/5">
                    <th scope="row" className="py-0.5 text-left font-normal text-muted">{ev.label}</th>
                    <td className="tabular py-0.5 text-right">{ev.before !== undefined ? `${num(ev.before)}${ev.unit ? ` ${ev.unit}` : ''}` : ''}</td>
                    <td className="tabular py-0.5 text-right font-semibold">
                      {num(ev.after)}
                      {ev.unit ? ` ${ev.unit}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!active && e.evidence.length > 0 && (
            <button type="button" className="mt-1 text-[0.68rem] text-river hover:underline" onClick={onOpen}>
              Show the numbers ({e.evidence.length})
            </button>
          )}
        </div>
        {mapButton && e.cells && e.cells.length > 0 && (
          <button type="button" className="btn btn-icon !p-1.5" onClick={onShow ?? onOpen} aria-label={`Show "${e.title}" on the map`} title="Show on map">
            <MapPin size={14} aria-hidden />
          </button>
        )}
      </div>
    </li>
  )
}

export function InsightsPanel() {
  const explanations = useGame((s) => s.explanations)
  const activeId = useGame((s) => s.activeExplanationId)
  const openExplanation = useGame((s) => s.openExplanation)
  const close = useGame((s) => s.openPanel)
  const viewStep = useGame((s) => s.viewStep)
  const [topic, setTopic] = useState<(typeof TOPICS)[number]['id']>('all')
  const [allSeasons, setAllSeasons] = useState(false)
  const pastOnly = viewStep !== null && !allSeasons
  const list = explanations
    .filter((e) => topic === 'all' || e.topic === topic)
    .filter((e) => !pastOnly || explainsStep(e, viewStep))
    .slice()
    .reverse()
  return (
    <Panel title="Insights" eyebrow="Why things changed" onClose={() => close(null)} className="w-[23rem]">
      <p className="mb-2 text-xs leading-snug text-muted">
        Each insight is written from the simulation's own numbers after a season. Open one to see the values behind it, or jump to the place on the map.
      </p>
      {viewStep !== null && (
        <p className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-black/20 p-2 text-xs text-parchment" role="status">
          <span className="flex-1">
            {allSeasons ? 'Showing every season. Entries for the season you are viewing are outlined.' : `Showing what the model wrote about the season you are viewing (${afterText(viewStep).toLowerCase()}).`}
          </span>
          <button type="button" className="text-river hover:underline" aria-pressed={allSeasons} onClick={() => setAllSeasons((v) => !v)}>
            {allSeasons ? 'Only this season' : 'Show all seasons'}
          </button>
        </p>
      )}
      <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Filter by topic">
        {TOPICS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={topic === t.id}
            className={`chip ${topic === t.id ? '!bg-cream !text-ink' : 'hover:bg-white/15'}`}
            onClick={() => setTopic(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="rounded-lg bg-black/20 p-3 text-xs text-dim">
          {explanations.length === 0
            ? 'No insights yet. Advance time and the valley will start telling its story.'
            : pastOnly
              ? 'The model wrote nothing about this season on this topic.'
              : 'Nothing on this topic yet.'}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((e) => (
            <ExplanationCard
              key={`${e.id}-${e.year}-${e.season}`}
              e={e}
              active={e.id === activeId}
              highlight={viewStep !== null && allSeasons && explainsStep(e, viewStep)}
              onOpen={() => openExplanation(e.id === activeId ? null : e.id)}
              onShow={() => openExplanation(e.id)}
            />
          ))}
        </ul>
      )}
    </Panel>
  )
}
