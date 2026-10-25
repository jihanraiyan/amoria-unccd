// Hand-rolled SVG line chart. Draws only the values it is given (real simulation history),
// with weather bands, hover/keyboard readout and an optional data table.
import { useId, useMemo, useState, type ReactNode } from 'react'

export interface Series {
  id: string
  label: string
  values: number[]
  color: string
  /** Dash pattern so series are distinguishable without color. */
  dash?: string
}

export interface Band {
  /** Index range [start, end] in the values arrays. */
  start: number
  end: number
  kind: 'drought' | 'heavy-rain' | 'favorable'
}

interface LineChartProps {
  title: string
  series: Series[]
  /** Label for x index k (e.g. "Y3 dry"). */
  xLabel(k: number): string
  format(v: number): string
  bands?: Band[]
  height?: number
  yMin?: number
  yMax?: number
  /** Index highlighted by a vertical rule (e.g. the season shown in compare views). */
  marker?: number | null
  emptyText?: string
  /** Weather of season k in words, for the data table (null for the start). */
  weatherAt?(k: number): string | null
  /** Shown next to the title, e.g. what kind of number this is. */
  badge?: ReactNode
}

const W = 320
const PAD = { l: 38, r: 8, t: 8, b: 18 }

const BAND_FILL: Record<Band['kind'], string> = {
  drought: 'rgb(244 174 63 / 0.16)',
  'heavy-rain': 'rgb(99 198 207 / 0.18)',
  favorable: 'rgb(163 201 143 / 0.12)',
}

const BAND_INK: Record<Band['kind'], string> = {
  drought: 'rgb(244 174 63 / 0.55)',
  'heavy-rain': 'rgb(99 198 207 / 0.6)',
  favorable: 'rgb(163 201 143 / 0.5)',
}

/** One-letter marks printed at the top of each band so weather reads without color. */
export const BAND_LETTER: Record<Band['kind'], string> = { drought: 'D', 'heavy-rain': 'R', favorable: 'G' }

/** Pattern drawn inside each band: diagonal hatching for drought, vertical rain lines, dots for good seasons. */
function BandPattern({ id, kind }: { id: string; kind: Band['kind'] }) {
  const ink = BAND_INK[kind]
  return (
    <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse">
      <rect width="6" height="6" fill={BAND_FILL[kind]} />
      {kind === 'drought' && <path d="M0 6 L6 0" stroke={ink} strokeWidth="0.8" />}
      {kind === 'heavy-rain' && <path d="M3 0 L3 6" stroke={ink} strokeWidth="0.8" />}
      {kind === 'favorable' && <circle cx="3" cy="3" r="0.9" fill={ink} />}
    </pattern>
  )
}

export const SERIES_COLORS = ['#f4ae3f', '#63c6cf', '#a3c98f', '#e2734d', '#c9a0dc', '#efe1c5']
export const SERIES_DASHES = ['', '5 3', '2 3', '8 3 2 3']

function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (max - min < 1e-9) return [min]
  const raw = (max - min) / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(Number(v.toFixed(10)))
  return out
}

export function LineChart({ title, series, xLabel, format, bands = [], height = 150, yMin, yMax, marker = null, emptyText, weatherAt, badge }: LineChartProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const [cursor, setCursor] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const n = Math.max(0, ...series.map((s) => s.values.length))

  const { lo, hi } = useMemo(() => {
    const all = series.flatMap((s) => s.values).filter(Number.isFinite)
    let lo = yMin ?? (all.length ? Math.min(...all) : 0)
    let hi = yMax ?? (all.length ? Math.max(...all) : 1)
    if (yMin === undefined && lo > 0 && lo < hi * 0.35) lo = 0
    if (hi - lo < 1e-9) {
      hi = lo + (Math.abs(lo) > 0 ? Math.abs(lo) * 0.1 : 1)
      if (yMin === undefined) lo = lo - (hi - lo)
    }
    return { lo, hi }
  }, [series, yMin, yMax])

  if (n === 0) {
    return (
      <figure className="mb-3">
        <figcaption className="mb-1 text-xs font-semibold">
          {title} {badge}
        </figcaption>
        <p className="rounded-lg bg-black/20 p-3 text-xs text-dim">{emptyText ?? 'Advance time to start recording this.'}</p>
      </figure>
    )
  }

  const H = height
  const iw = W - PAD.l - PAD.r
  const ih = H - PAD.t - PAD.b
  const x = (k: number) => PAD.l + (n <= 1 ? iw / 2 : (k / (n - 1)) * iw)
  const y = (v: number) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih
  const ticks = niceTicks(lo, hi)
  const path = (vals: number[]) =>
    vals
      .map((v, k) => (Number.isFinite(v) ? `${k === 0 || !Number.isFinite(vals[k - 1]) ? 'M' : 'L'}${x(k).toFixed(1)},${y(v).toFixed(1)}` : ''))
      .join('')
  const latest = series.map((s) => `${s.label} ${format(s.values[s.values.length - 1])}`).join(', ')
  const at = cursor ?? null

  const onMove = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * W
    const k = Math.round(((px - PAD.l) / iw) * (n - 1))
    setCursor(Math.max(0, Math.min(n - 1, k)))
  }

  return (
    <figure className="mb-3">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <figcaption id={`${id}-t`} className="text-xs font-semibold">
            {title}
          </figcaption>
          {badge}
        </div>
        <button type="button" className="text-[0.68rem] text-river hover:underline" onClick={() => setTable((t) => !t)}
          aria-expanded={table}
          aria-controls={`${id}-table`}
          aria-label={`${table ? 'Hide' : 'Show'} data table for ${title}`}
        >
          {table ? 'Hide table' : 'Table'}
        </button>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[0.68rem]">
        {series.map((s) => (
          <span key={s.id} className="flex items-center gap-1">
            <svg width="16" height="6" aria-hidden>
              <line x1="0" y1="3" x2="16" y2="3" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} />
            </svg>
            <span className="text-muted">{s.label}</span>
            {at !== null && <span className="tabular font-semibold">{format(s.values[at])}</span>}
          </span>
        ))}
        {at !== null && <span className="tabular ml-auto text-dim">{xLabel(at)}</span>}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-1 w-full touch-none rounded-lg bg-black/20 outline-none focus-visible:ring-2 focus-visible:ring-marigold"
        role="img"
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-d`}
        tabIndex={0}
        onPointerMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setCursor(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setCursor((c) => Math.max(0, (c ?? n - 1) - 1))
          else if (e.key === 'ArrowRight') setCursor((c) => Math.min(n - 1, (c ?? -1) + 1))
          else return
          e.preventDefault()
        }}
        onBlur={() => setCursor(null)}
      >
        <desc id={`${id}-d`}>
          {n} seasons recorded. Latest: {latest}.
          {at !== null ? ` At ${xLabel(at)}: ${series.map((s) => `${s.label} ${format(s.values[at])}`).join(', ')}.` : ''}
        </desc>
        <defs>
          {(['drought', 'heavy-rain', 'favorable'] as const).map((k) => (
            <BandPattern key={k} id={`${id}-${k}`} kind={k} />
          ))}
        </defs>
        {bands.map((b, i) => {
          const bx = x(b.start) - (n > 1 ? iw / (n - 1) / 2 : 4)
          const bw = Math.max(3, x(b.end) - x(b.start) + (n > 1 ? iw / (n - 1) : 8))
          return (
            <g key={i}>
              <rect x={bx} width={bw} y={PAD.t} height={ih} fill={`url(#${id}-${b.kind})`} />
              <text x={bx + bw / 2} y={PAD.t + 7} fontSize="7" fontWeight="700" textAnchor="middle" fill={BAND_INK[b.kind]}>
                {BAND_LETTER[b.kind]}
              </text>
            </g>
          )
        })}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="rgb(247 238 220 / 0.08)" />
            <text x={PAD.l - 4} y={y(t) + 3} textAnchor="end" fontSize="9" className="fill-dim">
              {format(t)}
            </text>
          </g>
        ))}
        <text x={PAD.l} y={H - 4} fontSize="9" className="fill-dim">
          {xLabel(0)}
        </text>
        <text x={W - PAD.r} y={H - 4} fontSize="9" className="fill-dim" textAnchor="end">
          {xLabel(n - 1)}
        </text>
        {series.map((s) => (
          <path key={s.id} d={path(s.values)} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {n === 1 &&
          series.map((s) => <circle key={`${s.id}-pt`} cx={x(0)} cy={y(s.values[0])} r="3" fill={s.color} />)}
        {marker !== null && marker >= 0 && marker < n && (
          <line x1={x(marker)} x2={x(marker)} y1={PAD.t} y2={PAD.t + ih} stroke="#f7eedc" strokeWidth="1.5" strokeDasharray="3 2" />
        )}
        {at !== null && (
          <g>
            <line x1={x(at)} x2={x(at)} y1={PAD.t} y2={PAD.t + ih} stroke="rgb(247 238 220 / 0.5)" />
            {series.map((s) =>
              Number.isFinite(s.values[at]) ? <circle key={s.id} cx={x(at)} cy={y(s.values[at])} r="3" fill={s.color} stroke="#17120d" /> : null,
            )}
          </g>
        )}
      </svg>
      {table && (
        <div id={`${id}-table`} className="scroll-soft mt-1 max-h-40 overflow-auto rounded-lg bg-black/20">
          <table className="w-full text-[0.68rem]">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="text-left text-dim">
                <th scope="col" className="px-2 py-1">Season</th>
                {weatherAt && (
                  <th scope="col" className="px-2 py-1">
                    Weather
                  </th>
                )}
                {series.map((s) => (
                  <th key={s.id} scope="col" className="px-2 py-1 text-right">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: n }, (_, k) => (
                <tr key={k} className="border-t border-white/5">
                  <th scope="row" className="px-2 py-0.5 text-left font-normal text-muted">
                    {xLabel(k)}
                  </th>
                  {weatherAt && <td className="px-2 py-0.5 text-muted">{weatherAt(k) ?? ''}</td>}
                  {series.map((s) => (
                    <td key={s.id} className="tabular px-2 py-0.5 text-right">
                      {format(s.values[k])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  )
}
