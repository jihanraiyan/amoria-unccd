import { HandCoins, Landmark } from 'lucide-react'
import { useState } from 'react'
import { useGame } from '../../state/store'
import { loanInterestPerSeason } from '../../state/simParams'
import { LineChart, SERIES_COLORS, SERIES_DASHES } from '../charts/LineChart'
import { historyLabel, weatherBands } from '../charts/chartSpecs'
import { MetricInfo } from '../common/InfoTip'
import { StatusMark } from '../common/StatusMark'
import { Panel, Section } from '../common/Panel'
import { METRICS, fmtMoney } from '../metrics'
import { PastNote } from './PastNote'

/** "farmSales" / "farm-sales" / "farm_sales" -> "Farm sales". */
export function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function Breakdown({ title, items, tone }: { title: string; items: Record<string, number>; tone: 'good' | 'bad' }) {
  const rows = Object.entries(items)
    .filter(([, v]) => Number.isFinite(v) && Math.abs(v) >= 0.5)
    .sort((a, b) => b[1] - a[1])
  const total = rows.reduce((s, [, v]) => s + v, 0)
  const max = Math.max(1, ...rows.map(([, v]) => Math.abs(v)))
  return (
    <Section title={`${title}: ${fmtMoney(total)}`}>
      {rows.length === 0 ? (
        <p className="text-xs text-dim">Nothing yet. Advance a season to see the breakdown.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map(([k, v]) => (
            <li key={k} className="text-xs">
              <div className="flex justify-between">
                <span className="text-muted">{humanize(k)}</span>
                <span className="tabular font-semibold">{fmtMoney(v)}</span>
              </div>
              <div className="mt-0.5 h-1 rounded-full bg-white/5">
                <div className={`h-full rounded-full ${tone === 'good' ? 'bg-good' : 'bg-bad'}`} style={{ width: `${(Math.abs(v) / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

const PRESETS = [50_000, 100_000, 250_000]

export function BudgetPanel() {
  const sim = useGame((s) => s.sim)
  const log = useGame((s) => s.log)
  const viewStep = useGame((s) => s.viewStep)
  const view = useGame((s) => s.viewSnapshot)
  const dispatch = useGame((s) => s.dispatch)
  const close = useGame((s) => s.openPanel)
  const [amount, setAmount] = useState(100_000)
  if (!sim) return null
  // while viewing the past, show the finances as they were then, like the top bar does
  const e = view?.economy ?? sim.economy
  const interest = loanInterestPerSeason()
  const spentThisSeason = sim.decisions.filter((d) => d.step === sim.step).reduce((s, d) => s + d.cost, 0)
  const actionsThisSeason = log.filter((l) => l.step === sim.step).length
  const validAmount = Number.isFinite(amount) && amount > 0
  const past = viewStep !== null
  const h = sim.history

  return (
    <Panel title="Budget and economy" eyebrow={past ? 'Public finances (past)' : 'Public finances'} onClose={() => close(null)} className="w-[22rem]">
      {past && viewStep !== null && <PastNote step={viewStep} what="Loans are off while you look back." />}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-black/20 p-2.5">
          <div className="eyebrow flex items-center gap-1">
            Budget <MetricInfo def={METRICS.budget} />
          </div>
          <div className={`tabular text-2xl font-semibold ${e.budget < 0 ? 'text-bad' : ''}`}>
            {fmtMoney(e.budget)}
            {e.budget < 0 && <StatusMark tone="bad" word="overdrawn" />}
          </div>
          {e.budget <= 0 && <div className="text-xs text-cream">{e.budget < 0 ? 'Overdrawn' : 'Empty'}</div>}
        </div>
        <div className="rounded-lg bg-black/20 p-2.5">
          <div className="eyebrow flex items-center gap-1">
            Debt <MetricInfo def={METRICS.debt} />
          </div>
          <div className={`tabular text-2xl font-semibold ${e.debt > 0 ? 'text-warn' : ''}`}>
            {fmtMoney(e.debt)}
            {e.debt > 0 && <StatusMark tone="warn" word="owed" />}
          </div>
          {e.debt > 0 && <div className="text-xs text-cream">Owed, charging interest</div>}
        </div>
      </div>
      {!past && actionsThisSeason > 0 && (
        <p className="mb-3 rounded-lg bg-marigold/10 p-2 text-xs">
          This season you made {actionsThisSeason} change{actionsThisSeason === 1 ? '' : 's'} costing {fmtMoney(spentThisSeason)} up front. Any upkeep is charged as seasons pass.
        </p>
      )}
      {e.serviceLevel !== undefined && e.serviceLevel < 0.999 && (
        <p className="mb-3 rounded-lg bg-bad/15 p-2 text-xs text-cream">
          <strong className="text-bad">Shortfall: </strong>
          the valley could only pay {Math.round(e.serviceLevel * 100)}% of last season's bills ({fmtMoney(e.unpaid)} unpaid). Unpaid bills are added to your debt and charge interest. Next season, waterworks and farm programs run at that level.
        </p>
      )}

      <Breakdown title="Income last season" items={e.income} tone="good" />
      <Breakdown title="Expenses last season" items={e.expenses} tone="bad" />

      <Section
        title="Loans"
        hint={
          interest
            ? `Interest is ${(interest.value * 100).toFixed(1)}% of debt per season (about ${((Math.pow(1 + interest.value, 2) - 1) * 100).toFixed(1)}% a year). ${interest.note}`
            : 'Interest is charged on debt every season.'
        }
      >
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button key={p} type="button" className={`btn !px-2 !py-1 text-xs ${amount === p ? 'btn-primary' : ''}`} onClick={() => setAmount(p)}>
              {fmtMoney(p)}
            </button>
          ))}
        </div>
        <label className="mt-2 block text-xs">
          <span className="text-muted">Amount</span>
          <input
            type="number"
            min={1000}
            step={1000}
            className="field tabular mt-1"
            value={Number.isFinite(amount) ? amount : ''}
            onChange={(ev) => setAmount(Number(ev.target.value))}
          />
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" className="btn" disabled={!validAmount || past} onClick={() => dispatch({ type: 'loan', amount })}>
            <Landmark size={15} aria-hidden /> Borrow
          </button>
          <button type="button" className="btn" disabled={!validAmount || past || e.debt <= 0} onClick={() => dispatch({ type: 'repay', amount: Math.min(amount, e.debt) })}>
            <HandCoins size={15} aria-hidden /> Repay
          </button>
        </div>
        <p className="mt-2 text-[0.68rem] leading-snug text-dim">
          Borrowing lets you invest now, for example in restoration that pays back slowly. Interest keeps costing money until the debt is repaid.
        </p>
      </Section>

      <LineChart
        title="Budget and debt over time"
        series={[
          { id: 'b', label: 'Budget', values: h.map((p) => p.budget), color: SERIES_COLORS[0], dash: SERIES_DASHES[0] },
          { id: 'd', label: 'Debt', values: h.map((p) => p.debt), color: SERIES_COLORS[3], dash: SERIES_DASHES[1] },
        ]}
        xLabel={historyLabel(h)}
        format={fmtMoney}
        bands={weatherBands(h)}
      />
    </Panel>
  )
}
