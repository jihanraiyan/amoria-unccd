// Shared fixtures for simulation tests.
import { readFileSync } from 'node:fs'
import { parseWorldText } from '../../data/worldFile'
import { applyAction, createInitialState } from '../engine'
import { mulberry32 } from '../rng'
import type { PlayerAction, SimulationState, WeatherSeason } from '../types'
import { INTENSITIES } from '../types'
import { generateProceduralWorld } from '../world/procedural'
import { C, S } from '../models/cells'

export const WORLD = generateProceduralWorld(1)
export const SEED = 42

/** The real-data Kaani (Machakos) map players start on, read from the exported world file on disk. */
export const KAANI_WORLD = parseWorldText(readFileSync(new URL('../../../public/world-data/kaani-machakos.json', import.meta.url), 'utf8'), 'kaani-machakos')

let cached: SimulationState | null = null
/** Fresh initial state (cached; engine never mutates, so sharing is safe). */
export function initial(): SimulationState {
  cached ??= createInitialState(WORLD, SEED)
  return cached
}

export function cells(s: SimulationState, pred: (i: number) => boolean): number[] {
  const out: number[] = []
  for (let i = 0; i < s.layers.cover.length; i++) if (pred(i)) out.push(i)
  return out
}

/** A state with lots of budget, for tests that are not about money. */
export function rich(s: SimulationState): SimulationState {
  return { ...s, economy: { ...s.economy, budget: 5_000_000 } }
}

/** Apply and require success. */
export function must(s: SimulationState, a: PlayerAction): SimulationState {
  const r = applyAction(s, a)
  if (!r.validation.ok) throw new Error(`action ${a.type} rejected: ${r.validation.reasons.join('; ')}`)
  return r.state
}

export function withWeather(s: SimulationState, w: Partial<WeatherSeason>): SimulationState {
  const weather = s.weather.slice()
  weather[s.step] = { ...weather[s.step], ...w }
  return { ...s, weather }
}

export const findWeather = (s: SimulationState, kind: WeatherSeason['kind'], season: WeatherSeason['season']) => s.weather.find((w) => w.kind === kind && w.season === season)!

/** Seeded random agent: picks a random action type and random nearby cells each step. */
export function randomAction(s: SimulationState, rnd: () => number): PlayerAction {
  const types = ['road', 'housing', 'cropland', 'set-intensity', 'toggle-irrigation', 'agroforestry', 'clear', 'reforest', 'wetland', 'conservation', 'reservoir', 'waterworks', 'market', 'demolish', 'loan', 'repay'] as const
  const t = types[Math.floor(rnd() * types.length)]
  if (t === 'loan') return { type: 'loan', amount: Math.round(rnd() * 80_000) + 1000 }
  if (t === 'repay') return { type: 'repay', amount: Math.round(rnd() * 50_000) + 1000 }
  const n = s.layers.cover.length
  const centre = Math.floor(rnd() * n)
  const r = 1 + Math.floor(rnd() * 3)
  const w = s.terrain.width
  const cx = centre % w
  const cz = Math.floor(centre / w)
  const cs: number[] = []
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const x = cx + dx
    const z = cz + dz
    if (x >= 0 && z >= 0 && x < w && z < s.terrain.height) cs.push(z * w + x)
  }
  if (t === 'cropland') return { type: 'cropland', cells: cs, intensity: INTENSITIES[Math.floor(rnd() * 3)], irrigated: rnd() < 0.3 }
  if (t === 'set-intensity') return { type: 'set-intensity', cells: cs, intensity: INTENSITIES[Math.floor(rnd() * 3)] }
  return { type: t, cells: cs } as PlayerAction
}

export function allFinite(o: unknown, path = 'state', out: string[] = []): string[] {
  if (typeof o === 'number') {
    if (!Number.isFinite(o)) out.push(path)
  } else if (ArrayBuffer.isView(o)) {
    const a = o as unknown as ArrayLike<number>
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) {
      out.push(`${path}[${i}]`)
      break
    }
  } else if (Array.isArray(o)) o.forEach((v, i) => allFinite(v, `${path}[${i}]`, out))
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) allFinite(v, `${path}.${k}`, out)
  return out
}

export const seeded = (seed: number) => mulberry32(seed)
export { C, S }
