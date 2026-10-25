// Title screen over the live 3D valley.
import { ArrowRight, BookOpen, Globe2, Map as MapIcon, Play, Sprout } from 'lucide-react'
import { Suspense, useEffect, useState } from 'react'
import { CanvasBoundary } from '../../app/ErrorBoundary'
import { useGameExports } from '../../app/gameModules'
import { useGame } from '../../state/store'
import type { WorldMeta } from '../../simulation/types'
import { PROCEDURAL_WORLD_ID, genericClimateNote, listWorlds, type WorldEntry } from '../../state/worlds'
import { WorldAttribution } from '../common/WorldAttribution'

/** Short source names for the card ("ESA WorldCover 10 m 2021", "OpenStreetMap"). */
function shortSourceNames(meta: WorldMeta): string[] {
  return (meta.sources ?? []).map((src) => src.name.replace(/\s*\(.*\)\s*$/, '').trim()).filter(Boolean)
}

function joinList(xs: string[]): string {
  if (xs.length <= 1) return xs.join('')
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

/** One plain sentence for the world card; the full description and provenance sit behind "Map details". */
export function worldSummary(meta: WorldMeta): string {
  const own = (meta as WorldMeta & { summary?: unknown }).summary
  if (typeof own === 'string' && own.trim()) return own.trim()
  if (meta.kind !== 'real-data-derived') {
    const first = meta.description.match(/^[^.]*\./)?.[0] ?? meta.description
    return `${first} Made up for the game.`
  }
  const sources = shortSourceNames(meta)
  return `Real hills, farms and roads of ${meta.name}${sources.length ? `, from ${joinList(sources)}` : ''}. Game numbers are illustrative.`
}

function MapDetails({ meta }: { meta: WorldMeta }) {
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-dim hover:text-cream">Map details: {meta.name}</summary>
      <p className="mt-1 leading-snug text-muted">{meta.description}</p>
      <p className="mt-1 leading-snug text-dim">{meta.provenance}</p>
    </details>
  )
}

function WorldCard({ w, checked, onChange }: { w: WorldEntry; checked: boolean; onChange(id: string): void }) {
  const real = w.meta.kind === 'real-data-derived'
  const Icon = real ? Globe2 : MapIcon
  const nameId = `world-${w.meta.id}-name`
  const lineId = `world-${w.meta.id}-line`
  const climate = genericClimateNote(w.meta)
  return (
    <div
      className={`rounded-xl border p-3 transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-marigold ${
        checked ? 'border-marigold bg-marigold/10' : 'border-[var(--panel-line)] bg-black/20 hover:bg-white/5'
      }`}
    >
      <label className="flex cursor-pointer gap-3">
        <input
          type="radio"
          name="world"
          className="sr-only"
          checked={checked}
          onChange={() => onChange(w.meta.id)}
          aria-labelledby={nameId}
          aria-describedby={lineId}
        />
        <Icon size={20} className="mt-0.5 shrink-0 text-marigold" aria-hidden />
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span id={nameId} className="font-display text-base font-semibold">
              {w.meta.name}
            </span>
            <span className={`chip !py-0 text-[0.68rem] ${real ? 'text-river' : 'text-dim'}`}>{real ? 'Built from real map data' : 'Fictional valley'}</span>
          </span>
          <span id={lineId} className="mt-0.5 block text-xs leading-snug text-muted">
            {worldSummary(w.meta)}
            {climate && <span className="mt-1 block text-[0.7rem] text-parchment" data-testid="world-climate-note">{climate}</span>}
          </span>
        </span>
      </label>
      <div className="pl-8">
        <MapDetails meta={w.meta} />
      </div>
    </div>
  )
}

function WorldPicker({ worlds, value, onChange }: { worlds: WorldEntry[]; value: string; onChange(id: string): void }) {
  return (
    <fieldset className="mt-4">
      <legend className="eyebrow mb-1.5">Choose a place</legend>
      <div className="grid gap-2" role="radiogroup">
        {worlds.map((w) => (
          <WorldCard key={w.meta.id} w={w} checked={value === w.meta.id} onChange={onChange} />
        ))}
      </div>
    </fieldset>
  )
}

export function Landing() {
  const hasSave = useGame((s) => s.hasSave)
  const busy = useGame((s) => s.busy)
  const loadError = useGame((s) => s.loadError)
  const loadErrorKind = useGame((s) => s.loadErrorKind)
  const { newGame, continueGame, discardSave, dismissLoadError } = useGame.getState()
  const game = useGameExports()
  const [worlds, setWorlds] = useState<WorldEntry[]>([])
  const [worldId, setWorldId] = useState<string | null>(null)
  const [howTo, setHowTo] = useState(false)
  const [seedText, setSeedText] = useState('')
  const [confirmNew, setConfirmNew] = useState(false)

  useEffect(() => {
    let alive = true
    listWorlds().then((w) => {
      if (!alive) return
      setWorlds(w)
      // a real place is the default when one is bundled; the fictional valley is always there too
      setWorldId((cur) => cur ?? w.find((x) => x.meta.kind === 'real-data-derived')?.meta.id ?? PROCEDURAL_WORLD_ID)
    })
    return () => {
      alive = false
    }
  }, [])

  const seed = seedText.trim() === '' ? undefined : Number(seedText)
  const seedValid = seed === undefined || (Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff)
  const start = () => {
    if (hasSave && !confirmNew) {
      setConfirmNew(true)
      return
    }
    setConfirmNew(false)
    void newGame(worldId ?? PROCEDURAL_WORLD_ID, seed)
  }
  const LandingScene = game?.LandingScene ?? null
  // the 3D scene behind the title shows the picked world, so its data credits must show too
  const shownId = worldId ?? PROCEDURAL_WORLD_ID
  const selectedReal = worlds.find((w) => w.meta.id === shownId && w.meta.kind === 'real-data-derived')?.meta.id ?? null

  return (
    <main className="relative h-full w-full overflow-hidden" aria-labelledby="title">
      <div className="absolute inset-0" aria-hidden>
        {LandingScene && (
          <CanvasBoundary fallback={null}>
            <Suspense fallback={null}>
              <LandingScene {...(worldId ? { worldId } : {})} />
            </Suspense>
          </CanvasBoundary>
        )}
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgb(23_18_13/0.92)_0%,rgb(23_18_13/0.72)_38%,rgb(23_18_13/0.05)_75%)]" />

      <div className="scroll-soft relative flex h-full flex-col overflow-y-auto px-6 py-8 sm:px-12 lg:w-[38rem]">
        <div className="anim-fade flex items-center gap-2 text-marigold">
          <Sprout size={22} aria-hidden />
          <span className="eyebrow !text-marigold">A watershed city-builder</span>
        </div>
        <h1 id="title" className="font-display anim-rise mt-3 text-7xl leading-none font-semibold tracking-tight italic sm:text-8xl">
          Amoria
        </h1>
        <p className="font-display anim-rise mt-3 text-2xl text-parchment">Build a city. Shape an ecosystem.</p>
        <p className="anim-rise mt-4 max-w-md text-base leading-relaxed text-muted">
          A small town in a dry river valley needs homes, food, water and work. Every road, field and forest you place changes where the rain goes, how the soil holds up and
          who does well when the drought comes. Play twenty years and find out what your plan really did.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary !px-5 !py-3 !text-base" onClick={start} disabled={busy || !seedValid}>
            <Play size={18} aria-hidden /> {confirmNew ? 'Yes, start a new valley' : 'Start building'}
          </button>
          {hasSave && (
            <button type="button" className="btn !px-5 !py-3 !text-base" onClick={() => void continueGame()} disabled={busy}>
              Continue <ArrowRight size={18} aria-hidden />
            </button>
          )}
        </div>
        {confirmNew && (
          <p className="mt-2 text-sm text-warn" role="alert">
            Starting over replaces your saved game in this browser.{' '}
            <button type="button" className="underline" onClick={() => setConfirmNew(false)}>
              Keep it
            </button>
          </p>
        )}
        {busy && (
          <p className="mt-2 text-sm text-muted" role="status">
            Preparing the valley...
          </p>
        )}
        {loadError && (
          <div className="panel mt-3 max-w-md p-3 text-sm" role="alert">
            <p className="font-semibold text-bad">That did not work.</p>
            <p className="mt-0.5 text-parchment">{loadError}</p>
            <div className="mt-2 flex gap-2">
              {hasSave && loadErrorKind === 'save' && (
                <button type="button" className="btn !py-1 text-xs" onClick={discardSave}>
                  Delete the damaged save
                </button>
              )}
              <button type="button" className="btn btn-ghost !py-1 text-xs" onClick={dismissLoadError}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        {worlds.length > 1 && <WorldPicker worlds={worlds} value={worldId ?? PROCEDURAL_WORLD_ID} onChange={setWorldId} />}
        {worlds.length === 1 && (
          <div className="mt-4 max-w-md text-xs text-muted">
            <p>
              <strong className="text-cream">{worlds[0].meta.name}:</strong> {worldSummary(worlds[0].meta)}
            </p>
            {genericClimateNote(worlds[0].meta) && <p className="mt-1 text-[0.7rem] text-parchment">{genericClimateNote(worlds[0].meta)}</p>}
            <MapDetails meta={worlds[0].meta} />
          </div>
        )}

        <section className="mt-6 max-w-md rounded-xl bg-black/25 p-4" aria-labelledby="why-h">
          <h2 id="why-h" className="font-display text-lg font-semibold">
            Why this game exists
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-parchment">
            Decisions about land, forests, farms and water shape communities for decades, but their effects are hard to see in advance. Amoria lets you try those decisions
            safely, see the consequences, and compare different futures for the same place. It was made for the UNCCD Hack for Social Impact 2026 challenge on engaging young
            people in land-use decisions.
          </p>
        </section>

        <div className="mt-3 max-w-md">
          <button type="button" className="btn btn-ghost !px-0 text-sm text-river" aria-expanded={howTo} onClick={() => setHowTo((v) => !v)}>
            <BookOpen size={16} aria-hidden /> {howTo ? 'Hide' : 'How to play'}
          </button>
          {howTo && (
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-parchment">
              <li>Look around. Click a parcel to see its soil, slope and water.</li>
              <li>Pick a tool from the bar at the bottom and place roads, homes, fields, forests or wetlands. Each has a price and a tradeoff.</li>
              <li>Advance time season by season. Watch food, water, soil and money respond.</li>
              <li>When something changes, open Insights to see why, with the numbers behind it.</li>
              <li>Save a run as Scenario A, try a different plan as Scenario B from the same start, and compare the two futures.</li>
            </ol>
          )}
        </div>

        <details className="mt-2 max-w-md text-sm">
          <summary className="cursor-pointer text-dim hover:text-cream">Classroom option: choose a weather seed</summary>
          <p className="mt-1 text-xs text-muted">Everyone who uses the same seed gets the same weather, so a class can compare plans fairly. Leave empty for a surprise.</p>
          <input
            className="field tabular mt-1.5 !w-48"
            inputMode="numeric"
            placeholder="Random"
            value={seedText}
            aria-invalid={!seedValid}
            aria-label="Weather seed"
            onChange={(e) => setSeedText(e.target.value.replace(/[^0-9]/g, ''))}
          />
          {!seedValid && <p className="mt-1 text-xs text-bad">Use a whole number up to 4294967295.</p>}
        </details>

        {selectedReal && <WorldAttribution worldId={selectedReal} className="mt-6 max-w-md" />}
        <p className="mt-auto pt-8 text-[0.7rem] text-dim">
          Free and non-commercial. No account needed; your game is saved only in this browser. The simulation is simplified and its numbers are illustrative.
        </p>
      </div>
    </main>
  )
}
