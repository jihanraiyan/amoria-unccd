import { useState } from 'react'
import { UI_SCALE_MAX, UI_SCALE_MIN } from '../../state/settings'
import { listParams } from '../../state/simParams'
import { useGame } from '../../state/store'
import { genericClimateNote, worldNotes } from '../../state/worlds'
import { Panel, Section } from '../common/Panel'
import { useRoving } from '../common/useRoving'
import { TOOLS } from '../toolbar/tools'
import { seasonText } from '../timeline/history'
import { modKey } from '../common/platform'

type Tab = 'settings' | 'controls' | 'model'
const QUALITIES = ['high', 'low'] as const

export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'P', action: 'Play or pause' },
  { keys: '.', action: 'Advance one season' },
  { keys: 'Y', action: 'Advance one year' },
  { keys: '< / >', action: 'Slower / faster' },
  { keys: 'W A S D', action: 'Move the camera' },
  { keys: 'Q / E', action: 'Turn the camera' },
  { keys: '- / =', action: 'Zoom out / in' },
  { keys: 'Home', action: 'Reset the camera' },
  { keys: 'Hold Space', action: 'Left-drag moves the camera with any tool' },
  { keys: `${modKey()} Z`, action: 'Undo an edit this season' },
  { keys: `${modKey()} Shift Z`, action: 'Redo' },
  { keys: '[ / ]', action: 'Smaller / bigger brush' },
  { keys: 'Shift + arrows', action: 'Move the parcel cursor (selects and previews the active tool)' },
  { keys: 'Enter', action: 'Apply the active tool at the parcel cursor' },
  { keys: '1 to 6', action: 'Overlays, Budget, Community, Insights, Charts, Goals' },
  { keys: '?', action: 'Settings and help' },
  { keys: 'Esc', action: 'Close panel, leave the past, drop the parcel cursor, or back to Inspect' },
]

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 py-1.5">
      <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-marigold)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className="block text-xs text-dim">{hint}</span>}
      </span>
    </label>
  )
}

function SettingsTab() {
  const settings = useGame((s) => s.settings)
  const updateSettings = useGame((s) => s.updateSettings)
  const saveGame = useGame((s) => s.saveGame)
  const resetRun = useGame((s) => s.resetRun)
  const exitToLanding = useGame((s) => s.exitToLanding)
  const restartTutorial = useGame((s) => s.restartTutorial)
  const lastSavedAt = useGame((s) => s.lastSavedAt)
  const autosaveFailed = useGame((s) => s.autosaveFailed)
  const [confirmReset, setConfirmReset] = useState(false)
  const scenarioA = useGame((s) => s.scenarios.A)
  const clearScenarios = useGame((s) => s.clearScenarios)
  const [confirmForget, setConfirmForget] = useState(false)
  const qualityItem = useRoving(QUALITIES, settings.quality, (q) => updateSettings({ quality: q }))
  return (
    <>
      <Section title="Display">
        <div role="radiogroup" aria-label="Graphics quality" className="mb-1 grid grid-cols-2 gap-1">
          {QUALITIES.map((q) => (
            <button
              key={q}
              type="button"
              role="radio"
              aria-checked={settings.quality === q}
              {...qualityItem(q)}
              className={`btn ${settings.quality === q ? 'btn-primary' : ''}`}
              onClick={() => updateSettings({ quality: q })}
            >
              {q === 'high' ? 'High quality' : 'Fast (low detail)'}
            </button>
          ))}
        </div>
        <Toggle
          label="Pause on important news"
          hint="While time is playing, stop when a season floods homes, leaves bills unpaid, puts food or water in crisis, or starts a drought, so you can look before the next season."
          checked={settings.pauseOnEvents}
          onChange={(v) => updateSettings({ pauseOnEvents: v })}
        />
        <Toggle
          label="Reduce motion"
          hint="Cuts camera glides and animations. Starts on if your system asks for reduced motion."
          checked={settings.reducedMotion}
          onChange={(v) => updateSettings({ reducedMotion: v })}
        />
        <Toggle
          label="Colorblind-friendly colors"
          hint="Uses blue for good, amber for caution and pink for bad, instead of green, yellow and red. Values under strain also carry a ! mark and critical ones !!, so status never depends on color alone."
          checked={settings.colorblind}
          onChange={(v) => updateSettings({ colorblind: v })}
        />
        <label className="mt-2 block">
          <span className="flex justify-between text-sm font-semibold">
            Text size <span className="tabular text-muted">{Math.round(settings.uiScale * 100)}%</span>
          </span>
          <input
            type="range"
            className="slider"
            min={UI_SCALE_MIN}
            max={UI_SCALE_MAX}
            step={0.05}
            value={settings.uiScale}
            onChange={(e) => updateSettings({ uiScale: Number(e.target.value) })}
          />
        </label>
      </Section>
      <Section title="Game">
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" className="btn" onClick={() => saveGame()}>
            Save now
          </button>
          <button type="button" className="btn" onClick={restartTutorial}>
            Replay tutorial
          </button>
          <button type="button" className="btn" onClick={exitToLanding}>
            Title screen
          </button>
          {!confirmReset ? (
            <button type="button" className="btn" onClick={() => setConfirmReset(true)}>
              Reset scenario
            </button>
          ) : (
            <button
              type="button"
              className="btn !border-bad !text-bad"
              onClick={() => {
                setConfirmReset(false)
                void resetRun()
              }}
            >
              Yes, start over
            </button>
          )}
        </div>
        {confirmReset && <p className="mt-1.5 text-xs text-warn">This throws away this run and starts again from the same valley, budget and weather.</p>}
        {scenarioA && (
          <div className="mt-2">
            {!confirmForget ? (
              <button type="button" className="btn w-full" onClick={() => setConfirmForget(true)}>
                Forget saved scenarios
              </button>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    className="btn !border-bad !text-bad"
                    onClick={() => {
                      setConfirmForget(false)
                      clearScenarios()
                    }}
                  >
                    Yes, forget them
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirmForget(false)}>
                    Keep them
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-warn">
                  This deletes the saved Scenario A (saved at {seasonText(scenarioA.endStep).toLowerCase()}) and any Scenario B, so there is nothing left to compare. The run you are playing now is kept.
                </p>
              </>
            )}
          </div>
        )}
        {autosaveFailed ? (
          <p className="mt-2 text-xs text-warn" role="note">
            Amoria tries to save in this browser after every change, but the last change could not be saved (storage may be full or disabled).{' '}
            {lastSavedAt ? `The last save that worked was at ${new Date(lastSavedAt).toLocaleTimeString()}.` : 'Nothing from this run is saved yet.'} No account and nothing leaves your device.
          </p>
        ) : (
          <p className="mt-2 text-xs text-dim">
            Amoria saves automatically in this browser after every change. {lastSavedAt ? `Last saved ${new Date(lastSavedAt).toLocaleTimeString()}.` : ''} No account and nothing leaves your device.
          </p>
        )}
      </Section>
    </>
  )
}

function ControlsTab() {
  return (
    <>
      <Section title="Camera">
        <ul className="space-y-1 text-sm">
          <li>With the Inspect tool, left-drag moves the map. With a building tool, left-drag paints instead; hold Space to move the map.</li>
          <li>Scroll to zoom. Right-drag turns the view. Middle-drag or Shift and right-drag also moves the map.</li>
          <li>The camera buttons next to the timeline zoom, turn and reset the view.</li>
          <li>The crosshair in the inspector flies the camera to a parcel.</li>
        </ul>
      </Section>
      <Section title="Building">
        <ul className="space-y-1 text-sm">
          <li>
            Pick a tool from the bar at the bottom, then hover the map to preview. Blue tiles can be built on; orange tiles with diagonal stripes cannot. The bar at the bottom of the
            screen always says in words how many parcels are valid, what it costs and why a parcel is refused.
          </li>
          <li>No mouse? Press Shift and an arrow key to move a cursor from parcel to parcel; the inspector follows it and the bar reads it out. Press Enter to apply the
            active tool there.</li>
          <li>Click to place. Many tools paint when you drag; change the brush with [ and ].</li>
          <li>You can undo edits until the season ends. After that, the past can be looked at but not changed.</li>
        </ul>
      </Section>
      <Section title="Keyboard">
        <table className="w-full text-sm">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys} className="border-t border-white/5">
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  <span className="kbd">{s.keys}</span>
                </th>
                <td className="py-1 text-muted">{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h4 className="eyebrow mt-3 mb-1">Tools</h4>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
          {TOOLS.map((t) => (
            <li key={t.id} className="flex items-center gap-1.5">
              <span className="kbd">{t.key}</span>
              {t.name}
            </li>
          ))}
        </ul>
      </Section>
    </>
  )
}

function ModelTab() {
  const sim = useGame((s) => s.sim)
  const world = useGame((s) => s.world)
  const [showParams, setShowParams] = useState(false)
  const params = showParams ? listParams() : []
  if (!sim) return null
  const notes = worldNotes(world)
  const meta = sim.meta
  return (
    <>
      <Section title="This world">
        <p className="text-base font-semibold">{meta.name}</p>
        <p className="mt-1 text-xs text-muted">{meta.description}</p>
        {genericClimateNote(meta) && (
          <p className="mt-1.5 rounded bg-black/20 p-1.5 text-xs text-parchment" data-testid="settings-climate-note">
            {genericClimateNote(meta)}
          </p>
        )}
        <p className="mt-1.5 text-xs">
          <strong>Where it comes from: </strong>
          {meta.provenance}
        </p>
        {meta.sources && meta.sources.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-xs">
            {meta.sources.map((s) => (
              <li key={s.name}>
                {s.name} {s.version} ({s.license}){' '}
                <a className="text-river underline" href={s.url} target="_blank" rel="noreferrer">
                  source
                </a>
              </li>
            ))}
          </ul>
        )}
        {notes && notes.disclosures.length > 0 && (
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-parchment">
            {notes.disclosures.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
        {notes && notes.attribution.length > 0 && (
          <p className="mt-1.5 text-[0.68rem] text-dim">{notes.attribution.join(' ')}</p>
        )}
        <p className="mt-1.5 text-xs text-dim">Seed {sim.seed}. The seed fixes the weather for the whole game, so two runs with the same seed face the same droughts and storms.</p>
      </Section>
      <Section title="How much to trust the numbers">
        <p className="text-xs leading-relaxed text-parchment">
          Amoria runs a simplified, deterministic model of rain, runoff, soil, plants, farms, money and people on a 64 by 64 grid. It is built to show how these systems
          push on each other, not to predict any real place. Numbers are in game units. Some relationships follow published methods (for example a curve-number style
          runoff split and a RUSLE-inspired erosion index); many values are chosen for playability. The key assumptions and limits:
        </p>
        <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs leading-snug text-parchment">
          <li>Each turn is one season. Storms inside a season are not simulated one by one, so peak flows and flood areas are indicative only. Floods use a simple screening rule on height above the river, not hydraulics.</li>
          <li>Weather and population pressure are generated from the seed and never respond to your choices. The guided scenario always brings a three-season drought and a heavy-rain season, by design.</li>
          <li>Erosion is an index shaped like the RUSLE method with game-sized numbers, not measured soil loss. Soil health is one index standing in for organic matter, structure and fertility.</li>
          <li>In this model trees use more water than grass, so clearing forest raises the river&apos;s low flow, while freshly cleared bare ground sheds more storm water. Field studies disagree on dry-season flow, especially where soils are degraded, so read this result with care.</li>
          <li>There is one soil type everywhere, no groundwater flow between parcels, no salinity, pests or climate trend.</li>
          <li>The economy is one shared community fund with fixed prices. Population follows simple attractiveness rules, not a demographic projection.</li>
          <li>Wellbeing weights are a value judgement made for the game, shown openly in the Community panel.</li>
        </ul>
      </Section>
      <Section title="Parameters">
        <button type="button" className="btn" aria-expanded={showParams} onClick={() => setShowParams((v) => !v)}>
          {showParams ? 'Hide' : 'Show'} every model parameter
        </button>
        {showParams && (
          <ul className="mt-2 space-y-1.5">
            {params.length === 0 && <li className="text-xs text-dim">The parameter list is not available in this build.</li>}
            {params.map((p) => (
              <li key={`${p.group}.${p.key}`} className="text-[0.7rem]">
                <span className="font-semibold">
                  {p.group}.{p.key}
                </span>{' '}
                <span className={`chip !py-0 ${p.evidence === 'evidence-informed' ? 'text-river' : 'text-dim'}`}>
                  {p.evidence === 'evidence-informed' ? 'evidence-informed' : 'game balance'}
                </span>
                <span className="block text-muted">{p.note}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  )
}

export function SettingsPanel() {
  const close = useGame((s) => s.openPanel)
  const [tab, setTab] = useState<Tab>('settings')
  const tabs: { id: Tab; label: string }[] = [
    { id: 'settings', label: 'Settings' },
    { id: 'controls', label: 'How to play' },
    { id: 'model', label: 'About the model' },
  ]
  const tabItem = useRoving(
    tabs.map((t) => t.id),
    tab,
    setTab,
  )
  return (
    <Panel title="Settings and help" onClose={() => close(null)} className="w-[23rem]">
      <div role="tablist" aria-label="Settings sections" className="mb-3 grid grid-cols-3 gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`settings-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="settings-tabpanel"
            {...tabItem(t.id)}
            className={`rounded-lg px-1 py-1.5 text-xs font-bold ${tab === t.id ? 'bg-white/15 text-marigold' : 'text-muted hover:bg-white/8'}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="settings-tabpanel" aria-labelledby={`settings-tab-${tab}`} tabIndex={0} className="outline-none">
        {tab === 'settings' && <SettingsTab />}
        {tab === 'controls' && <ControlsTab />}
        {tab === 'model' && <ModelTab />}
      </div>
    </Panel>
  )
}
