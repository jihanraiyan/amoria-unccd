import { Droplet, Tractor, Building2, Waves } from 'lucide-react'
import type { HistoryPoint, StakeholderView } from '../../simulation/types'
import { useGame } from '../../state/store'
import { wellbeingWeights } from '../../state/simParams'
import { Meter, Panel, Section } from '../common/Panel'
import { MetricInfo } from '../common/InfoTip'
import { StatusMark } from '../common/StatusMark'
import { historyIndexForStep } from '../charts/chartSpecs'
import { earnedSoFar } from '../compare/diff'
import { PastNote } from './PastNote'
import { METRICS, band, fmtInt, fmtMoney, fmtPct, housingPerParcel, landValueOf, listOr } from '../metrics'

const PART_LABEL: Record<string, string> = {
  housing: 'Housing',
  food: 'Food',
  water: 'Water',
  livelihood: 'Livelihoods',
  safety: 'Safety from floods and drought',
}

const EARN_ROWS: { label: string; get(p: HistoryPoint): number }[] = [
  { label: 'Crop sales', get: (p) => Math.max(0, (p.farmValue ?? 0) - (p.treeProductValue ?? 0)) },
  { label: 'Tree products (agroforestry)', get: (p) => p.treeProductValue ?? 0 },
  { label: 'Grazing', get: (p) => p.grazingValue ?? 0 },
  { label: 'Forest products', get: (p) => p.forestProductValue ?? 0 },
]

const STAKEHOLDERS: { id: 'farmers' | 'townspeople' | 'downstream'; label: string; icon: typeof Tractor }[] = [
  { id: 'farmers', label: 'Farmers', icon: Tractor },
  { id: 'townspeople', label: 'Townspeople', icon: Building2 },
  { id: 'downstream', label: 'Downstream neighbours', icon: Waves },
]

function StakeholderCard({ label, icon: Icon, v }: { label: string; icon: typeof Tractor; v: StakeholderView }) {
  return (
    <li className="rounded-lg bg-black/20 p-2.5">
      <div className="mb-1 flex items-center gap-2">
        <Icon size={15} className="text-marigold" aria-hidden />
        <span className="text-sm font-semibold">{label}</span>
      </div>
      <dl className="grid grid-cols-3 gap-1 text-[0.7rem]">
        <div>
          <dt className="text-dim">Income</dt>
          <dd className="tabular font-semibold">{fmtMoney(v.income)}</dd>
        </div>
        <div>
          <dt className="text-dim">Water access</dt>
          <dd className="tabular font-semibold">{fmtPct(v.waterAccess)}</dd>
        </div>
        <div>
          <dt className="text-dim">Hazard</dt>
          <dd className={`tabular font-semibold ${v.hazardExposure > 0.4 ? 'text-bad' : ''}`}>
            {fmtPct(v.hazardExposure)}
            {v.hazardExposure > 0.4 && <StatusMark tone="bad" word="high" />}
          </dd>
        </div>
      </dl>
      {v.note && <p className="mt-1 text-[0.7rem] leading-snug text-muted">{v.note}</p>}
    </li>
  )
}

export function CommunityPanel() {
  const sim = useGame((s) => s.sim)
  const view = useGame((s) => s.viewSnapshot)
  const viewStep = useGame((s) => s.viewStep)
  const close = useGame((s) => s.openPanel)
  if (!sim) return null
  // while viewing the past, show the community as it was then, like the top bar does
  const c = view?.community ?? sim.community
  const past = view !== null && viewStep !== null
  const weights = wellbeingWeights()
  const parts = c.wellbeingParts as Record<string, number> | undefined
  const shownStep = viewStep !== null && view !== null ? viewStep : sim.step
  const pi = historyIndexForStep(sim.history, sim.step, shownStep)
  const point = shownStep > 0 && pi >= 0 ? sim.history[pi] : null
  const sofar = earnedSoFar(sim, shownStep)

  return (
    <Panel title="Community" eyebrow={past ? 'People of the valley (past)' : 'People of the valley'} onClose={() => close(null)} className="w-[22rem]">
      {past && <PastNote step={viewStep} />}
      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-black/20 p-2">
          <div className="eyebrow !text-[0.68rem]">People</div>
          <div className="tabular text-lg font-semibold">{fmtInt(c.population)}</div>
        </div>
        <div className="rounded-lg bg-black/20 p-2">
          <div className="eyebrow !text-[0.68rem]">Housing places</div>
          <div className="tabular text-lg font-semibold">{fmtInt(c.housingCapacity)}</div>
        </div>
        <div className="rounded-lg bg-black/20 p-2">
          <div className="eyebrow !text-[0.68rem]">Jobs</div>
          <div className="tabular text-lg font-semibold">{fmtInt(c.jobs)}</div>
        </div>
      </div>
      <p className="-mt-1 mb-3 text-[0.68rem] text-dim">
        Housing places count people, not buildings: on this map a housing parcel holds {listOr(housingPerParcel(sim))} people at density levels 1, 2 and 3.
      </p>
      {(c.births !== undefined || c.arrivals !== undefined) && (
        <p className="mb-3 text-xs text-muted">
          Last season: {fmtInt(c.births ?? 0)} births, {fmtInt(c.arrivals ?? 0)} arrived, {fmtInt(c.departures ?? 0)} left.
          {c.housingDemand !== undefined && c.housingDemand > c.population + 0.5 && (
            <> {fmtInt(c.housingDemand - c.population)} more people wanted to move here but found no home.</>
          )}
        </p>
      )}

      <Section title="Indicators">
        <Meter label="Housing adequacy" value={c.housingAdequacy} tone={band(c.housingAdequacy)} />
        <Meter label="Food security" value={c.foodSecurity} tone={band(c.foodSecurity)} />
        <Meter label="Water security" value={c.waterSecurity} tone={band(c.waterSecurity)} />
        <Meter label="Piped water safe to drink" value={c.waterQuality ?? 1} tone={band(c.waterQuality ?? 1)} />
        <Meter label="Livelihoods" value={c.livelihood} tone={band(c.livelihood)} />
        <Meter label="Exposure to floods and drought (lower is better)" value={c.hazardExposure} tone={c.hazardExposure > 0.4 ? 'bad' : c.hazardExposure > 0.15 ? 'warn' : 'good'} />
      </Section>

      {point && (
        <Section title="Household earnings" hint="What farm and herding families earned last season. This money goes to households, not the town fund.">
          <dl className="text-xs" data-testid="household-earnings">
            {EARN_ROWS.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between gap-3 border-t border-white/5 py-0.5 first:border-0">
                <dt className="text-muted">{r.label}</dt>
                <dd className="tabular font-semibold">{fmtMoney(r.get(point))}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-3 border-t border-white/10 py-0.5">
              <dt className="flex items-center gap-1 font-semibold">
                Earned from the land <MetricInfo def={METRICS.landEarnings} />
              </dt>
              <dd className="tabular font-semibold">{fmtMoney(landValueOf(point))}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-0.5">
              <dt className="flex items-center gap-1 text-muted">
                Spent on bought food <MetricInfo def={METRICS.foodBought} />
              </dt>
              <dd className="tabular font-semibold">{fmtMoney(point.foodImportCost ?? 0)}</dd>
            </div>
          </dl>
          <p className="mt-1 text-xs text-muted" data-testid="earned-so-far">
            Since the start: {fmtMoney(sofar.land)} earned from the land, {fmtMoney(sofar.trees)} of it from tree products, and {fmtMoney(sofar.bought)} spent on
            bought food.
          </p>
          <p className="mt-1 text-[0.7rem] text-dim">
            Crop and tree values are before the cooperative levy. Restoration such as agroforestry costs the town fund when you plant it and pays households once the trees mature, after 3 to 7 years. Livelihoods
            <MetricInfo def={METRICS.livelihood} /> turns these earnings and jobs into one index, so it moves less than the money does.
          </p>
        </Section>
      )}

      <Section title="How wellbeing is built" hint="Wellbeing is not a separate happiness score. It is a weighted blend of the parts below.">
        <div className="mb-2 flex items-baseline justify-between rounded-lg bg-black/20 p-2">
          <span className="flex items-center gap-1 text-xs text-muted">
            Wellbeing <MetricInfo def={METRICS.wellbeing} />
          </span>
          <span className="tabular text-xl font-semibold">{fmtPct(c.wellbeing)}</span>
        </div>
        {parts && weights ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-dim">
                <th scope="col" className="py-0.5 font-semibold">Part</th>
                <th scope="col" className="py-0.5 text-right font-semibold">Value</th>
                <th scope="col" className="py-0.5 text-right font-semibold">Weight</th>
                <th scope="col" className="py-0.5 text-right font-semibold">Adds</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(weights.value).map((k) => (
                <tr key={k} className="border-t border-white/5">
                  <th scope="row" className="py-1 text-left font-normal">{PART_LABEL[k] ?? k}</th>
                  <td className="tabular py-1 text-right">{fmtPct(parts[k] ?? 0)}</td>
                  <td className="tabular py-1 text-right text-muted">{fmtPct(weights.value[k])}</td>
                  <td className="tabular py-1 text-right font-semibold">{((parts[k] ?? 0) * weights.value[k] * 100).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-dim">The breakdown appears once the simulation reports its components.</p>
        )}
        {weights && <p className="mt-1.5 text-[0.68rem] text-dim">The weights are a design choice for this game, not a measured fact. {weights.note}</p>}
      </Section>

      <Section title="Who gains, who pays" hint="The same decision lands differently on different people.">
        <ul className="space-y-1.5">
          {STAKEHOLDERS.map((s) => (
            <StakeholderCard key={s.id} label={s.label} icon={s.icon} v={c.stakeholders[s.id]} />
          ))}
        </ul>
        <p className="mt-2 flex items-center gap-1 text-[0.68rem] text-dim">
          <Droplet size={11} aria-hidden /> Downstream neighbours live outside the map; they feel your runoff and sediment.
        </p>
      </Section>
    </Panel>
  )
}
