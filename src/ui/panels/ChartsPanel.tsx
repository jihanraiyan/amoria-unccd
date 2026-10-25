import { useGame } from '../../state/store'
import { BAND_LETTER, LineChart, SERIES_COLORS, SERIES_DASHES } from '../charts/LineChart'
import { CHARTS, historyIndexForStep, historyLabel, historyWeather, weatherBands } from '../charts/chartSpecs'
import { Panel } from '../common/Panel'
import { Tip } from '../common/Tip'
import { KIND_LABEL, KIND_NOTE, type MetricKind } from '../metrics'

/** Chip naming what kind of number a chart shows, with the full note on hover, focus, click or tap. */
export function KindBadge({ kind }: { kind: MetricKind }) {
  return (
    <Tip content={<span>{KIND_NOTE[kind]}</span>} width="w-64" toggle>
      <button type="button" className="chip !py-0 text-[0.68rem] text-muted" aria-label={`${KIND_LABEL[kind]}: ${KIND_NOTE[kind]}`}>
        {KIND_LABEL[kind]}
      </button>
    </Tip>
  )
}

export function ChartsPanel() {
  const sim = useGame((s) => s.sim)
  const viewStep = useGame((s) => s.viewStep)
  const close = useGame((s) => s.openPanel)
  if (!sim) return null
  const h = sim.history
  const bands = weatherBands(h)
  const weatherAt = historyWeather(h)
  return (
    <Panel title="Trends" eyebrow="From your valley's history" onClose={() => close(null)} className="w-[24rem]">
      <p className="mb-3 text-xs leading-snug text-muted">
        Every line is recorded from the simulation after each season. Shaded columns mark weather, each with its own letter and pattern:
        <span className="mx-1 rounded bg-[rgb(244_174_63/0.25)] px-1">{BAND_LETTER.drought} drought (diagonal)</span>
        <span className="mr-1 rounded bg-[rgb(99_198_207/0.25)] px-1">{BAND_LETTER['heavy-rain']} heavy rain (vertical)</span>
        <span className="rounded bg-[rgb(163_201_143/0.2)] px-1">{BAND_LETTER.favorable} good season (dots)</span>. Each chart says what kind of number it shows; open its table
        for the values and the weather season by season.
      </p>
      {CHARTS.map((c) => (
        <div key={c.id}>
          <LineChart
            title={c.title}
            badge={<KindBadge kind={c.kind} />}
            series={c.lines.map((l, i) => ({
              id: l.id,
              label: l.label,
              values: h.map(l.get),
              color: SERIES_COLORS[i % SERIES_COLORS.length],
              dash: SERIES_DASHES[i % SERIES_DASHES.length],
            }))}
            xLabel={historyLabel(h)}
            weatherAt={weatherAt}
            format={c.format}
            bands={bands}
            yMin={c.yMin}
            yMax={c.yMax}
            marker={viewStep !== null ? historyIndexForStep(h, sim.step, viewStep) : null}
          />
          {c.note && h.length > 0 && <p className="-mt-2 mb-3 text-[0.68rem] text-dim">{c.note}</p>}
        </div>
      ))}
    </Panel>
  )
}
