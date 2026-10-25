import { ArrowDown, ArrowRight, ArrowUp, CheckCircle2, Circle, Home, NotebookPen } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { WorldMeta } from '../../simulation/types'
import { scenarioReport } from '../../state/objectives'
import { STORAGE_KEYS, readJson, writeItem } from '../../state/storage'
import { useGame } from '../../state/store'
import { useFocusTrap } from '../common/useFocusTrap'
import { fmtMoney } from '../metrics'
import { seasonText } from '../timeline/history'
import { useObjectives } from '../panels/ObjectivesPanel'
import { REFLECTION_PROMPTS, decisionCount, decisionSummary, describeDecision, outcomes, weatherFindings, worstDrought } from './analysis'

type Answers = Record<string, string>

function loadAnswers(key: string): Answers {
  const all = readJson(STORAGE_KEYS.reflections)
  if (!all || typeof all !== 'object') return {}
  const mine = (all as Record<string, unknown>)[key]
  if (!mine || typeof mine !== 'object') return {}
  return Object.fromEntries(Object.entries(mine as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Answers
}

function saveAnswers(key: string, answers: Answers): boolean {
  const all = readJson(STORAGE_KEYS.reflections)
  const base = all && typeof all === 'object' ? (all as Record<string, unknown>) : {}
  return writeItem(STORAGE_KEYS.reflections, JSON.stringify({ ...base, [key]: answers }))
}

/** How long typing pauses before notes are stored. */
const NOTES_SAVE_MS = 600

function Reflection({ runKey }: { runKey: string }) {
  const [answers, setAnswers] = useState<Answers>(() => loadAnswers(runKey))
  const [saved, setSaved] = useState<boolean | null>(null)
  const pending = useRef<Answers | null>(null)
  // Notes are stored as you type (after a short pause) and again when the report closes,
  // so closing with Escape or "Keep playing" never loses them.
  useEffect(() => {
    if (pending.current === null) return
    const t = setTimeout(() => {
      if (pending.current) setSaved(saveAnswers(runKey, pending.current))
      pending.current = null
    }, NOTES_SAVE_MS)
    return () => clearTimeout(t)
  }, [answers, runKey])
  useEffect(
    () => () => {
      if (pending.current) saveAnswers(runKey, pending.current)
    },
    [runKey],
  )
  return (
    <section aria-labelledby="reflect-h" className="rounded-xl bg-black/20 p-4">
      <h3 id="reflect-h" className="font-display flex items-center gap-2 text-lg font-semibold">
        <NotebookPen size={18} className="text-marigold" aria-hidden /> Think it over (optional)
      </h3>
      <p className="mt-1 text-xs text-dim">Your answers stay in this browser. Nobody else sees them and they are not scored.</p>
      <div className="mt-2 space-y-3">
        {REFLECTION_PROMPTS.map((p) => (
          <label key={p.id} className="block">
            <span className="text-sm font-semibold">{p.text}</span>
            <textarea
              className="field mt-1 min-h-16 resize-y text-sm"
              value={answers[p.id] ?? ''}
              onChange={(e) => {
                const next = { ...answers, [p.id]: e.target.value }
                pending.current = next
                setAnswers(next)
                setSaved(null)
              }}
            />
          </label>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          className="btn"
          onClick={() => {
            pending.current = null
            setSaved(saveAnswers(runKey, answers))
          }}
        >
          Keep my notes
        </button>
        {saved === null && <span className="text-xs text-dim">Notes are kept in this browser as you type.</span>}
        {saved === true && <span className="text-xs text-good">Saved in this browser.</span>}
        {saved === false && <span className="text-xs text-bad">This browser would not store them.</span>}
      </div>
    </section>
  )
}

/** Where the map comes from, said truthfully for the world being played. */
export function mapOrigin(meta: Pick<WorldMeta, 'kind' | 'name'>): string {
  if (meta.kind === 'procedural') return 'The valley is made up, but the choices are real ones that towns face everywhere.'
  return `The landscape is built from real map data for ${meta.name}, but the rain, soils, yields and prices are generic game values, the model is simplified and its numbers are illustrative, not a forecast for the people who live there. The choices are real ones that towns face everywhere.`
}

function BringItHome({ meta }: { meta: Pick<WorldMeta, 'kind' | 'name'> }) {
  return (
    <section aria-labelledby="home-h" className="rounded-xl bg-black/20 p-4">
      <h3 id="home-h" className="font-display flex items-center gap-2 text-lg font-semibold">
        <Home size={18} className="text-marigold" aria-hidden /> Bring it home
      </h3>
      <p className="mt-1 text-sm text-parchment">
        {mapOrigin(meta)} A few ways to take part where you live:
      </p>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-parchment">
        <li>Find out who decides about land in your area (a town council, planning office or district authority) and where they publish plans and proposals.</li>
        <li>Planning meetings are often open to the public, and many are recorded or streamed. Watch one and notice which tradeoffs come up.</li>
        <li>Ask questions about water, building and restoration: where does the water come from in a dry year, what happens to rain that runs off new roads and roofs, who benefits and who pays.</li>
        <li>When two proposals compete for the same land, compare them the way you compared futures here: same starting point, different choices, and outcomes for different groups of people.</li>
        <li>Join or start a local environmental project, such as tree planting, river clean-ups or school gardens, and keep track of what changes over time.</li>
      </ul>
    </section>
  )
}

/** Heading for the report: the guided horizon, or the real span once play went past it in sandbox. */
export function reportSpan(step: number, horizonYears: number, place = 'the valley'): { eyebrow: string; title: string } {
  const years = step / 2
  if (step <= horizonYears * 2) return { eyebrow: `Year ${horizonYears} report`, title: `${horizonYears} years in ${place}` }
  const shown = Number.isInteger(years) ? String(years) : years.toFixed(1)
  return { eyebrow: `Year 1 to year ${Math.ceil(years)} report (guided goal: year ${horizonYears}, then sandbox)`, title: `${shown} years in ${place}` }
}

export function EndReport() {
  const open = useGame((s) => s.reportOpen)
  const sim = useGame((s) => s.sim)
  const explanations = useGame((s) => s.explanations)
  const runLabel = useGame((s) => s.runLabel)
  const runId = useGame((s) => s.runId)
  const scenarios = useGame((s) => s.scenarios)
  const { closeReport, saveScenarioA, branchScenarioB, openCompare, openExplanation, openPanel } = useGame.getState()
  const traceMoment = (id: string) => {
    closeReport()
    openExplanation(id)
  }
  const objectives = useObjectives()
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, open && !!sim, '[data-report-opener]')
  if (!open || !sim) return null
  const outs = outcomes(sim)
  const decisions = decisionSummary(sim.decisions)
  const weather = weatherFindings(sim.history)
  const drought = worstDrought(sim)
  const simReport = scenarioReport(sim)
  const moments = simReport?.keyMoments.length ? simReport.keyMoments : explanations
  const serious = moments.filter((e) => e.severity === 'critical' || e.severity === 'warning' || (e.topic === 'event' && e.severity !== 'good')).slice(-6).reverse()
  const good = moments.filter((e) => e.severity === 'good').slice(-4).reverse()
  const cum = simReport?.cumulative ?? null
  // each run has its own notes: a reset or a replayed seed starts with empty answers
  const runKey = runId ?? `${sim.meta.id}:${sim.seed}:${runLabel ?? 'run'}`
  const span = reportSpan(sim.step, sim.horizonYears, sim.meta.kind === 'procedural' ? 'the valley' : sim.meta.name.split(',')[0])
  const totalSpent = decisions.reduce((s, d) => s + d.spent, 0)

  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-ink/70 p-4" role="presentation">
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        className="panel panel-strong anim-rise scroll-soft max-h-full w-full max-w-4xl overflow-y-auto p-6 outline-none"
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          // the report owns this Escape: it must not also close a panel or drop the tool
          e.stopPropagation()
          closeReport()
        }}
      >
        <div className="eyebrow">{span.eyebrow} · {sim.meta.name}</div>
        <h2 id="report-title" className="font-display text-3xl font-semibold">
          {span.title}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Here is what changed, using the numbers the simulation recorded every season. The model is simplified and its numbers are illustrative, so read this as a story about
          connections, not a forecast.
        </p>

        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <section aria-labelledby="out-h">
            <h3 id="out-h" className="eyebrow mb-2">Start to now</h3>
            <table className="w-full text-sm">
              <tbody>
                {outs.map((o) => (
                  <tr key={o.label} className="border-t border-white/5">
                    <th scope="row" className="py-1 text-left font-normal text-muted">{o.label}</th>
                    <td className="tabular py-1 text-right text-dim">{o.start}</td>
                    <td className="px-1 py-1 text-center" aria-label={o.direction === 'flat' ? 'about the same' : o.direction === 'up' ? 'rose to' : 'fell to'}>
                      {o.direction === 'up' ? (
                        <ArrowUp size={13} className={o.good === null ? 'text-muted' : o.good ? 'text-good' : 'text-bad'} aria-hidden />
                      ) : o.direction === 'down' ? (
                        <ArrowDown size={13} className={o.good === null ? 'text-muted' : o.good ? 'text-good' : 'text-bad'} aria-hidden />
                      ) : (
                        <ArrowRight size={13} className="text-dim" aria-hidden />
                      )}
                    </td>
                    <td className="tabular py-1 text-right font-semibold">{o.end}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section aria-labelledby="goal-h">
            <h3 id="goal-h" className="eyebrow mb-2">Goals</h3>
            {objectives?.error && (
              <p className="rounded-lg bg-black/20 p-3 text-xs text-warn" role="status">
                {objectives.error}
              </p>
            )}
            <ul className="space-y-1">
              {objectives?.items.map((o) => (
                <li key={o.id} className="flex items-start gap-2 text-sm">
                  {o.met ? <CheckCircle2 size={15} className="mt-0.5 text-good" aria-hidden /> : <Circle size={15} className="mt-0.5 text-dim" aria-hidden />}
                  <span>
                    <span className="font-semibold">{o.label}</span> <span className="sr-only">{o.met ? 'met' : 'not met'}</span>
                    <span className="block text-xs text-dim">{o.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {cum && (
          <section className="mt-5" aria-labelledby="sum-h">
            <h3 id="sum-h" className="eyebrow mb-2">Over the whole run</h3>
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              {[
                { k: 'Food grown', v: `${Math.round(cum.foodProducedT).toLocaleString('en-US')} t` },
                { k: 'Soil eroded (index)', v: Math.round(cum.erosionT).toLocaleString('en-US') },
                { k: 'Sediment sent downstream', v: Math.round(cum.outletSedimentT).toLocaleString('en-US') },
                { k: 'Home-seasons flooded', v: String(cum.floodedHomeSeasons) },
                { k: 'Seasons with unpaid bills', v: String(cum.shortageSeasons) },
                { k: 'Spent on your changes', v: fmtMoney(cum.spentOnActions) },
                { k: 'Earned from them once', v: fmtMoney(cum.revenueFromActions) },
                ...(simReport?.weather
                  ? [{ k: 'Droughts / heavy rains', v: `${simReport.weather.drought} / ${simReport.weather['heavy-rain']}` }]
                  : []),
              ].map(({ k, v }) => (
                <div key={k} className="rounded-lg bg-black/20 p-2">
                  <dt className="text-[0.68rem] text-dim">{k}</dt>
                  <dd className="tabular font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-1 text-[0.68rem] text-dim">Game units. Totals add up every season played.</p>
          </section>
        )}

        <section className="mt-5" aria-labelledby="why-h">
          <h3 id="why-h" className="eyebrow mb-2">What shaped these results</h3>
          <ul className="space-y-2 text-sm text-parchment">
            {weather.map((w) => (
              <li key={w}>{w}</li>
            ))}
            {drought && <li>{drought}</li>}
            {decisions.length > 0 ? (
              <li>
                You made {decisionCount(sim.decisions.length)} and spent {fmtMoney(totalSpent)} on them up front. The biggest:{' '}
                {decisions
                  .slice(0, 4)
                  .map((d) => `${describeDecision(d)} (${fmtMoney(d.spent)})`)
                  .join('; ')}
                .
              </li>
            ) : (
              <li>You did not change the land, so this is what the valley does on its own with this weather.</li>
            )}
          </ul>
          {(serious.length > 0 || good.length > 0) && (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {serious.length > 0 && (
                <div>
                  <h4 className="mb-1 text-xs font-bold text-warn">Hard moments the model flagged</h4>
                  <ul className="space-y-1 text-xs text-muted">
                    {serious.map((e) => (
                      <li key={`${e.id}-${e.year}-${e.season}`}>
                        <button type="button" className="text-left hover:text-cream hover:underline" onClick={() => traceMoment(e.id)}>
                          <span className="text-cream">Year {e.year}:</span> {e.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {good.length > 0 && (
                <div>
                  <h4 className="mb-1 text-xs font-bold text-good">Things that went well</h4>
                  <ul className="space-y-1 text-xs text-muted">
                    {good.map((e) => (
                      <li key={`${e.id}-${e.year}-${e.season}`}>
                        <button type="button" className="text-left hover:text-cream hover:underline" onClick={() => traceMoment(e.id)}>
                          <span className="text-cream">Year {e.year}:</span> {e.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>Pick any of these, or open Insights, to trace it back to the season and the values that caused it.</span>
            <button
              type="button"
              className="btn !px-2 !py-1 text-xs"
              onClick={() => {
                closeReport()
                openPanel('insights')
              }}
            >
              Open Insights
            </button>
          </p>
        </section>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Reflection key={runKey} runKey={runKey} />
          <BringItHome meta={sim.meta} />
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {runLabel === 'B' && scenarios.A ? (
            <button type="button" className="btn" onClick={() => void openCompare().then((ok) => ok && closeReport())}>
              Compare with Scenario A
            </button>
          ) : runLabel === null && scenarios.A ? (
            <>
              <p className="basis-full text-right text-xs text-dim">
                A Scenario A from an earlier run is saved (at {seasonText(scenarios.A.endStep).toLowerCase()}). You can play Scenario B against it, or replace it with this run.
              </p>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  closeReport()
                  void branchScenarioB()
                }}
              >
                Play Scenario B from saved A
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (saveScenarioA()) {
                    closeReport()
                    void branchScenarioB()
                  }
                }}
              >
                Replace A with this run, then try another
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (saveScenarioA()) {
                  closeReport()
                  void branchScenarioB()
                }
              }}
            >
              Try another strategy from the same start
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={closeReport}>
            Keep playing in sandbox
          </button>
        </div>
      </div>
    </div>
  )
}
