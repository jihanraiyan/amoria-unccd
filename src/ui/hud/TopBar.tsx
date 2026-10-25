// Top islands: the game menu (left), the date and time controls (centre) and the headline
// indicators (right), each indicator with a full explanation on hover or focus.
import {
  ChevronsRight,
  Coins,
  Droplet,
  HeartPulse,
  House,
  LogOut,
  Pause,
  Play,
  Redo2,
  Save,
  SkipForward,
  Sprout,
  Undo2,
  Utensils,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { SPEED_MS, speedLabel, useGame, type Speed } from '../../state/store'
import { MetricHelp } from '../common/MetricHelp'
import { Tip } from '../common/Tip'
import { useRoving } from '../common/useRoving'
import { modKey } from '../common/platform'
import { MetricInfo } from '../common/InfoTip'
import { StatusMark } from '../common/StatusMark'
import { METRICS, band, fmtInt, fmtMoney, housingPerParcel, listOr, seasonLabel, type MetricDef, type MetricId } from '../metrics'

interface Values {
  budget: number
  debt: number
  population: number
  capacity: number
  housing: number
  food: number
  water: number
  land: number
  wellbeing: number
}

function useValues(): { now: Values | null; prev: Values | null } {
  const sim = useGame((s) => s.sim)
  const view = useGame((s) => s.viewSnapshot)
  const viewStep = useGame((s) => s.viewStep)
  const snapshots = useGame((s) => s.snapshots)
  if (!sim) return { now: null, prev: null }
  const src = view ?? sim
  const toValues = (x: typeof src): Values => ({
    budget: x.economy.budget,
    debt: x.economy.debt,
    population: x.community.population,
    capacity: x.community.housingCapacity,
    housing: x.community.housingAdequacy,
    food: x.community.foodSecurity,
    water: x.community.waterSecurity,
    land: x.totals.meanSoilHealth,
    wellbeing: x.community.wellbeing,
  })
  const idx = viewStep ?? sim.step
  const prevSnap = idx > 0 ? snapshots[idx - 1] : undefined
  return { now: toValues(src), prev: prevSnap ? toValues(prevSnap) : null }
}

/** Unit after a percentage change: "5 pts", read out as "5 percentage points". */
const PCT_POINTS = { short: 'pts', spoken: 'percentage points' }

interface DeltaProps {
  now: number
  prev: number | null
  def: MetricDef
  format(v: number): string
  unit?: { short: string; spoken: string }
}

function Delta({ now, prev, def, format, unit }: DeltaProps) {
  if (prev === null || !Number.isFinite(prev)) return null
  const d = now - prev
  const tiny = def.format === fmtMoney ? Math.abs(d) < 1 : Math.abs(d) < 0.005 * Math.max(1, Math.abs(prev))
  if (tiny) return null
  const up = d > 0
  const good = def.better === 'neutral' ? null : (def.better === 'up') === up
  const cls = good === null ? 'text-muted' : good ? 'text-good' : 'text-bad'
  return (
    <span className={`tabular text-[0.7rem] font-semibold ${cls}`}>
      {up ? '+' : '\u2212'}
      {format(Math.abs(d))}
      {unit && (
        <>
          <span aria-hidden> {unit.short}</span>
          <span className="sr-only"> {unit.spoken}</span>
        </>
      )}
      <span className="sr-only"> {up ? 'up' : 'down'} since last season</span>
    </span>
  )
}

interface ChipProps {
  id: MetricId
  icon: LucideIcon
  value: string
  status?: 'good' | 'warn' | 'bad'
  sub?: string
  onClick(): void
  delta?: ReactNode
  extraHelp?: ReactNode
}

function MetricChip({ id, icon: Icon, value, status, sub, onClick, delta, extraHelp }: ChipProps) {
  const def = METRICS[id]
  const statusCls = status === 'good' ? 'text-good' : status === 'warn' ? 'text-warn' : status === 'bad' ? 'text-bad' : 'text-cream'
  const statusWord = status === 'good' ? 'healthy' : status === 'warn' ? 'under strain' : status === 'bad' ? 'critical' : ''
  const help = (
    <>
      <span className="mb-1 block text-sm font-semibold text-cream">
        {def.label}: {value}
        {sub && <span className="font-normal text-muted">, {sub}</span>}
      </span>
      <MetricHelp def={def} />
      {extraHelp}
    </>
  )
  return (
    <span className="flex shrink-0 items-center">
      <Tip content={help}>
        <button
          type="button"
          onClick={onClick}
          className="flex h-9 items-center gap-1.5 rounded-xl px-2 transition-colors hover:bg-white/8"
          aria-label={`${def.label}: ${value}${sub ? `, ${sub}` : ''}${statusWord ? `, ${statusWord}` : ''}`}
        >
          <Icon size={16} className={status && status !== 'good' ? statusCls : 'text-muted'} aria-hidden />
          <span className={`tabular text-sm font-semibold ${statusCls}`}>
            {value}
            {status && status !== 'good' && <StatusMark tone={status} />}
          </span>
          {delta}
          {status === 'bad' && <span className="sr-only">Warning</span>}
        </button>
      </Tip>
      {/* tap target for touch screens, where hover and focus tooltips never open */}
      <MetricInfo def={def} extra={extraHelp} className="-ml-1 [@media(hover:hover)]:hidden" />
    </span>
  )
}

const SPEEDS: Speed[] = [1, 2, 3]

function IconButton({ label, tip, onClick, disabled, children }: { label: string; tip: ReactNode; onClick(): void; disabled?: boolean; children: ReactNode }) {
  return (
    <Tip content={tip} width="w-auto whitespace-nowrap">
      <button type="button" className="rail-btn !h-9 !w-9" aria-label={label} onClick={onClick} disabled={disabled}>
        {children}
      </button>
    </Tip>
  )
}

/** Top left: leave, the name, undo and redo, save. */
export function GameMenu() {
  const saveGame = useGame((s) => s.saveGame)
  const exitToLanding = useGame((s) => s.exitToLanding)
  const hasSave = useGame((s) => s.hasSave)
  const lastSavedAt = useGame((s) => s.lastSavedAt)
  const autosaveFailed = useGame((s) => s.autosaveFailed)
  const undoCount = useGame((s) => s.undoStack.length)
  const redoCount = useGame((s) => s.redoStack.length)
  const step = useGame((s) => s.sim?.step ?? 0)
  const { undo, redo } = useGame.getState()
  const exitTip = autosaveFailed
    ? 'Back to the title screen. The last change could not be saved, so Amoria tries again first and tells you if this browser still will not store it.'
    : hasSave && lastSavedAt
      ? 'Back to the title screen (your game is saved in this browser)'
      : 'Back to the title screen. Amoria saves your game first and tells you if this browser will not store it.'
  return (
    <div className="panel pointer-events-auto flex h-12 shrink-0 items-center gap-0.5 px-1.5" role="toolbar" aria-label="Game">
      <Tip content={exitTip} width="w-56">
        <button type="button" className="rail-btn !h-9 !w-9" aria-label="Exit to title screen" onClick={exitToLanding}>
          <LogOut size={17} aria-hidden />
        </button>
      </Tip>
      <span className="rail-sep mx-1 h-6 w-px" aria-hidden />
      <span className="flex items-center gap-1.5 px-1.5 max-sm:hidden">
        <Sprout size={18} className="text-sage" aria-hidden />
        <span className="text-[0.95rem] font-semibold">Amoria</span>
      </span>
      <span className="rail-sep mx-1 h-6 w-px max-sm:hidden" aria-hidden />
      <IconButton label="Undo" tip={<span>Undo an edit made this season <span className="kbd ml-1">{modKey()} Z</span></span>} onClick={undo} disabled={undoCount === 0 && step === 0}>
        <Undo2 size={17} aria-hidden />
      </IconButton>
      <IconButton label="Redo" tip={<span>Redo <span className="kbd ml-1">{modKey()} Shift Z</span></span>} onClick={redo} disabled={redoCount === 0}>
        <Redo2 size={17} aria-hidden />
      </IconButton>
      <IconButton label="Save game" tip="Save to this browser" onClick={() => saveGame()}>
        <Save size={17} aria-hidden />
      </IconButton>
    </div>
  )
}

/** Top centre: the date, play and pause, speed, and stepping by a season or a year. */
export function TimeControls() {
  const sim = useGame((s) => s.sim)
  const viewStep = useGame((s) => s.viewStep)
  const snapshots = useGame((s) => s.snapshots)
  const runLabel = useGame((s) => s.runLabel)
  const playing = useGame((s) => s.playing)
  const speed = useGame((s) => s.speed)
  const { togglePlay, setSpeed, stepSeason, stepYear } = useGame.getState()
  const speedItem = useRoving(SPEEDS, speed, setSpeed)
  if (!sim) return null
  const shown = viewStep !== null ? snapshots[viewStep] : null
  const year = shown ? shown.year : sim.year
  const season = shown ? shown.season : sim.season
  return (
    <div className="panel pointer-events-auto flex h-12 shrink-0 items-center gap-1 px-1.5" role="group" aria-label="Time controls">
      <div className="flex min-w-0 flex-col px-2 leading-tight">
        <span className="text-sm font-semibold whitespace-nowrap">
          Year {year}
          {runLabel && <span className="ml-1.5 text-xs font-medium text-river max-[419px]:hidden">Scenario {runLabel}</span>}
        </span>
        <span className="text-xs whitespace-nowrap text-muted">
          {seasonLabel(season)}
          {viewStep !== null && <span className="ml-1 font-semibold text-marigold">{viewStep === 0 ? '(the start, past)' : '(as it ended, past)'}</span>}
        </span>
      </div>
      <span className="rail-sep mx-1 h-6 w-px" aria-hidden />
      <Tip content={<span>{playing ? 'Pause' : 'Play'} <span className="kbd ml-1">P</span></span>} width="w-auto whitespace-nowrap">
        <button type="button" className={`rail-btn !h-9 !w-9 ${playing ? '' : 'rail-btn-active'}`} onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={17} aria-hidden /> : <Play size={17} aria-hidden />}
        </button>
      </Tip>
      <div className="flex rounded-[10px] bg-white/5 p-0.5" role="radiogroup" aria-label="Speed">
        {SPEEDS.map((sp) => (
          <button
            key={sp}
            type="button"
            role="radio"
            aria-checked={speed === sp}
            {...speedItem(sp)}
            aria-label={`${speedLabel(sp)} speed: one season every ${(SPEED_MS[sp] / 1000).toFixed(1)} seconds`}
            title={`One season every ${(SPEED_MS[sp] / 1000).toFixed(1)} s`}
            className={`rounded-[8px] px-2 py-1 text-xs font-semibold ${speed === sp ? 'bg-cream text-ink' : 'text-muted hover:text-cream'}`}
            onClick={() => setSpeed(sp)}
          >
            {speedLabel(sp)}
          </button>
        ))}
      </div>
      <IconButton label="Advance one season" tip={<span>Advance one season <span className="kbd ml-1">.</span></span>} onClick={stepSeason}>
        <SkipForward size={17} aria-hidden />
      </IconButton>
      <IconButton label="Advance one year" tip={<span>Advance one year <span className="kbd ml-1">Y</span></span>} onClick={stepYear}>
        <ChevronsRight size={17} aria-hidden />
      </IconButton>
    </div>
  )
}

/** Top right: the six headline indicators. Each opens the panel that explains it. */
export function MetricsBar() {
  const sim = useGame((s) => s.sim)
  const togglePanel = useGame((s) => s.togglePanel)
  const { now, prev } = useValues()
  if (!sim || !now) return null
  return (
    <nav className="panel scroll-soft pointer-events-auto flex h-12 max-w-full shrink-0 items-center gap-0.5 overflow-x-auto px-1" aria-label="Indicators">
      <MetricChip
        id="budget"
        icon={Coins}
        value={fmtMoney(now.budget)}
        status={now.budget < 0 ? 'bad' : undefined}
        sub={now.debt > 0 ? `debt ${fmtMoney(now.debt)}` : undefined}
        delta={<Delta now={now.budget} prev={prev?.budget ?? null} def={METRICS.budget} format={fmtMoney} />}
        onClick={() => togglePanel('budget')}
        extraHelp={
          now.debt > 0 ? (
            <span className="mt-2 block">
              <strong className="text-cream">Debt: </strong>
              {METRICS.debt.measures} {METRICS.debt.calculation}
            </span>
          ) : null
        }
      />
      <MetricChip
        id="population"
        icon={House}
        value={fmtInt(now.population)}
        sub={`room for ${fmtInt(now.capacity)}, ${Math.round(now.housing * 100)}% housed`}
        status={band(now.housing)}
        delta={<Delta now={now.population} prev={prev?.population ?? null} def={METRICS.population} format={fmtInt} />}
        onClick={() => togglePanel('community')}
        extraHelp={
          <span className="mt-2 block">
            <strong className="text-cream">Housing: </strong>
            {METRICS.housing.calculation} On this map a housing parcel holds {listOr(housingPerParcel(sim))} people at density levels 1, 2 and 3.
          </span>
        }
      />
      <MetricChip
        id="food"
        icon={Utensils}
        value={`${Math.round(now.food * 100)}%`}
        status={band(now.food)}
        delta={<Delta now={now.food} prev={prev?.food ?? null} def={METRICS.food} format={(v) => `${Math.round(v * 100)}`} unit={PCT_POINTS} />}
        onClick={() => togglePanel('charts')}
      />
      <MetricChip
        id="water"
        icon={Droplet}
        value={`${Math.round(now.water * 100)}%`}
        status={band(now.water)}
        delta={<Delta now={now.water} prev={prev?.water ?? null} def={METRICS.water} format={(v) => `${Math.round(v * 100)}`} unit={PCT_POINTS} />}
        onClick={() => togglePanel('charts')}
      />
      <MetricChip
        id="land"
        icon={Sprout}
        value={now.land.toFixed(2)}
        status={now.land >= 0.65 ? 'good' : now.land >= 0.45 ? 'warn' : 'bad'}
        delta={<Delta now={now.land} prev={prev?.land ?? null} def={METRICS.land} format={(v) => v.toFixed(2)} />}
        onClick={() => togglePanel('charts')}
      />
      <MetricChip
        id="wellbeing"
        icon={HeartPulse}
        value={`${Math.round(now.wellbeing * 100)}%`}
        status={band(now.wellbeing)}
        delta={<Delta now={now.wellbeing} prev={prev?.wellbeing ?? null} def={METRICS.wellbeing} format={(v) => `${Math.round(v * 100)}`} unit={PCT_POINTS} />}
        onClick={() => togglePanel('community')}
      />
    </nav>
  )
}
