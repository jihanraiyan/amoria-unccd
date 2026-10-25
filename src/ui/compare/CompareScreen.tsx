// Compare Futures: two runs from identical starting conditions, side by side.
import { ArrowLeft, Check, CheckCircle2, Columns2, SlidersHorizontal, XCircle } from 'lucide-react'
import { Suspense, memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useGameExports, type GameExports, type OverlayLegendStop, type OverlayMeta } from '../../app/gameModules'
import { CanvasBoundary } from '../../app/ErrorBoundary'
import type { Snapshot } from '../../simulation/types'
import { useGame, type OverlayId, type RunData } from '../../state/store'
import { SERIES_COLORS } from '../charts/LineChart'
import { historyIndexForStep } from '../charts/chartSpecs'
import { OVERLAY_FALLBACK, displayUnit } from '../panels/OverlaysPanel'
import { WEATHER_WORD, afterText, weatherBefore } from '../timeline/history'
import { CompareCharts } from './CompareCharts'
import { CompareInsights } from './CompareInsights'
import { diffSummary, fairness, metricRows, pointAt } from './diff'
import { MiniMap } from './MiniMap'
import { LandCoverLegend } from '../map/LandCoverLegend'
import { useRoving } from '../common/useRoving'
import { WorldAttribution } from '../common/WorldAttribution'

export { afterText } from '../timeline/history'

type Mode = 'split' | 'slider'
const MODES: readonly Mode[] = ['split', 'slider']

/** Legend for the overlay on both landscapes, on the one shared scale. */
function CompareLegend({ meta, stops, flat }: { meta: OverlayMeta | undefined; stops: OverlayLegendStop[] | null; flat: boolean }) {
  if (flat) return <LandCoverLegend className="mt-2" />
  if (!meta || meta.id === 'none') return null
  return (
    <div className="mt-2 rounded-lg bg-black/20 p-2.5 text-xs">
      <p className="font-semibold">
        {meta.label}: one color scale for both landscapes, so the same color means the same value in A and B.
      </p>
      {stops && stops.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1" aria-label={`${meta.label} legend`}>
          {stops.map((l, i) => (
            <li key={`${l.label}-${i}`} className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-5 rounded-sm border border-white/20" style={{ background: l.color }} aria-hidden />
              <span>{displayUnit(l.label)}</span>
              {l.pattern && l.pattern !== 'plain' && <span className="text-dim">({l.pattern})</span>}
            </li>
          ))}
        </ul>
      )}
      {meta.cue?.description && (
        <p className="mt-1.5 leading-snug text-parchment">
          <strong>Without color: </strong>
          {meta.cue.description}
        </p>
      )}
    </div>
  )
}

function Better() {
  return (
    <>
      <Check size={12} className="ml-1 inline align-[-1px] text-good" aria-hidden />
      <span className="sr-only"> (better)</span>
    </>
  )
}

interface ViewProps {
  game: GameExports | null
  snapshot: Snapshot
  run: RunData
  overlay: OverlayId
  overlayDomain: [number, number] | null
  label: string
}

function View({ game, snapshot, run, overlay, overlayDomain, label }: ViewProps) {
  const terrain = run.state.terrain
  const fallback = <MiniMap snapshot={snapshot} terrain={terrain} label={label} />
  const SnapshotView = game?.SnapshotView
  if (!SnapshotView) return fallback
  const h = game.helpers
  // the exact snapshot index, so the season's weather and reservoir level are looked up directly
  const at = run.snapshots.indexOf(snapshot)
  const index = at >= 0 ? at : undefined
  return (
    <CanvasBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <SnapshotView
          snapshot={snapshot}
          terrain={terrain}
          overlay={overlay}
          overlayDomain={overlayDomain}
          weather={h?.weatherForSnapshot(run.state.weather, snapshot, index) ?? null}
          reservoirFill={h?.reservoirFillForSnapshot(run.state.history, snapshot, index) ?? null}
          syncGroup="compare"
          label={label}
        />
      </Suspense>
    </CanvasBoundary>
  )
}

function Fairness({ A, B }: { A: RunData; B: RunData }) {
  const f = fairness(A.state, B.state)
  const items = [
    { ok: f.sameWorld, text: 'Same map' },
    { ok: f.sameSeed, text: `Same seed (${A.state.seed})` },
    { ok: f.sameBudget, text: 'Same starting budget' },
    { ok: f.sameWeather, text: `Same weather (${f.weatherSeasonsChecked} seasons checked)` },
  ]
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Fair comparison checks">
      {items.map((i) => (
        <li key={i.text} className={`chip ${i.ok ? 'text-good' : 'text-bad'}`}>
          {i.ok ? <CheckCircle2 size={12} aria-hidden /> : <XCircle size={12} aria-hidden />}
          {i.text}
          <span className="sr-only">{i.ok ? 'confirmed' : 'not the same'}</span>
        </li>
      ))}
    </ul>
  )
}

/** The before/after view: owns the reveal position, so dragging it redraws only this part. */
const RevealView = memo(function RevealView({ game, snapA, snapB, A, B, overlay, domain }: {
  game: GameExports | null
  snapA: Snapshot
  snapB: Snapshot
  A: RunData
  B: RunData
  overlay: OverlayId
  domain: [number, number] | null
}) {
  const [reveal, setReveal] = useState(50)
  return (
    <div className="relative h-[52vh] min-h-64 overflow-hidden rounded-xl bg-black/30">
      <div className="absolute inset-0">
        <View game={game} snapshot={snapA} run={A} overlay={overlay} overlayDomain={domain} label="Scenario A" />
      </div>
      <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${reveal}%)` }}>
        <View game={game} snapshot={snapB} run={B} overlay={overlay} overlayDomain={domain} label="Scenario B" />
      </div>
      <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-cream/80" style={{ left: `${reveal}%` }} aria-hidden />
      <span className="chip absolute top-2 left-2 !bg-ink/80 !text-sm">A</span>
      <span className="chip absolute top-2 right-2 !bg-ink/80 !text-sm">B</span>
      <input
        type="range"
        className="slider absolute right-4 bottom-3 left-4 !w-auto"
        min={0}
        max={100}
        value={reveal}
        onChange={(e) => setReveal(Number(e.target.value))}
        aria-label="Slide to reveal Scenario A on the left and Scenario B on the right"
        aria-valuetext={`${reveal}% Scenario A on the left, ${100 - reveal}% Scenario B on the right`}
      />
    </div>
  )
})

/** Escape goes back to the valley, unless a control on the page used the key itself. */
function useEscapeBack(closeCompare: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const t = e.target
      if (t instanceof HTMLElement && (t.tagName === 'SELECT' || t.isContentEditable || t.tagName === 'TEXTAREA')) return
      e.preventDefault()
      closeCompare()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeCompare])
}

/** Puts focus on the screen's heading when it appears, so the player knows where they are. */
function useFocusOnShow(ref: RefObject<HTMLElement | null>, key: string) {
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [ref, key])
}

export function CompareScreen() {
  const compare = useGame((s) => s.compare)
  const closeCompare = useGame((s) => s.closeCompare)
  const progress = useGame((s) => s.loadProgress)
  const game = useGameExports()
  const heading = useRef<HTMLHeadingElement>(null)
  useEscapeBack(closeCompare)
  const phase = compare.loading ? 'loading' : compare.error || !compare.A || !compare.B ? 'error' : 'ready'
  useFocusOnShow(heading, phase)

  if (phase === 'loading') {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-3 bg-ink p-6 text-center">
        <h1 ref={heading} tabIndex={-1} className="text-xl outline-none">
          Rebuilding Scenario A from its saved decisions...
        </h1>
        <p className="tabular text-sm text-muted" role="status">
          {progress && progress.total > 0 ? `Season ${Math.min(progress.done, progress.total)} of ${progress.total}` : 'Starting the replay'}
        </p>
        <button type="button" className="btn" onClick={closeCompare}>
          <ArrowLeft size={16} aria-hidden /> Back to Scenario B
        </button>
      </main>
    )
  }
  if (phase === 'error' || !compare.A || !compare.B) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-3 bg-ink p-6 text-center">
        <h1 ref={heading} tabIndex={-1} className="text-xl outline-none">
          The comparison could not be prepared.
        </h1>
        <p className="text-sm text-muted">{compare.error ?? 'Save a Scenario A, play Scenario B, then compare.'}</p>
        <button type="button" className="btn btn-primary" onClick={closeCompare}>
          Back to the valley
        </button>
      </main>
    )
  }
  return <CompareReady A={compare.A} B={compare.B} step={compare.step} game={game} heading={heading} />
}

function CompareReady({ A, B, step, game, heading }: { A: RunData; B: RunData; step: number; game: GameExports | null; heading: RefObject<HTMLHeadingElement | null> }) {
  const closeCompare = useGame((s) => s.closeCompare)
  const setCompareStep = useGame((s) => s.setCompareStep)
  const [mode, setMode] = useState<Mode>('split')
  const modeItem = useRoving(MODES, mode, setMode)
  const [overlay, setOverlay] = useState<OverlayId>('none')
  const world = useGame((s) => s.world)
  const fair = fairness(A.state, B.state)
  const allFair = fair.sameWorld && fair.sameSeed && fair.sameBudget && fair.sameWeather

  const maxStep = Math.min(A.state.step, B.state.step)
  const snapA = A.snapshots[step] ?? A.snapshots[A.snapshots.length - 1]
  const snapB = B.snapshots[step] ?? B.snapshots[B.snapshots.length - 1]
  const rows = useMemo(() => {
    const pa = pointAt(A.state, step)
    const pb = pointAt(B.state, step)
    return pa && pb ? metricRows(pa, pb) : []
  }, [A, B, step])
  const summary = useMemo(() => diffSummary(A, B, step), [A, B, step])
  const when = afterText(step)
  const weatherShown = weatherBefore(A.state, step)
  const whenText = weatherShown && weatherShown !== 'normal' ? `${when} (${WEATHER_WORD[weatherShown]})` : when
  const { hA, hB } = useMemo(() => {
    const n = Math.min(A.state.history.length, B.state.history.length)
    return { hA: A.state.history.slice(0, n), hB: B.state.history.slice(0, n) }
  }, [A, B])
  const markerIdx = historyIndexForStep(hA, A.state.step, step)
  const SnapshotView = game?.SnapshotView ?? null
  const helpers = game?.helpers ?? null
  // one color scale for both landscapes so the same color means the same value
  const domain = useMemo(
    () => (overlay !== 'none' && helpers ? helpers.sharedOverlayDomain(overlay, [snapA, snapB], A.state.terrain) : null),
    [overlay, helpers, snapA, snapB, A],
  )
  const overlays = game?.overlays?.length ? game.overlays : OVERLAY_FALLBACK
  const overlayMeta = overlays.find((o) => o.id === overlay)
  const legendStops = useMemo(
    () => (overlay === 'none' ? null : domain && helpers?.resolveLegend ? helpers.resolveLegend(overlay, domain) : (overlayMeta?.legend ?? null)),
    [overlay, domain, helpers, overlayMeta],
  )

  return (
    <main className="scroll-soft h-full overflow-y-auto bg-[radial-gradient(ellipse_at_top,#2a2018,#17120d_60%)] p-4" aria-labelledby="compare-title">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <button type="button" className="btn" onClick={closeCompare} aria-keyshortcuts="Escape">
          <ArrowLeft size={16} aria-hidden /> Back to Scenario B
        </button>
        <div className="min-w-0 flex-1">
          <div className="eyebrow">Compare futures</div>
          <h1 ref={heading} tabIndex={-1} id="compare-title" className="text-2xl font-semibold outline-none">
            Two strategies, one valley
          </h1>
        </div>
        <Fairness A={A} B={B} />
      </header>

      <section className="panel mb-3 p-3" aria-label="Landscapes">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <div role="radiogroup" aria-label="View mode" className="flex rounded-[10px] border border-[var(--panel-line)] p-0.5">
            <button type="button" role="radio" aria-checked={mode === 'split'} {...modeItem('split')} className={`flex items-center gap-1 rounded-[8px] px-2.5 py-1 text-xs font-bold ${mode === 'split' ? 'bg-white/15 text-marigold' : 'text-muted'}`} onClick={() => setMode('split')}>
              <Columns2 size={14} aria-hidden /> Side by side
            </button>
            <button type="button" role="radio" aria-checked={mode === 'slider'} {...modeItem('slider')} className={`flex items-center gap-1 rounded-[8px] px-2.5 py-1 text-xs font-bold ${mode === 'slider' ? 'bg-white/15 text-marigold' : 'text-muted'}`} onClick={() => setMode('slider')}>
              <SlidersHorizontal size={14} aria-hidden /> Reveal slider (A | B)
            </button>
          </div>
          <label className={`flex items-center gap-2 text-xs ${SnapshotView ? '' : 'hidden'}`}>
            <span className="text-muted">Overlay</span>
            <select className="field !w-auto !py-1 text-xs" value={overlay} onChange={(e) => setOverlay(e.target.value as OverlayId)}>
              {overlays.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[16rem] flex-1 items-center gap-2 text-xs">
            <span className="whitespace-nowrap text-muted">{when}</span>
            <input
              type="range"
              className="slider"
              min={0}
              max={maxStep}
              value={step}
              onChange={(e) => setCompareStep(Number(e.target.value))}
              aria-label="Season shown in both landscapes"
              aria-valuetext={whenText}
            />
          </label>
        </div>
        {!SnapshotView && game && <p className="mb-2 text-xs text-dim">The 3D landscape view is not available here, so a flat land-cover map is shown instead.</p>}
        {mode === 'split' ? (
          <div className="grid h-[46vh] min-h-64 grid-cols-1 gap-2 md:grid-cols-2">
            {[
              { id: 'A', snap: snapA, run: A },
              { id: 'B', snap: snapB, run: B },
            ].map((v) => (
              <figure key={v.id} className="relative overflow-hidden rounded-xl bg-black/30">
                <View game={game} snapshot={v.snap} run={v.run} overlay={overlay} overlayDomain={domain} label={`Scenario ${v.id}`} />
                <figcaption className="chip absolute top-2 left-2 !bg-ink/80 !text-sm">Scenario {v.id}</figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <RevealView game={game} snapA={snapA} snapB={snapB} A={A} B={B} overlay={overlay} domain={domain} />
        )}
        <CompareLegend meta={overlayMeta} stops={legendStops} flat={!SnapshotView} />
      </section>

      <div className="grid gap-3 lg:grid-cols-[1fr_1.2fr]">
        <section className="panel p-4" aria-labelledby="cmp-metrics">
          <h2 id="cmp-metrics" className="mb-2 text-lg font-semibold">
            {when}
          </h2>
          {rows.length === 0 ? (
            <p className="text-sm text-dim">No recorded values for this season yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-dim">
                  <th scope="col" className="pb-1 font-semibold">Measure</th>
                  <th scope="col" className="pb-1 text-right font-semibold" style={{ color: SERIES_COLORS[0] }}>A</th>
                  <th scope="col" className="pb-1 text-right font-semibold" style={{ color: SERIES_COLORS[1] }}>B</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-white/5">
                    <th scope="row" className="py-1 text-left font-normal text-muted">{r.label}</th>
                    <td className={`tabular py-1 text-right ${r.better === 'A' ? 'font-bold text-cream' : ''}`}>
                      {r.aText}
                      {r.better === 'A' && <Better />}
                    </td>
                    <td className={`tabular py-1 text-right ${r.better === 'B' ? 'font-bold text-cream' : ''}`}>
                      {r.bText}
                      {r.better === 'B' && <Better />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h3 className="eyebrow mt-4 mb-1.5">What the numbers say</h3>
          <ul className="space-y-1.5 text-sm text-parchment">
            {summary.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {allFair ? (
            <p className="mt-3 text-xs text-dim" data-testid="fairness-note">
              Both runs faced exactly the same weather, so the differences come from the choices made. Model values are illustrative.
            </p>
          ) : (
            <p className="mt-3 text-xs font-semibold text-warn" role="note" data-testid="fairness-note">
              These runs did not start from the same conditions, so differences may not come from your choices alone. Model values are illustrative.
            </p>
          )}
        </section>

        <section className="panel p-4" aria-labelledby="cmp-charts">
          <h2 id="cmp-charts" className="mb-2 text-lg font-semibold">
            Over time
          </h2>
          <p className="mb-2 text-xs text-muted">Recorded after every season in both runs. Pick a line on charts that hold more than one.</p>
          <CompareCharts hA={hA} hB={hB} marker={markerIdx >= 0 ? markerIdx : null} />
        </section>
      </div>
      <CompareInsights A={A} B={B} step={step} />
      <WorldAttribution world={world && world.meta.id === A.state.meta.id ? world : null} worldId={world && world.meta.id === A.state.meta.id ? null : A.state.meta.id} className="mt-3" />
    </main>
  )
}
