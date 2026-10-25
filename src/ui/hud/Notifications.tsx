// Toasts for weather and important explanations, plus the one-line action feedback.
import { MapPin, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGame, type Toast } from '../../state/store'
import { buildToolAction } from '../../state/toolActions'
import { actionUpkeep, upkeepPhrase } from '../../state/upkeep'
import { CURSOR_ANCHOR_ID } from './cursorAnchor'
import { cellSummary } from '../inspector/describe'
import { SEVERITY_CLASS, SEVERITY_ICON } from '../panels/InsightsPanel'

const TOAST_MS = 9000

/**
 * Moves focus off a toast that is about to go away: to the next toast's first button, or to the
 * Insights button (where every toast can be read again) if it was the last one.
 */
function handOffFocus(li: HTMLLIElement | null): void {
  if (!li || typeof document === 'undefined' || !li.contains(document.activeElement)) return
  const next = (li.nextElementSibling ?? li.previousElementSibling) as HTMLElement | null
  const candidates = [
    next?.querySelector<HTMLElement>('button'),
    ...document.querySelectorAll<HTMLElement>('[data-panel-button="insights"]:not([role="menuitem"])'),
    ...document.querySelectorAll<HTMLElement>('[data-panel-menu-toggle]'),
  ]
  for (const el of candidates) {
    if (!el) continue
    el.focus({ preventScroll: true })
    // a button hidden at this screen width cannot take focus; try the next one
    if (document.activeElement === el) return
  }
}

function ToastItem({ t }: { t: Toast }) {
  const dismissToast = useGame((s) => s.dismissToast)
  const openExplanation = useGame((s) => s.openExplanation)
  const selectCell = useGame((s) => s.selectCell)
  const requestFocus = useGame((s) => s.requestFocus)
  const ref = useRef<HTMLLIElement>(null)
  // the timer stops while the pointer is over the toast or focus is inside it (WCAG 2.2.1)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const held = hovered || focused
  const dismiss = useCallback(() => {
    handOffFocus(ref.current)
    dismissToast(t.id)
  }, [dismissToast, t.id])
  useEffect(() => {
    // news that paused play stays until the player dismisses it or plays on
    if (held || t.paused) return
    const id = setTimeout(dismiss, TOAST_MS)
    return () => clearTimeout(id)
  }, [held, dismiss, t.paused])
  const Icon = SEVERITY_ICON[t.severity]
  return (
    <li
      ref={ref}
      className="panel anim-rise pointer-events-auto flex w-80 max-w-full gap-2.5 p-3"
      data-toast-id={t.id}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      }}
    >
      <Icon size={18} className={`mt-0.5 shrink-0 ${SEVERITY_CLASS[t.severity]}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug font-semibold">{t.title}</p>
        <p className="mt-0.5 line-clamp-3 text-xs leading-snug text-muted">{t.body}</p>
        <div className="flex flex-wrap gap-x-3">
          {t.paused && t.cells && t.cells.length > 0 && (
            <button
              type="button"
              className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-river hover:underline"
              onClick={() => {
                selectCell(t.cells![0])
                requestFocus(t.cells![0])
              }}
            >
              <MapPin size={12} aria-hidden /> Show on map
            </button>
          )}
          {t.explanationId && (
            <button
              type="button"
              className="mt-1 text-xs font-semibold text-river hover:underline"
              onClick={() => {
                openExplanation(t.explanationId!)
                dismissToast(t.id)
              }}
            >
              Why? See the numbers
            </button>
          )}
        </div>
      </div>
      <button type="button" className="btn btn-ghost btn-icon -m-1 self-start !p-1" aria-label="Dismiss notification" onClick={dismiss}>
        <X size={14} aria-hidden />
      </button>
    </li>
  )
}

/**
 * The visible toasts are not a live region: a season can bring three of them, and at 4x speed
 * that would be read more than once a second. The store writes one summary line per season
 * (every toast after a manual step, only warnings and critical news while playing) and that
 * line is what screen readers hear.
 */
export function Toasts() {
  const toasts = useGame((s) => s.toasts)
  const announcement = useGame((s) => s.toastAnnouncement)
  return (
    <>
      <p className="sr-only" role="status" aria-live="polite" data-testid="toast-announcer">
        {announcement && <span key={announcement.id}>{announcement.text}</span>}
      </p>
      <ol className="flex flex-col items-end gap-2" aria-label="Notifications">
        {toasts.map((t) => (
          <ToastItem key={t.id} t={t} />
        ))}
      </ol>
    </>
  )
}

const FEEDBACK_MS = 6000

/** "Parcel 12, 30 (Cropland)" for the parcel under the keyboard cursor. */
function useCursorTitle(): string | null {
  const cell = useGame((s) => s.cursorCell)
  const sim = useGame((s) => s.sim)
  const view = useGame((s) => s.viewSnapshot)
  if (cell === null || !sim) return null
  const w = sim.terrain.width
  return `Parcel ${cell % w}, ${Math.floor(cell / w)} (${cellSummary((view ?? sim).layers, cell).title})`
}

function PreviewLine() {
  const preview = useGame((s) => s.preview)
  const tool = useGame((s) => s.tool)
  const cursor = useGame((s) => s.cursorCell)
  const title = useCursorTitle()
  const sim = useGame((s) => s.sim)
  const options = useGame((s) => s.toolOptions)
  const upkeep = useMemo(() => {
    if (!sim || !preview || tool === 'inspect') return ''
    const action = buildToolAction(tool, preview.cells, options)
    return action ? upkeepPhrase(actionUpkeep(sim, action, preview.validation)) : ''
  }, [sim, preview, tool, options])
  if (!preview || tool === 'inspect') {
    if (!title) return null
    return (
      <p>
        <span className="font-bold text-cream">{title}.</span>
        <span className="text-muted"> Shift and the arrow keys move between parcels{tool === 'inspect' ? '; pick a tool to build here.' : '.'}</span>
      </p>
    )
  }
  const v = preview.validation
  const okCount = v.cellOk.filter(Boolean).length
  const cls = v.ok ? 'text-good' : 'text-bad'
  const atCursor = cursor !== null && preview.cells.includes(cursor)
  return (
    <p>
      {atCursor && title && <span className="font-semibold text-cream">{title}: </span>}
      <span className={`font-bold ${cls}`}>{v.ok ? 'Can build' : 'Cannot build'}</span>
      <span className="text-muted">
        {' '}
        · {okCount} of {preview.cells.length} parcel{preview.cells.length === 1 ? '' : 's'} valid
      </span>
      {v.cost > 0 && <span className="tabular"> · costs ${Math.round(v.cost).toLocaleString('en-US')}</span>}
      {upkeep && <span className="tabular text-warn" data-testid="preview-upkeep"> · {upkeep}</span>}
      {v.revenue !== undefined && v.revenue > 0 && <span className="tabular text-good"> · earns ${Math.round(v.revenue).toLocaleString('en-US')}
          {v.timberHa !== undefined && v.timberHa > 0 && ` for ${v.timberHa.toLocaleString('en-US', { maximumFractionDigits: 1 })} ha of timber (the price falls the more you sell)`}
        </span>}
      {!v.ok && v.reasons[0] && <span className="text-parchment"> · {v.reasons[0]}</span>}
      {atCursor && v.ok && <span className="text-muted"> · press Enter to build</span>}
    </p>
  )
}

/**
 * The status line under the world. The pointer hover preview sits outside the live region so
 * screen readers are not read every parcel the mouse crosses; the keyboard cursor read-out and
 * action results are announced. The live region is always mounted because Shift and the arrows
 * move focus to it, so a following Enter builds at the cursor.
 */
export function FeedbackLine() {
  const feedback = useGame((s) => s.feedback)
  const clearFeedback = useGame((s) => s.clearFeedback)
  const preview = useGame((s) => s.preview)
  const tool = useGame((s) => s.tool)
  const cursor = useGame((s) => s.cursorCell)
  useEffect(() => {
    if (!feedback) return
    const id = setTimeout(() => clearFeedback(feedback.id), FEEDBACK_MS)
    return () => clearTimeout(id)
  }, [feedback, clearFeedback])

  const pointerPreview = cursor === null && !!preview && tool !== 'inspect'
  const announced = cursor !== null || !!feedback
  const cls = feedback?.kind === 'ok' ? 'text-good' : feedback?.kind === 'error' ? 'text-bad' : feedback?.kind === 'warning' ? 'text-warn' : 'text-info'
  const word = feedback?.kind === 'ok' ? 'Done' : feedback?.kind === 'error' ? 'Not possible' : feedback?.kind === 'warning' ? 'Heads up' : 'Note'
  return (
    <div className="flex max-w-[40rem] flex-col items-center gap-1">
      {pointerPreview && (
        <div className="panel pointer-events-none w-full px-3 py-1.5 text-sm">
          <PreviewLine />
        </div>
      )}
      <div
        id={CURSOR_ANCHOR_ID}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className={
          announced
            ? `panel w-full space-y-0.5 px-3 py-1.5 text-sm ${feedback ? 'pointer-events-auto' : 'pointer-events-none'}`
            : 'sr-only'
        }
      >
        {cursor !== null && <PreviewLine />}
        {feedback && (
          <p key={feedback.id}>
            <span className={`font-bold ${cls}`}>{word}:</span> <span className="text-parchment">{feedback.text}</span>
          </p>
        )}
      </div>
    </div>
  )
}
