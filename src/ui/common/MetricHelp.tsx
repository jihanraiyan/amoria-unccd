import { useGame } from '../../state/store'
import { KIND_LABEL, KIND_NOTE, type MetricDef } from '../metrics'

/** Tooltip body for any metric: what, how, influenced by, and what kind of number it is. */
export function MetricHelp({ def }: { def: MetricDef }) {
  const meta = useGame((s) => s.sim?.meta ?? null)
  const realNote = meta && def.realDataNote ? def.realDataNote(meta) : null
  return (
    <span className="block">
      <span className="block text-sm font-semibold text-cream">{def.label}</span>
      <span className="mt-1 block">{def.measures}</span>
      <span className="mt-1.5 block">
        <strong className="text-cream">How it is calculated: </strong>
        {def.calculation}
      </span>
      {realNote && <span className="mt-1.5 block text-parchment" data-testid="metric-real-data-note">{realNote}</span>}
      <span className="mt-1.5 block">
        <strong className="text-cream">What moves it: </strong>
        {def.influences}
      </span>
      <span className="mt-2 block border-t border-[var(--panel-line)] pt-1.5">
        <span className="chip mr-1">{KIND_LABEL[def.kind]}</span>
        <span className="mt-1 block text-dim">{KIND_NOTE[def.kind]}</span>
      </span>
    </span>
  )
}
