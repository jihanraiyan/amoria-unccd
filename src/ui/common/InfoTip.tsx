// Small info button that opens an accessible toggletip (hover, keyboard focus, or a click or
// tap), so metric explanations can be reached on touch screens too.
import { Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { MetricHelp } from './MetricHelp'
import { Tip } from './Tip'
import type { MetricDef } from '../metrics'

export function InfoTip({ label, children, size = 11 }: { label: string; children: ReactNode; size?: number }) {
  return (
    <Tip content={children} width="w-64" toggle>
      <button type="button" className="ml-1 inline-flex align-middle text-dim hover:text-cream focus-visible:text-cream" aria-label={`About ${label}`}>
        <Info size={size} aria-hidden />
      </button>
    </Tip>
  )
}

/** Info toggletip that explains a metric (what, how, what moves it, what kind of number). */
export function MetricInfo({ def, size, extra, className = '' }: { def: MetricDef; size?: number; extra?: ReactNode; className?: string }) {
  return (
    <Tip
      content={
        <>
          <MetricHelp def={def} />
          {extra}
        </>
      }
      width="w-72"
      toggle
      className={className}
    >
      <button
        type="button"
        className="inline-flex align-middle text-dim hover:text-cream focus-visible:text-cream"
        aria-label={`About ${def.label}`}
        data-testid={`metric-info-${def.id}`}
      >
        <Info size={size ?? 11} aria-hidden />
      </button>
    </Tip>
  )
}
