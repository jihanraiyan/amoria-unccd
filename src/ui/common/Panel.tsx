// Floating, dismissible, non-modal panel. Keeps the 3D world visible around it.
import { X } from 'lucide-react'
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import type { PanelId } from '../../state/store'
import { StatusMark } from './StatusMark'

/** Which rail panel this is, so focus can fall back to its button when the panel closes. */
export const PanelIdContext = createContext<PanelId | null>(null)

/** Gives focus back when a panel closes: to whatever opened it, else that panel's rail button. */
function restoreFocus(opener: Element | null, id: PanelId | null): void {
  const candidates: HTMLElement[] = []
  if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body) candidates.push(opener)
  if (id) candidates.push(...document.querySelectorAll<HTMLElement>(`[data-panel-button="${id}"]`))
  for (const el of candidates) {
    el.focus({ preventScroll: true })
    // a button that cannot take focus (hidden or gone) is skipped for the next one
    if (document.activeElement === el) return
  }
}

interface PanelProps {
  title: string
  eyebrow?: string
  onClose(): void
  children: ReactNode
  className?: string
  /** Extra controls in the header, left of the close button. */
  actions?: ReactNode
}

export function Panel({ title, eyebrow, onClose, children, className = '', actions }: PanelProps) {
  const ref = useRef<HTMLElement>(null)
  const panelId = useContext(PanelIdContext)
  useEffect(() => {
    const el = ref.current
    const opener = document.activeElement
    el?.focus({ preventScroll: true })
    return () => {
      // give focus back only if it was still in the panel (or dropped to the page), never steal it
      const now = document.activeElement
      const lost = !now || now === document.body || !now.isConnected || (el?.contains(now) ?? false)
      if (lost) restoreFocus(opener, panelId)
    }
  }, [panelId])
  return (
    <section
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      tabIndex={-1}
      className={`panel anim-rise pointer-events-auto flex max-h-full flex-col overflow-hidden outline-none ${className}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <header className="flex items-start gap-3 border-b border-[var(--panel-line)] px-4 pt-3 pb-2.5">
        <div className="min-w-0 flex-1">
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h2 className="text-base leading-tight font-semibold text-cream">{title}</h2>
        </div>
        {actions}
        <button type="button" className="btn btn-ghost btn-icon -mr-1" onClick={onClose} aria-label={`Close ${title}`}>
          <X size={18} aria-hidden />
        </button>
      </header>
      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
    </section>
  )
}

export function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <section className="mb-4 last:mb-0">
      <h3 className="eyebrow mb-1.5">{title}</h3>
      {hint && <p className="mb-2 text-xs text-dim">{hint}</p>}
      {children}
    </section>
  )
}

/** Simple labelled 0..1 bar with the value written out (never color alone). */
export function Meter({ label, value, format, tone }: { label: string; value: number; format?: (v: number) => string; tone?: 'good' | 'warn' | 'bad' | 'info' }) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
  const color = tone === 'good' ? 'bg-good' : tone === 'warn' ? 'bg-warn' : tone === 'bad' ? 'bg-bad' : 'bg-river'
  return (
    <div className="mb-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular font-semibold">
          {format ? format(value) : `${Math.round(v * 100)}%`}
          {(tone === 'warn' || tone === 'bad') && <StatusMark tone={tone} word={tone === 'bad' ? 'critical' : 'under strain'} />}
        </span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-white/10" role="presentation">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${v * 100}%` }} />
      </div>
    </div>
  )
}
