// Title screen: a short centred column over the live 3D valley. Name, place, start; the rest
// sits behind three small links.
import { ArrowRight } from 'lucide-react'
import { Suspense, useEffect, useState, type ReactNode } from 'react'
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

/** The picked map's longer notes: climate caveat, description and where the data comes from. */
function MapDetails({ meta }: { meta: WorldMeta }) {
  const climate = genericClimateNote(meta)
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer list-none text-muted underline-offset-2 hover:text-cream hover:underline focus-visible:text-cream focus-visible:underline focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        Map details: {meta.name}
      </summary>
      <div className="mt-2 space-y-1.5 rounded-xl bg-black/25 p-3 text-left leading-snug">
        {climate && (
          <p className="text-parchment" data-testid="world-climate-note">
            {climate}
          </p>
        )}
        <p className="text-muted">{meta.description}</p>
        <p className="text-dim">{meta.provenance}</p>
      </div>
    </details>
  )
}

/** One option of the place switch: the name, and whether it is real or made up. */
function WorldOption({ w, checked, onChange }: { w: WorldEntry; checked: boolean; onChange(id: string): void }) {
  const real = w.meta.kind === 'real-data-derived'
  const nameId = `world-${w.meta.id}-name`
  return (
    <label
      className={`flex cursor-pointer flex-col items-center rounded-[10px] px-3 py-2 text-center transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-marigold ${
        checked ? 'bg-cream text-ink' : 'text-parchment hover:bg-white/5'
      }`}
    >
      <input type="radio" name="world" className="sr-only" checked={checked} onChange={() => onChange(w.meta.id)} aria-labelledby={nameId} aria-describedby="world-line" />
      <span id={nameId} className="text-sm font-semibold">
        {w.meta.name}
      </span>
      <span className={`text-[0.7rem] ${checked ? 'text-ink/70' : 'text-muted'}`}>{real ? 'Built from real map data' : 'Fictional valley'}</span>
    </label>
  )
}

/** The place switch and one line about the picked place. */
function WorldPicker({ worlds, value, onChange }: { worlds: WorldEntry[]; value: string; onChange(id: string): void }) {
  const picked = worlds.find((w) => w.meta.id === value) ?? worlds[0]
  return (
    <fieldset className="w-full">
      <legend className="sr-only">Choose a place</legend>
      <div className="grid gap-1 rounded-xl bg-black/30 p-1" style={{ gridTemplateColumns: `repeat(${worlds.length}, minmax(0, 1fr))` }} role="radiogroup">
        {worlds.map((w) => (
          <WorldOption key={w.meta.id} w={w} checked={value === w.meta.id} onChange={onChange} />
        ))}
      </div>
      {picked && (
        <div className="mt-3 text-[0.8rem] leading-snug text-parchment">
          <p id="world-line">{worldSummary(picked.meta)}</p>
          <MapDetails meta={picked.meta} />
        </div>
      )}
    </fieldset>
  )
}

type Extra = 'how' | 'seed' | 'about'

/** Content behind one of the small links. Always mounted, so the seed field keeps its value. */
function ExtraPanel({ id, open, children }: { id: Extra; open: Extra | null; children: ReactNode }) {
  return (
    <div id={`extra-${id}`} hidden={open !== id} className="mt-3 w-full rounded-xl bg-black/25 p-4 text-left">
      {children}
    </div>
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
  const [seedText, setSeedText] = useState('')
  const [confirmNew, setConfirmNew] = useState(false)
  const [extra, setExtra] = useState<Extra | null>(null)

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

  const links: { id: Extra; label: string }[] = [
    { id: 'how', label: 'How to play' },
    { id: 'seed', label: 'Classroom seed' },
    { id: 'about', label: 'About' },
  ]

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
      <div className="pointer-events-none absolute inset-0 bg-ink/20" aria-hidden />

      <div className="scroll-soft relative flex h-full flex-col items-center overflow-y-auto px-4">
        <div className="glass anim-fade my-auto flex w-full max-w-md flex-col items-center px-6 py-8 text-center sm:px-8">
          <h1 id="title" className="text-5xl leading-none font-semibold tracking-tight sm:text-6xl">
            Amoria
          </h1>
          <p className="mt-3 text-lg text-parchment">Build a city. Shape an ecosystem.</p>

          <div className="mt-7 w-full">
            {worlds.length > 1 && <WorldPicker worlds={worlds} value={worldId ?? PROCEDURAL_WORLD_ID} onChange={setWorldId} />}
            {worlds.length === 1 && (
              <div className="text-[0.8rem] leading-snug text-parchment">
                <p>
                  <strong className="text-cream">{worlds[0].meta.name}:</strong> {worldSummary(worlds[0].meta)}
                </p>
                <MapDetails meta={worlds[0].meta} />
              </div>
            )}
          </div>

          <div className="mt-6 flex w-full flex-col gap-2">
            <button type="button" className="btn btn-primary w-full !py-3 !text-base" onClick={start} disabled={busy || !seedValid}>
              {confirmNew ? 'Yes, start a new valley' : 'Start building'}
            </button>
            {hasSave && (
              <button type="button" className="btn btn-ghost w-full !py-2.5" onClick={() => void continueGame()} disabled={busy}>
                Continue saved game <ArrowRight size={16} aria-hidden />
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
              Loading the valley
            </p>
          )}
          {loadError && (
            <div className="panel mt-3 w-full p-3 text-left text-sm" role="alert">
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

          <nav className="mt-5 flex items-center gap-1 text-sm" aria-label="More">
            {links.map((l, i) => (
              <span key={l.id} className="flex items-center gap-1">
                {i > 0 && <span className="text-dim" aria-hidden>·</span>}
                <button
                  type="button"
                  className={`rounded-md px-1.5 py-0.5 hover:text-cream ${extra === l.id ? 'text-cream' : 'text-parchment/80'}`}
                  aria-expanded={extra === l.id}
                  aria-controls={`extra-${l.id}`}
                  onClick={() => setExtra((v) => (v === l.id ? null : l.id))}
                >
                  {l.label}
                </button>
              </span>
            ))}
          </nav>
          <ExtraPanel id="how" open={extra}>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-parchment">
              <li>Look around. Click a parcel to see its soil, slope and water.</li>
              <li>Pick a tool from the bar at the bottom and place roads, homes, fields, forests or wetlands. Each has a price and a tradeoff.</li>
              <li>Advance time season by season. Watch food, water, soil and money respond.</li>
              <li>When something changes, open Insights to see why, with the numbers behind it.</li>
              <li>Save a run as Scenario A, try a different plan as Scenario B from the same start, and compare the two futures.</li>
            </ol>
          </ExtraPanel>
          <ExtraPanel id="seed" open={extra}>
            <p className="text-xs text-muted">Everyone who uses the same seed gets the same weather, so a class can compare plans fairly. Leave it empty for a surprise.</p>
            <input
              className="field tabular mt-2 !w-48"
              inputMode="numeric"
              placeholder="Random"
              value={seedText}
              aria-invalid={!seedValid}
              aria-label="Weather seed"
              onChange={(e) => setSeedText(e.target.value.replace(/[^0-9]/g, ''))}
            />
            {!seedValid && <p className="mt-1 text-xs text-bad">Use a whole number up to 4294967295.</p>}
          </ExtraPanel>
          <ExtraPanel id="about" open={extra}>
            <p className="text-sm leading-relaxed text-parchment">
              A small town in a dry river valley needs homes, food, water and work. Every road, field and forest you place changes where the rain goes, how well the soil
              holds, and who copes when the drought comes. Amoria lets you try those decisions safely and compare different futures for the same place. Made for the UNCCD
              Hack for Social Impact 2026 challenge on engaging young people in land-use decisions.
            </p>
          </ExtraPanel>

          <footer className="mt-6 w-full border-t border-[rgb(247_238_220/0.12)] pt-4 text-[0.68rem] leading-snug text-muted">
            <p>Free, no account needed. Your game is saved only in this browser. Numbers are illustrative.</p>
            {selectedReal && <WorldAttribution worldId={selectedReal} className="mt-1 !bg-transparent !p-0 !text-dim" />}
          </footer>
        </div>
      </div>
    </main>
  )
}
