// A vs B over time: every line of every chart can be compared, one line at a time.
import { useState } from 'react'
import type { HistoryPoint } from '../../simulation/types'
import { LineChart, SERIES_COLORS } from '../charts/LineChart'
import { CHARTS, historyLabel, historyWeather, weatherBands, type ChartSpec } from '../charts/chartSpecs'
import { KindBadge } from '../panels/ChartsPanel'
import { useRoving } from '../common/useRoving'

interface Props {
  hA: readonly HistoryPoint[]
  hB: readonly HistoryPoint[]
  marker: number | null
}

function CompareChart({ spec, hA, hB, marker }: Props & { spec: ChartSpec }) {
  const [lineId, setLineId] = useState(spec.lines[0].id)
  const line = spec.lines.find((l) => l.id === lineId) ?? spec.lines[0]
  const multi = spec.lines.length > 1
  const lineItem = useRoving(
    spec.lines.map((l) => l.id),
    line.id,
    setLineId,
  )
  return (
    <div>
      {multi && (
        <div className="mb-1 flex flex-wrap gap-1" role="radiogroup" aria-label={`${spec.title}: which line to compare`}>
          {spec.lines.map((l) => (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={l.id === line.id}
              {...lineItem(l.id)}
              className={`chip !py-0 text-[0.68rem] ${l.id === line.id ? '!bg-marigold !text-ink' : 'hover:bg-white/15'}`}
              onClick={() => setLineId(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}
      <LineChart
        title={multi ? `${spec.title}: ${line.label.toLowerCase()}` : spec.title}
        badge={<KindBadge kind={spec.kind} />}
        series={[
          { id: 'A', label: 'A', values: hA.map(line.get), color: SERIES_COLORS[0] },
          { id: 'B', label: 'B', values: hB.map(line.get), color: SERIES_COLORS[1], dash: '5 3' },
        ]}
        xLabel={historyLabel(hA)}
        weatherAt={historyWeather(hA)}
        format={spec.format}
        bands={weatherBands(hA)}
        yMin={spec.yMin}
        yMax={spec.yMax}
        height={120}
        marker={marker}
      />
    </div>
  )
}

export function CompareCharts({ hA, hB, marker }: Props) {
  return (
    <div className="grid gap-x-4 sm:grid-cols-2">
      {CHARTS.filter((c) => c.id !== 'rain').map((c) => (
        <CompareChart key={c.id} spec={c} hA={hA} hB={hB} marker={marker} />
      ))}
    </div>
  )
}
