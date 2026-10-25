// Right-hand inspector for the selected parcel.
import { Check, Crosshair, MapPin, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { INTENSITIES, coverName, structureCode, type ActionValidation, type Intensity, type SimulationState } from '../../simulation/types'
import { useGame } from '../../state/store'
import { buildToolAction, type ToolId, type ToolOptions } from '../../state/toolActions'
import { validateToolAt } from '../../state/toolProbe'
import { demFillStats, worldCellData } from '../../state/worlds'
import { actionUpkeep, upkeepPhrase } from '../../state/upkeep'
import { Meter, Section } from '../common/Panel'
import { Tip } from '../common/Tip'
import { InfoTip } from '../common/InfoTip'
import { KIND_LABEL, KIND_NOTE, fmtMoney, type MetricKind } from '../metrics'
import { TOOLS, type ToolDef } from '../toolbar/tools'
import { COVER_LABEL, cellSummary, economicRole, intensityLabel, acquiredYears, observedCoverHint, observedTerrainHint, pooledVoteNote, sensitivityFacts, upstreamHa } from './describe'
import { DRIVER_TEXT, cellSensitivity } from './sensitivity'
import { parcelValue, type ParcelValue } from './parcelValue'

/** Same wording as the Environmental sensitivity overlay, so the two read as one value. */
const SENSITIVITY_NOTE =
  'Derived indicator computed by the simulation: how much harm disturbing this parcel would do. Each parcel takes the highest of four scores: how fast its soil would wash away if it were bare, how easily the river floods it, whether it sits on a stream bank, and whether it is wetland. The same value the Environmental sensitivity overlay draws. A guide to where care matters most, not a measurement.'

function Row({ label, value, hint }: { label: string; value: string; hint?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-xs">
      <dt className="text-muted">
        {label}
        {hint && <InfoTip label={label}>{hint}</InfoTip>}
      </dt>
      <dd className="tabular text-right font-semibold">{value}</dd>
    </div>
  )
}

/** What kind of number a section holds, with the full note on hover, focus, click or tap. */
/** One wording for every erosion figure (MODEL_ASSUMPTIONS section 5: read "tonnes" as game tonnes). */
const EROSION_UNIT_NOTE =
  'An erosion index built like the RUSLE soil-loss method, in game tonnes per hectare: a consistent unit for comparing parcels and choices, not measured tonnes of soil.'

function KindChip({ kind, label, note }: { kind?: MetricKind; label?: string; note?: string }) {
  const text = label ?? (kind ? KIND_LABEL[kind] : '')
  const body = note ?? (kind ? KIND_NOTE[kind] : '')
  return (
    <Tip content={<span>{body}</span>} width="w-64" toggle>
      <button type="button" className="chip !py-0 text-[0.68rem] text-parchment" aria-label={`${text}: ${body}`}>
        {text}
      </button>
    </Tip>
  )
}

interface OptionRow {
  key: string
  def: ToolDef
  name: string
  options: ToolOptions
  v: ActionValidation | null
  /** True for the level a field is already at (shown, not offered). */
  current?: boolean
}

const LEVEL_NAME: Record<Intensity, string> = { low: 'Low', medium: 'Medium', high: 'High' }

function interventionRows(sim: SimulationState, cell: number, options: ToolOptions): OptionRow[] {
  const isCrop = coverName(sim.layers.cover[cell]) === 'cropland'
  const rows: OptionRow[] = []
  for (const def of TOOLS) {
    if (def.id === 'inspect') continue
    if (def.id === 'set-intensity' && isCrop) {
      const now = INTENSITIES[sim.layers.intensity[cell]] ?? 'medium'
      for (const lvl of INTENSITIES) {
        const o = { ...options, intensity: lvl }
        rows.push({
          key: `${def.id}-${lvl}`,
          def,
          name: `${LEVEL_NAME[lvl]} intensity`,
          options: o,
          v: lvl === now ? null : validateToolAt(sim, def.id, [cell], o),
          current: lvl === now,
        })
      }
      continue
    }
    rows.push({ key: def.id, def, name: def.name, options, v: validateToolAt(sim, def.id, [cell], options) })
  }
  return rows
}

/** "Then about $55 a season" for one intervention on this parcel, from the engine's own rates. */
function UpkeepLine({ sim, tool, cell, options, v }: { sim: SimulationState; tool: ToolId; cell: number; options: ToolOptions; v: ActionValidation }) {
  const action = buildToolAction(tool, [cell], options)
  const text = action && v.cellOk[0] ? upkeepPhrase(actionUpkeep(sim, action, v)) : ''
  if (!text) return null
  return <p className="mt-1 text-[0.7rem] text-warn">Running cost: {text.charAt(0).toUpperCase() + text.slice(1)}.</p>
}

function Interventions({ cell }: { cell: number }) {
  const sim = useGame((s) => s.sim)
  const options = useGame((s) => s.toolOptions)
  const dispatch = useGame((s) => s.dispatch)
  const [showBlocked, setShowBlocked] = useState(false)
  const rows = useMemo(() => (sim ? interventionRows(sim, cell, options) : []), [sim, cell, options])
  const possible = rows.filter((r) => r.current || r.v?.cellOk[0])
  const blocked = rows.filter((r) => !r.current && !r.v?.cellOk[0])
  return (
    <Section title="What you could do here" hint="Live costs for this parcel. Each choice has a gain and a cost.">
      {possible.length === 0 && <p className="text-xs text-dim">No changes are possible on this parcel right now.</p>}
      <ul className="space-y-1.5">
        {possible.map(({ key, def, name, options: o, v, current }) => {
          const Icon = def.icon
          const affordable = !!v?.ok
          return (
            <li key={key} className={`rounded-lg p-2 ${current ? 'bg-white/8 ring-1 ring-marigold/40' : 'bg-black/20'}`}>
              <div className="flex items-center gap-2">
                <Icon size={15} aria-hidden className="text-parchment" />
                <span className="flex-1 text-[0.8rem] font-semibold">
                  {name}
                  {def.id === 'set-intensity' && <span className="block text-[0.68rem] font-normal text-dim">Farming intensity</span>}
                </span>
                {current ? (
                  <span className="chip !py-0 text-[0.68rem] text-marigold">
                    <Check size={11} aria-hidden /> Current level
                  </span>
                ) : (
                  <>
                    <span className={`tabular text-xs font-bold ${affordable ? 'text-cream' : 'text-bad'}`}>{fmtMoney(v?.cost ?? 0)}</span>
                    <button
                      type="button"
                      className="btn !px-2 !py-1 text-[0.7rem]"
                      disabled={!affordable}
                      onClick={() => {
                        const action = buildToolAction(def.id, [cell], o)
                        if (action) dispatch(action)
                      }}
                      aria-label={`${name} here for ${fmtMoney(v?.cost ?? 0)}`}
                    >
                      Do it
                    </button>
                  </>
                )}
              </div>
              {!current && v && sim && <UpkeepLine sim={sim} tool={def.id} cell={cell} options={o} v={v} />}
              {v && v.revenue !== undefined && v.revenue > 0 && (
                <p className="mt-1 text-[0.7rem] text-good">Earns {fmtMoney(v.revenue)} once (for example timber sold when clearing).</p>
              )}
              {!current && !affordable && v?.reasons[0] && <p className="mt-1 text-[0.7rem] text-bad">{v.reasons[0]}</p>}
              {!current && (
                <p className="mt-1 text-[0.7rem] leading-snug text-muted">
                  <span className="text-good">+</span> {def.tradeoffs.gain} <span className="text-warn">-</span> {def.tradeoffs.cost}
                </p>
              )}
            </li>
          )
        })}
      </ul>
      {blocked.length > 0 && (
        <div className="mt-2">
          <button type="button" className="text-xs text-river underline-offset-2 hover:underline" aria-expanded={showBlocked} onClick={() => setShowBlocked((b) => !b)}>
            {showBlocked ? 'Hide' : 'Show'} {blocked.length} options not allowed here
          </button>
          {showBlocked && (
            <ul className="mt-1 space-y-1">
              {blocked.map(({ key, name, v }) => (
                <li key={key} className="flex gap-1.5 text-[0.7rem] text-dim">
                  <X size={12} className="mt-0.5 shrink-0 text-bad" aria-hidden />
                  <span>
                    <strong className="text-muted">{name}:</strong> {v?.cellReasons?.[0] || v?.reasons[0] || 'Not allowed here.'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  )
}

/** Why the game's starting cover differs from the observed dataset on this cell, from the documented rules. */
function adjustmentNote(startStructure: number, builtPct: number | null): string {
  return startStructure === structureCode('road')
    ? 'A road crosses this cell (from OpenStreetMap, or a short link the map builder added), so the game counts the cell as built-up.'
    : startStructure === structureCode('housing')
      ? `${builtPct !== null ? `${builtPct}% of the 10 m pixels here were mapped as built-up, ` : 'Enough of this cell was mapped as built-up '}so the game counts it as part of a settlement.`
      : 'The map builder adjusted this cell by one of its documented rules (see About the model in Settings and help).'
}

const EARNED_HINT: Record<ParcelValue['kind'], string> = {
  crop: 'Crop sold at the farm price (higher with markets nearby). Farm households keep it after the cooperative levy, the share that goes to the town fund.',
  agroforestry:
    'A smaller staple crop plus fruit, fodder and timber from the trees. The tree part grows from 3 to 7 years after planting, so young plots earn little at first. Households keep it after the cooperative levy.',
  grazing: 'Livestock value from grazing, scaled by grass cover and soil. It goes straight to herding households, with no levy.',
  forest: 'Fuelwood, fodder and wild food from standing forest, scaled by canopy cover. It goes straight to households and stops if the forest is cleared.',
  none: '',
}

function EarnedRows({ v }: { v: ParcelValue }) {
  return (
    <>
      <Row label="Earned here" value={fmtMoney(v.total)} hint={EARNED_HINT[v.kind]} />
      {v.kind === 'agroforestry' && (
        <>
          <Row label="from the crop" value={fmtMoney(v.crop)} />
          <Row label="from the trees" value={fmtMoney(v.trees)} />
        </>
      )}
    </>
  )
}

export function Inspector() {
  const sim = useGame((s) => s.sim)
  const cell = useGame((s) => s.selectedCell)
  const view = useGame((s) => s.viewSnapshot)
  const viewStep = useGame((s) => s.viewStep)
  const world = useGame((s) => s.world)
  const start = useGame((s) => s.snapshots[0])
  // the world as the last simulated season left it, before this season's edits
  const lastSnap = useGame((s) => (s.sim ? s.snapshots[s.sim.step] : undefined))
  const selectCell = useGame((s) => s.selectCell)
  const requestFocus = useGame((s) => s.requestFocus)
  // only the 3D view has a camera to move
  const has3d = useGame((s) => s.worldView === '3d')
  if (!sim || cell === null || cell < 0 || cell >= sim.terrain.width * sim.terrain.height) return null
  const t = sim.terrain
  const layers = view ? view.layers : sim.layers
  const fields = view ? view.fields : sim.fields
  // the start of the game (live or viewed from later) has no simulated season to report
  const simulated = (viewStep ?? sim.step) > 0
  const earned = simulated ? parcelValue(t, view ? view.layers : (lastSnap?.layers ?? sim.layers), fields, cell) : null
  const x = cell % t.width
  const z = Math.floor(cell / t.width)
  const { cover, structure, title } = cellSummary(layers, cell)
  const baseline = coverName(layers.baselineCover[cell])
  const isCrop = cover === 'cropland'
  const realData = sim.meta.kind === 'real-data-derived'
  const cellData = worldCellData(world)
  const observed = realData && cellData.observedCover ? coverName(cellData.observedCover[cell]) : null
  const coverSourceEntry = sim.meta.sources?.find((s) => /worldcover/i.test(s.name))
  const wcCode = realData && cellData.worldCoverClass ? cellData.worldCoverClass[cell] : null
  const wcName = wcCode === null ? null : (cellData.worldCoverLegend?.[wcCode] ?? `WorldCover class ${wcCode}`)
  const wcShare = cellData.worldCoverSharePct ? cellData.worldCoverSharePct[cell] : null
  const voteNote = wcName && observed !== null ? pooledVoteNote(wcName, wcShare, COVER_LABEL[observed]) : null
  const wcYears = acquiredYears(coverSourceEntry?.acquired) ?? acquiredYears(coverSourceEntry?.version)
  const coverSource = coverSourceEntry?.name ?? 'the land-cover dataset'
  const demSource = sim.meta.sources?.find((s) => /dem/i.test(s.name))?.name ?? 'the elevation dataset'
  const adjusted = observed !== null && observed !== baseline
  const channelNote = t.channel[cell] === 1
  const facts = sensitivityFacts(t, layers, cell)
  const sens = cellSensitivity(sim, view, cell)
  const soil = layers.soilHealth[cell]

  return (
    <aside className="panel anim-rise pointer-events-auto flex max-h-full w-80 flex-col overflow-hidden" aria-label="Parcel inspector">
      <header className="flex items-start gap-2 border-b border-[var(--panel-line)] px-4 pt-3 pb-2.5">
        <MapPin size={18} className="mt-1 text-marigold" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="eyebrow">
            Parcel {x}, {z}
            {view && <span className="ml-1 text-marigold">(past)</span>}
          </div>
          <h2 className="text-base leading-tight font-semibold">{title}</h2>
          <div className="mt-1 flex flex-wrap gap-1">
            {t.protected[cell] === 1 && <span className="chip text-warn">Protected</span>}
            {t.channel[cell] === 1 && <span className="chip text-river">River channel</span>}
            {isCrop && <span className="chip">{intensityLabel(layers.intensity[cell])} intensity</span>}
            {isCrop && layers.irrigated[cell] === 1 && <span className="chip text-river">Irrigated</span>}
            {layers.conservation[cell] === 1 && <span className="chip text-good">Conservation</span>}
            {fields.flooded?.[cell] === 1 && <span className="chip text-bad">Flooded last season</span>}
          </div>
        </div>
        {has3d && (
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Focus camera on this parcel" onClick={() => requestFocus(cell)}>
            <Crosshair size={16} aria-hidden />
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-icon -mr-1" aria-label="Close inspector" onClick={() => selectCell(null)}>
          <X size={18} aria-hidden />
        </button>
      </header>
      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <Section title="Land use">
          <dl>
            <Row label="Now" value={`${COVER_LABEL[cover]}${structure !== 'none' ? ` + ${structure}` : ''}`} />
            <Row
              label="At the start of the game"
              value={COVER_LABEL[baseline]}
              hint={realData ? 'The cover this parcel had when the game began, after the map builder turned the observed data into game classes.' : 'From the fictional starting map.'}
            />
            {wcName !== null && (
              <Row
                label={`WorldCover${wcYears ? ` ${wcYears}` : ''}`}
                value={`${wcName}${wcShare !== null ? ` (${wcShare}% of pixels)` : ''}`}
                hint={`The most common native ${coverSource} class among the satellite pixels in this cell, before any mapping to game classes.`}
              />
            )}
            {observed !== null && (
              <Row
                label={`Observed, as a game class (${coverSource})`}
                value={COVER_LABEL[observed]}
                hint={observedCoverHint(sim.terrain.cellSizeM, coverSourceEntry)}
              />
            )}
            <Row label="Seasons in current use" value={String(layers.coverAge[cell])} />
          </dl>
          {voteNote && (
            <p className="mt-1.5 rounded bg-black/20 p-1.5 text-[0.7rem] leading-snug text-parchment" data-testid="pooled-vote-note">
              <strong>Why the classes differ: </strong>
              {voteNote}
            </p>
          )}
          {adjusted && (
            <p className="mt-1.5 rounded bg-black/20 p-1.5 text-[0.7rem] leading-snug text-parchment">
              <strong>Why the game differs from the observation: </strong>
              {channelNote
                ? 'The game treats this cell as a stream channel derived from the elevation data, so it starts as open water.'
                : adjustmentNote(start?.layers.structure[cell] ?? 0, cellData.builtPct ? cellData.builtPct[cell] : null)}
            </p>
          )}
          <p className="mt-1.5 text-xs leading-snug text-muted">{economicRole(cover, structure, layers.irrigated[cell] === 1)}</p>
        </Section>

        <Section
          title="Terrain"
          hint={
            realData ? (
              <KindChip label="Observed elevation, derived slope" note={observedTerrainHint(demSource, sim.terrain.cellSizeM, demFillStats(world))} />
            ) : (
              <KindChip label="Fictional map" note="The Amoria Valley is made up. Its terrain is generated, not measured, and it is the same in every game." />
            )
          }
        >
          <dl>
            <Row
              label="Elevation"
              value={`${Math.round(t.elevationM[cell])} m`}
              hint={realData ? 'Observed baseline data: measured height, averaged to the game grid and depression-filled (pits raised so water can drain).' : undefined}
            />
            <Row
              label="Slope"
              value={`${(t.slope[cell] * 100).toFixed(1)}%`}
              hint={`Rise over run, worked out from the heights of neighbouring parcels.${realData ? ' Derived from observed elevation.' : ''}`}
            />
            <Row
              label="Upstream area"
              value={`${upstreamHa(t, cell).toFixed(0)} ha`}
              hint={`Land that drains through this parcel, including itself, following the steepest way downhill.${realData ? ' Derived from observed elevation.' : ''}`}
            />
          </dl>
        </Section>

        <Section title="Soil and water" hint={<KindChip kind="model" note="Teaching indices in game units from the simplified model, not field measurements. Good for comparing choices." />}>
          <Meter label="Soil health" value={soil} format={(v) => v.toFixed(2)} tone={soil >= 0.65 ? 'good' : soil >= 0.45 ? 'warn' : 'bad'} />
          <Meter label="Plant cover" value={layers.vegetation[cell]} tone="good" />
          <dl>
            <Row label="Soil moisture" value={`${Math.round(layers.soilMoistureMm[cell])} mm`} hint="Water held in the root zone that plants can use." />
            {layers.groundwaterMm && <Row label="Groundwater below" value={`${Math.round(layers.groundwaterMm[cell])} mm`} hint="Shallow water below the roots. It feeds the river slowly in dry seasons." />}
            {layers.wetlandStoreMm && layers.wetlandStoreMm[cell] > 0 && <Row label="Wetland water held" value={`${Math.round(layers.wetlandStoreMm[cell])} mm`} />}
          </dl>
        </Section>

        <Section title="Last season here" hint={simulated ? <KindChip kind="model" /> : undefined}>
          {!simulated ? (
            <p className="text-xs text-dim">No season has been simulated yet. Advance time to see runoff, erosion and harvests.</p>
          ) : (
            <dl>
              <Row label="Rain soaked in" value={`${Math.round(fields.infiltrationMm[cell])} mm`} />
              <Row label="Ran off" value={`${Math.round(fields.runoffMm[cell])} mm`} />
              {fields.etMm && <Row label="Used by plants and evaporated" value={`${Math.round(fields.etMm[cell])} mm`} />}
              <Row label="Water passing through" value={`${Math.round(fields.flowMm[cell])} mm`} hint="Local runoff plus flow arriving from uphill." />
              <Row label="Erosion pressure" value={`${fields.erosion[cell].toFixed(2)} game t/ha`} hint={EROSION_UNIT_NOTE} />
              <Row label="Sediment arriving" value={fields.sedimentIn[cell].toFixed(2)} hint="Soil washed in from uphill parcels that settled here." />
              {isCrop && <Row label="Harvest" value={`${fields.yieldT[cell].toFixed(1)} t`} hint="Game-scaled tonnes." />}
              {earned && earned.kind !== 'none' && <EarnedRows v={earned} />}
              {isCrop && fields.irrigationMm && <Row label="Irrigation applied" value={`${Math.round(fields.irrigationMm[cell])} mm`} />}
              <Row label="Water for plants" value={`${Math.round(fields.waterFactor[cell] * 100)}%`} hint="How much water limited growth (100% means not limited)." />
            </dl>
          )}
        </Section>

        <Section title="Environmental sensitivity" hint={<KindChip label="Derived indicator" note={SENSITIVITY_NOTE} />}>
          {sens.index === null ? (
            <p className="text-xs text-dim">Open water. The sensitivity overlay leaves rivers, lakes and reservoirs plain.</p>
          ) : (
            <>
              <Meter label="Sensitivity" value={sens.index} format={(v) => v.toFixed(2)} tone={sens.index >= 0.66 ? 'bad' : sens.index >= 0.33 ? 'warn' : 'good'} />
              <p className="mb-1 text-[0.7rem] leading-snug text-parchment">
                {sens.driver ? `Highest part here: ${DRIVER_TEXT[sens.driver]}.` : 'None of the four parts applies here.'}
              </p>
              <dl>
                <Row
                  label="Erosion risk"
                  value={`${sens.erosionRisk.toFixed(1)} game t/ha`}
                  hint={`What this parcel would lose in a normal wet season with its current cover, soil and farming practice. The same value as the Erosion risk overlay. ${EROSION_UNIT_NOTE}`}
                />
                <Row label="Flood exposure" value={sens.flood.toFixed(2)} hint="0 to 1: how little extra river rise it takes to flood this parcel, from its height above the nearest stream." />
              </dl>
            </>
          )}
          <h4 className="mt-2 mb-1 text-[0.7rem] font-semibold text-muted">Compared with the rest of the valley</h4>
          <ul className="space-y-1">
            {facts.map((f) => (
              <li key={f.label} className="flex gap-1.5 text-xs">
                {f.notable ? (
                  <span className="mt-0.5 shrink-0 font-bold text-warn" aria-hidden>
                    !
                  </span>
                ) : (
                  <Check size={12} className="mt-0.5 shrink-0 text-dim" aria-hidden />
                )}
                <span>
                  {f.notable && <span className="sr-only">Notable: </span>}
                  <strong className={f.notable ? 'text-warn' : 'text-muted'}>{f.label}:</strong> {f.detail}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        {!view && <Interventions cell={cell} />}
        {view && <p className="text-xs text-marigold">You are looking at the past. Return to the present to make changes.</p>}
      </div>
    </aside>
  )
}
