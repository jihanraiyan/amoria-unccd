// Bottom dock: every land tool as an icon (name, live cost, shortcut and tradeoffs in its tooltip),
// with the active tool's options in a small island above it.
import { Minus, Plus } from 'lucide-react'
import { useDeferredValue } from 'react'
import { INTENSITIES, type Intensity } from '../../simulation/types'
import { useGame } from '../../state/store'
import { MAX_BRUSH, type ToolId } from '../../state/toolActions'
import { toolUpkeepText } from '../../state/upkeep'
import { intensityCounts, toolAvailability, type ToolAvailability } from '../../state/toolProbe'
import { Tip } from '../common/Tip'
import { useRoving } from '../common/useRoving'
import { fmtMoney } from '../metrics'
import { GROUP_LABEL, TOOLS, type ToolDef, type ToolGroup } from './tools'

export function costLabel(a: ToolAvailability | null): string {
  if (!a || a.minCost === null) return ''
  if (a.maxCost !== null && a.maxCost > a.minCost * 1.05) return `${fmtMoney(a.minCost)}+`
  return fmtMoney(a.minCost)
}

const INTENSITY_LABEL: Record<Intensity, string> = { low: 'Low', medium: 'Medium', high: 'High' }

/** How many fields sit at each intensity, so the player can see what changing it would do. */
function FieldIntensities() {
  const sim = useGame((s) => s.sim)
  const tool = useGame((s) => s.tool)
  if (!sim || tool !== 'set-intensity') return null
  const c = intensityCounts(sim)
  const total = c.low + c.medium + c.high
  return (
    <p className="mt-1 text-[0.68rem] leading-snug text-dim">
      {total === 0
        ? 'No cropland yet. Plant fields first.'
        : `Your ${total} field${total === 1 ? '' : 's'} now: ${c.low} low, ${c.medium} medium, ${c.high} high. Fields already at the chosen level are skipped.`}
    </p>
  )
}

/** Does this tool have anything to set before placing it? */
const hasOptions = (def: ToolDef): boolean => !!(def.options?.intensity || def.options?.irrigation || def.brush)

function ToolOptionsBox({ def, cost }: { def: ToolDef; cost: string }) {
  const options = useGame((s) => s.toolOptions)
  const setToolOptions = useGame((s) => s.setToolOptions)
  const brush = useGame((s) => s.brush)
  const setBrush = useGame((s) => s.setBrush)
  const intensityItem = useRoving(INTENSITIES, options.intensity, (lvl) => setToolOptions({ intensity: lvl }))
  return (
    <div className="panel anim-rise w-72 max-w-full space-y-2.5 p-3 text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{def.name}</span>
        {cost && <span className="tabular text-dim">{cost} per parcel</span>}
      </div>
      {def.options?.intensity && (
        <fieldset>
          <legend className="mb-1 text-muted">Intensity</legend>
          <div className="grid grid-cols-3 gap-1 rounded-[10px] bg-white/5 p-0.5" role="radiogroup" aria-label="Farming intensity">
            {INTENSITIES.map((lvl) => (
              <button
                key={lvl}
                type="button"
                role="radio"
                aria-checked={options.intensity === lvl}
                {...intensityItem(lvl)}
                className={`rounded-[8px] py-1 text-xs font-semibold ${options.intensity === lvl ? 'bg-cream text-ink' : 'text-muted hover:text-cream'}`}
                onClick={() => setToolOptions({ intensity: lvl })}
              >
                {INTENSITY_LABEL[lvl]}
              </button>
            ))}
          </div>
          <FieldIntensities />
        </fieldset>
      )}
      {def.options?.irrigation && (
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-[var(--color-cream)]"
            checked={options.irrigated}
            onChange={(e) => setToolOptions({ irrigated: e.target.checked })}
          />
          <span>Irrigate new fields</span>
        </label>
      )}
      {def.brush && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted" id="brush-label">
            Brush
          </span>
          <div className="flex items-center gap-1" role="group" aria-labelledby="brush-label">
            <button type="button" className="btn btn-icon !p-1" aria-label="Smaller brush ([)" onClick={() => setBrush(brush - 1)} disabled={brush <= 0}>
              <Minus size={14} aria-hidden />
            </button>
            <span className="tabular w-16 text-center" aria-live="polite">
              {brush === 0 ? '1 parcel' : `radius ${brush}`}
            </span>
            <button type="button" className="btn btn-icon !p-1" aria-label="Bigger brush (])" onClick={() => setBrush(brush + 1)} disabled={brush >= MAX_BRUSH}>
              <Plus size={14} aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ToolButton({ def, avail, active, blocked }: { def: ToolDef; avail: ToolAvailability | null; active: boolean; blocked: string | null }) {
  const setTool = useGame((s) => s.setTool)
  const Icon = def.icon
  const reason = blocked ?? (avail && !avail.placeable ? avail.reason : null)
  const warn = !reason && avail && !avail.affordable ? avail.reason : null
  const cost = costLabel(avail)
  const options = useGame((s) => s.toolOptions)
  const cellSizeM = useGame((s) => s.sim?.terrain.cellSizeM ?? 100)
  const upkeep = toolUpkeepText(def.id, options, cellSizeM)
  return (
      <Tip
        side="top"
        content={
          <span className="block">
            <span className="block text-sm font-semibold text-cream">
              {def.name} <span className="kbd ml-1">{def.key}</span>
            </span>
            <span className="mt-1 block">{def.description}</span>
            {cost && <span className="mt-1 block text-cream">Cost per parcel: {cost} (exact cost shown before you place)</span>}
            {upkeep && <span className="mt-1 block text-warn">Running cost: {upkeep}. Paid from the town fund every season.</span>}
            <span className="mt-1.5 block">
              <strong className="text-good">Gain: </strong>
              {def.tradeoffs.gain}
            </span>
            <span className="mt-0.5 block">
              <strong className="text-warn">Cost: </strong>
              {def.tradeoffs.cost}
            </span>
            {reason && <span className="mt-1.5 block font-semibold text-bad">Unavailable: {reason}</span>}
            {warn && <span className="mt-1.5 block font-semibold text-warn">{warn}</span>}
          </span>
        }
      >
        <button
          type="button"
          aria-disabled={reason ? true : undefined}
          aria-pressed={active}
          aria-label={`${def.name}${cost ? `, ${cost} per parcel` : ''}, shortcut ${def.key}${reason ? `, unavailable: ${reason}` : ''}`}
          onClick={() => {
            // stays focusable while unavailable so keyboard users can reach the reason
            if (!reason) setTool(def.id)
          }}
          className={`rail-btn ${active ? 'rail-btn-active' : ''} ${warn && !active ? 'text-warn' : ''}`}
        >
          <Icon size={18} aria-hidden />
        </button>
      </Tip>
  )
}

export function Toolbar() {
  const sim = useGame((s) => s.sim)
  const tool = useGame((s) => s.tool)
  const options = useGame((s) => s.toolOptions)
  const viewStep = useGame((s) => s.viewStep)
  // availability scans are cheap but not free; let them lag a frame behind the world
  const deferredSim = useDeferredValue(sim)
  const deferredOptions = useDeferredValue(options)
  if (!sim) return null
  const blocked = viewStep !== null ? 'You are viewing the past.' : null
  const avail = (id: ToolId) => (deferredSim ? toolAvailability(deferredSim, id, deferredOptions) : null)
  const activeDef = TOOLS.find((t) => t.id === tool)
  const groups = (Object.keys(GROUP_LABEL) as ToolGroup[]).map((g) => ({ id: g, tools: TOOLS.filter((t) => t.group === g) })).filter((g) => g.tools.length > 0)
  return (
    <nav className="pointer-events-none flex max-w-full flex-col items-center gap-2" aria-label="Land tools">
      {activeDef && activeDef.id !== 'inspect' && hasOptions(activeDef) && (
        <div className="pointer-events-auto max-w-full">
          <ToolOptionsBox def={activeDef} cost={costLabel(avail(activeDef.id))} />
        </div>
      )}
      <div className="panel scroll-soft pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto p-1.5">
        {groups.map((g, i) => (
          <div key={g.id} className="flex items-center gap-0.5" role="group" aria-label={GROUP_LABEL[g.id]}>
            {i > 0 && <span className="rail-sep mx-1 h-6 w-px" aria-hidden />}
            {g.tools.map((def) => (
              <ToolButton key={def.id} def={def} avail={avail(def.id)} active={tool === def.id} blocked={def.id === 'inspect' ? null : blocked} />
            ))}
          </div>
        ))}
      </div>
    </nav>
  )
}
