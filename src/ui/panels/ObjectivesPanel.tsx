import { CheckCircle2, Circle, XCircle } from 'lucide-react'
import { useMemo } from 'react'
import { evaluateObjectives, type ObjectivesResult } from '../../state/objectives'
import { useGame } from '../../state/store'
import { Panel } from '../common/Panel'

export function useObjectives(): ObjectivesResult | null {
  const sim = useGame((s) => s.sim)
  return useMemo(() => (sim ? evaluateObjectives(sim) : null), [sim])
}

export function ObjectivesPanel() {
  const result = useObjectives()
  const sim = useGame((s) => s.sim)
  const close = useGame((s) => s.openPanel)
  if (!result || !sim) return null
  const met = result.items.filter((o) => o.met).length
  return (
    <Panel title="Watershed goals" eyebrow={`${met} of ${result.items.length} on track`} onClose={() => close(null)} className="w-[21rem]">
      <p className="mb-3 text-xs leading-snug text-muted">
        Help the valley thrive for {sim.horizonYears} years. There is no single right plan: homes, food, water, money and healthy land pull in different directions. Goals are checked against the live simulation every season.
      </p>
      {result.error && (
        <p className="mb-3 rounded-lg bg-black/20 p-3 text-xs text-warn" role="status">
          {result.error}
        </p>
      )}
      <ul className="space-y-2">
        {result.items.map((o) => (
          <li key={o.id} className="rounded-lg bg-black/20 p-2.5">
            <div className="flex items-start gap-2">
              {o.met ? (
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-good" aria-hidden />
              ) : o.state === 'missed' ? (
                <XCircle size={16} className="mt-0.5 shrink-0 text-bad" aria-hidden />
              ) : (
                <Circle size={16} className="mt-0.5 shrink-0 text-dim" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{o.label}</span>
                  <span className={`text-[0.68rem] font-bold ${o.met ? 'text-good' : o.state === 'missed' ? 'text-bad' : 'text-muted'}`} data-testid={`goal-state-${o.id}`}>
                    {o.met ? 'On track' : o.state === 'missed' ? `Missed in year ${o.missedYear}` : 'Not yet'}
                  </span>
                </div>
                <p className="text-[0.7rem] text-muted">{o.description}</p>
                {o.state === 'missed' ? null : (
                <div
                  className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10"
                  role="progressbar"
                  aria-label={o.label}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(o.progress * 100)}
                >
                  <div className={`h-full rounded-full ${o.met ? 'bg-good' : 'bg-marigold'}`} style={{ width: `${o.progress * 100}%` }} />
                </div>
                )}
                <p className="tabular mt-1 text-[0.68rem] text-parchment">{o.detail}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {!result.error && (
        <p className="mt-3 text-[0.68rem] text-dim">
          Goals, targets and progress come from the simulation's guided scenario. They describe what doing well means here; they do not change how the valley behaves.
        </p>
      )}
    </Panel>
  )
}
