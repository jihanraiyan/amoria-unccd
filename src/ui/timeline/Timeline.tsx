// History strip (bottom left): the scrubber with weather and decision markers. Scenario bar
// (bottom right): goals, the report and the entry points to Compare Futures. Play, speed and
// stepping live in the top bar.
import { CloudRain, FileText, GitBranch, GitCompareArrows, Sprout, Sun, Target } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useObjectives } from '../panels/ObjectivesPanel'
import { useGame } from '../../state/store'
import { rememberFocus } from '../common/focusReturn'
import { Tip } from '../common/Tip'
import type { DecisionRecord } from '../../simulation/types'
import { WEATHER_WORD, afterText, decisionMarkers, describeRecord, firstCell, seasonText, weatherBefore } from './history'

export { stepDate } from './history'

function GoalsChip() {
  const result = useObjectives()
  const togglePanel = useGame((s) => s.togglePanel)
  if (!result) return null
  if (result.error) {
    return (
      <button type="button" className="btn btn-ghost !px-2" onClick={() => togglePanel('objectives')} aria-label="Goals unavailable">
        <Target size={16} aria-hidden /> <span className="text-xs">Goals unavailable</span>
      </button>
    )
  }
  const met = result.items.filter((o) => o.met).length
  return (
    <button type="button" className="btn" onClick={() => togglePanel('objectives')} aria-label={`Goals: ${met} of ${result.items.length} on track`}>
      <Target size={16} aria-hidden />
      <span className="tabular">
        {met}/{result.items.length}
      </span>
    </button>
  )
}

function CompareControls() {
  const runLabel = useGame((s) => s.runLabel)
  const A = useGame((s) => s.scenarios.A)
  const saveScenarioA = useGame((s) => s.saveScenarioA)
  const branchScenarioB = useGame((s) => s.branchScenarioB)
  const openCompare = useGame((s) => s.openCompare)
  const step = useGame((s) => s.sim?.step ?? 0)
  if (runLabel === 'B' && A) {
    return (
      <Tip content={`Compare this run (B) with Scenario A. Both started from the same valley, budget and weather.`} side="top">
        <button
          type="button"
          className="btn btn-primary"
          data-compare-opener
          onClick={() => {
            void openCompare()
            // coming back from Compare puts focus on this button again
            if (useGame.getState().screen === 'compare') rememberFocus('[data-compare-opener]')
          }}
          disabled={step === 0}
        >
          <GitCompareArrows size={16} aria-hidden /> Compare futures
        </button>
      </Tip>
    )
  }
  if (A && runLabel === 'A') {
    return (
      <div className="flex gap-1">
        <Tip content="Re-save Scenario A at this point in time." side="top">
          <button type="button" className="btn btn-ghost !px-2" onClick={saveScenarioA}>
            Update A
          </button>
        </Tip>
        <Tip content="Start Scenario B from exactly the same start: same valley, same budget, same weather. If you kept playing after saving A, A is saved again at this point first, so nothing is lost." side="top">
          <button type="button" className="btn btn-primary" onClick={() => void branchScenarioB()}>
            <GitBranch size={16} aria-hidden /> Play Scenario B
          </button>
        </Tip>
      </div>
    )
  }
  if (A && runLabel === null) {
    // Scenario A is saved but this is a fresh run (the player reset): offer B from A, or replace A
    return (
      <div className="flex gap-1">
        <Tip content={`Replace the saved Scenario A (saved at ${seasonText(A.endStep).toLowerCase()}) with this run.`} side="top">
          <button type="button" className="btn btn-ghost !px-2" onClick={saveScenarioA} disabled={step === 0}>
            Replace A
          </button>
        </Tip>
        <Tip content="Start Scenario B from the same start as the saved Scenario A. This run is not kept." side="top">
          <button type="button" className="btn btn-primary" onClick={() => void branchScenarioB()}>
            <GitBranch size={16} aria-hidden /> Play Scenario B
          </button>
        </Tip>
      </div>
    )
  }
  return (
    <Tip content="Save this run as Scenario A. Then play a second run from the same start and compare the two futures side by side." side="top" width="w-64">
      <button type="button" className="btn btn-ghost !px-2" onClick={saveScenarioA} disabled={step === 0}>
        <GitBranch size={16} aria-hidden /> Save as Scenario A
      </button>
    </Tip>
  )
}

export function Timeline() {
  const sim = useGame((s) => s.sim)
  const viewStep = useGame((s) => s.viewStep)
  const viewHistory = useGame((s) => s.viewHistory)
  if (!sim) return null
  const max = sim.step
  const value = viewStep ?? max
  const pos = (k: number) => (max === 0 ? 0 : (Math.min(k, max) / max) * 100)
  // a history point recorded after `p.step` seasons is marked where that snapshot sits
  const events = sim.history.filter((p) => p.step > 0 && p.weather !== 'normal').map((p) => ({ step: p.step, kind: p.weather }))
  const markers = decisionMarkers(sim.decisions, max)
  const weatherNow = weatherBefore(sim, value)
  const valueText =
    viewStep === null
      ? `${seasonText(max)}, now${weatherNow && weatherNow !== 'normal' ? `. Last season: ${WEATHER_WORD[weatherNow]}` : ''}`
      : `${afterText(value)}${weatherNow && weatherNow !== 'normal' ? ` (${WEATHER_WORD[weatherNow]})` : ''}, viewing the past`

  return (
    <div className="panel pointer-events-auto flex w-full min-w-0 flex-col px-3 pt-1.5 pb-1" role="region" aria-label="Timeline">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <Tip content={<HistoryKey />} side="top" width="w-60">
          <span tabIndex={0} className="cursor-help font-semibold text-muted">
            History
          </span>
        </Tip>
        <span className="tabular truncate text-dim">
          {viewStep !== null && <span className="mr-1.5 text-marigold">viewing the past</span>}
          {sim.year <= sim.horizonYears ? `Year ${sim.year} of ${sim.horizonYears}` : `Sandbox, year ${sim.year}`}
        </span>
      </div>
      <div className="relative h-11">
        <div className="pointer-events-none absolute top-0 right-0 left-0 h-3" aria-hidden>
          {events.map((e) => {
            const Icon = e.kind === 'drought' ? Sun : e.kind === 'heavy-rain' ? CloudRain : Sprout
            const color = e.kind === 'drought' ? 'text-warn' : e.kind === 'heavy-rain' ? 'text-river' : 'text-good'
            return (
              <span key={`w${e.step}`} className={`absolute -translate-x-1/2 ${color}`} style={{ left: `${pos(e.step)}%` }}>
                <Icon size={10} />
              </span>
            )
          })}
        </div>
        <label className="sr-only" htmlFor="history-scrubber">
          History: drag to look at earlier seasons (read-only)
        </label>
        <input
          id="history-scrubber"
          type="range"
          className="slider absolute top-1 right-0 left-0"
          min={0}
          max={Math.max(1, max)}
          step={1}
          value={value}
          disabled={max === 0}
          aria-valuetext={valueText}
          onChange={(e) => viewHistory(Number(e.target.value))}
        />
        <ul className="absolute right-0 bottom-0 left-0 h-6" aria-label="Your decisions">
          {markers.map((m) => (
            <li key={`d${m.step}`} className="absolute -translate-x-1/2" style={{ left: `${pos(m.viewAt)}%` }}>
              <Tip content={<DecisionTip label={m.label} past={m.viewAt < max} />} side="top" width="w-64">
                <button
                  type="button"
                  className={`flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/15 ${value === m.viewAt ? 'bg-white/15' : ''}`}
                  aria-label={m.label}
                  onClick={() => viewHistory(m.viewAt < max ? m.viewAt : null)}
                >
                  <span className="block h-3 w-[3px] rounded-sm bg-marigold" aria-hidden />
                </button>
              </Tip>
            </li>
          ))}
        </ul>
      </div>
      <PastAnnouncer />
    </div>
  )
}

/** What the marks on the history strip mean. */
function HistoryKey() {
  return (
    <span className="block space-y-1">
      <span className="block text-cream">Drag to look back at earlier seasons. The past is read-only.</span>
      <span className="flex items-center gap-1.5"><Sun size={11} className="text-warn" aria-hidden /> drought</span>
      <span className="flex items-center gap-1.5"><CloudRain size={11} className="text-river" aria-hidden /> heavy rain</span>
      <span className="flex items-center gap-1.5"><Sprout size={11} className="text-good" aria-hidden /> good season</span>
      <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-[3px] bg-marigold" aria-hidden /> your decisions</span>
    </span>
  )
}

/** Bottom right: how many goals are on track, the report once it exists, and Compare Futures. */
export function ScenarioBar() {
  const reportShown = useGame((s) => s.reportShown)
  const openReport = useGame((s) => s.openReport)
  return (
    <div className="panel pointer-events-auto flex h-12 max-w-full items-center gap-1 px-1.5" role="group" aria-label="Goals and scenarios">
      <GoalsChip />
      {reportShown && (
        <button type="button" className="btn btn-ghost !px-2" onClick={openReport} data-report-opener>
          <FileText size={16} aria-hidden /> Report
        </button>
      )}
      <span className="rail-sep mx-0.5 h-6 w-px" aria-hidden />
      <CompareControls />
    </div>
  )
}

function DecisionTip({ label, past }: { label: string; past: boolean }) {
  return (
    <span className="block">
      <span className="block text-cream">{label}</span>
      <span className="mt-1 block text-dim">{past ? 'Click to view the valley right after this season, with these changes in place.' : 'Made this season. Advance time to see what they do.'}</span>
    </span>
  )
}

/** Decisions made during the season that ended in snapshot `viewStep` (in place in that view). */
function decisionsShownAt(decisions: readonly DecisionRecord[] | undefined, viewStep: number): DecisionRecord[] {
  return viewStep > 0 ? (decisions ?? []).filter((d) => d.step === viewStep - 1) : []
}

/**
 * One short screen-reader line when the player enters or leaves the past. While scrubbing, the
 * scrubber's own value text says which season is shown, so this stays quiet in between.
 */
function PastAnnouncer() {
  const viewStep = useGame((s) => s.viewStep)
  const step = useGame((s) => s.sim?.step ?? 0)
  const decisions = useGame((s) => s.sim?.decisions)
  const prev = useRef<number | null>(viewStep)
  const [text, setText] = useState('')
  useEffect(() => {
    const was = prev.current
    prev.current = viewStep
    if (was === null && viewStep !== null) {
      const n = decisionsShownAt(decisions, viewStep).length
      const when = viewStep === 0 ? 'the valley at the start' : afterText(viewStep).toLowerCase()
      const made = viewStep === 0 ? '' : `, ${n === 0 ? 'no' : n} decision${n === 1 ? '' : 's'} from that season in place`
      setText(`Viewing the past: ${when}${made}. Read-only.`)
    } else if (was !== null && viewStep === null) {
      setText(`Back to now: ${seasonText(step).toLowerCase()}.`)
    }
  }, [viewStep, decisions, step])
  return (
    <p className="sr-only" role="status" data-testid="past-announcer">
      {text}
    </p>
  )
}

/** Read-only banner while looking at the past, with what was decided in the season shown. */
export function PastBanner() {
  const viewStep = useGame((s) => s.viewStep)
  const viewHistory = useGame((s) => s.viewHistory)
  const decisions = useGame((s) => s.sim?.decisions)
  const weather = useGame((s) => (s.viewStep !== null && s.sim ? weatherBefore(s.sim, s.viewStep) : null))
  const requestFocus = useGame((s) => s.requestFocus)
  const selectCell = useGame((s) => s.selectCell)
  const openPanel = useGame((s) => s.openPanel)
  if (viewStep === null) return null
  // the season that ended in this view: decisions made during it are in place here
  const made = decisionsShownAt(decisions, viewStep)
  // not a live region: it holds buttons and a list, and the scrubber already says the season
  return (
    <div role="region" aria-label="Viewing the past" className="panel pointer-events-auto max-w-[44rem] border-marigold/60 px-4 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="size-2 rounded-full bg-marigold" aria-hidden />
        <span className="min-w-0 flex-1">
          <strong>
            Viewing the past: {viewStep === 0 ? 'the valley at the start' : `${afterText(viewStep).toLowerCase()}`}
            {weather && weather !== 'normal' ? ` (${WEATHER_WORD[weather]})` : ''}.
          </strong>{' '}
          This is read-only. Past seasons cannot be changed, only revisited.
        </span>
        {viewStep > 0 && (
          <button type="button" className="btn !py-1 text-xs" onClick={() => openPanel('insights')}>
            Why? Insights for this season
          </button>
        )}
        <button type="button" className="btn btn-primary !py-1" onClick={() => viewHistory(null)}>
          Back to now
        </button>
      </div>
      {viewStep > 0 && (
        <div className="mt-1.5 border-t border-[var(--panel-line)] pt-1.5 text-xs">
          {made.length === 0 ? (
            <p className="text-muted">You made no changes during {seasonText(viewStep - 1).toLowerCase()}.</p>
          ) : (
            <>
              <p className="text-muted">Decided during {seasonText(viewStep - 1).toLowerCase()} (in place in this view):</p>
              <ul className="mt-0.5 space-y-0.5">
                {made.map((d, i) => {
                  const cell = firstCell(d)
                  return (
                    <li key={i} className="flex items-center gap-2">
                      <span className="flex-1 text-parchment">{describeRecord(d).replace(/^./, (c) => c.toUpperCase())}.</span>
                      {cell !== null && (
                        <button
                          type="button"
                          className="text-river hover:underline"
                          onClick={() => {
                            selectCell(cell)
                            requestFocus(cell)
                          }}
                        >
                          Show on map
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
