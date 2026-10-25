// Exogenous weather: a deterministic seeded season sequence generated ONCE at game start.
// It never reads player state, so two players with the same seed face the same droughts and
// storms; their land-use choices only change how vulnerable they are.
//
// The guided scenario adds scenario design on top of the random draws (documented in
// docs/MODEL_ASSUMPTIONS.md): two calm opening years, a guaranteed 3-season drought and a
// guaranteed heavy-rain wet season within the 20-year horizon. Designed seasons are flagged.
import { CLIMATE, TIME } from '../params'
import { STREAM, stream } from '../rng'
import type { Season, WeatherSeason } from '../types'

type Kind = WeatherSeason['kind']

export interface WeatherOptions {
  years?: number
  /** Apply guided-scenario design within this horizon (0 disables). */
  guidedHorizonYears?: number
}

interface Draw {
  uKind: number
  uRain: number
  uPet: number
  uInt: number
}

/** Seasonal values for a kind, from fixed uniform draws (so overriding a kind stays deterministic). */
export function seasonValues(season: Season, kind: Kind, d: Pick<Draw, 'uRain' | 'uPet' | 'uInt'>) {
  const k = CLIMATE.kinds.value[kind]
  const normalRain = CLIMATE.rainMm.value[season]
  const rainfallMm = Math.max(0, normalRain * k.rain * (1 + k.rainNoise * (d.uRain * 2 - 1)))
  const petMm = CLIMATE.petMm.value[season] * k.pet * (1 + k.petNoise * (d.uPet * 2 - 1))
  const stormIntensity = Math.max(0.5, k.intensity * (1 + k.intensityNoise * (d.uInt * 2 - 1)))
  return { rainfallMm, petMm, stormIntensity, normalRainfallMm: normalRain }
}

function drawKind(season: Season, prev: Kind | null, u: number): Kind {
  const t = CLIMATE.transition.value[season][prev === 'drought' ? 'afterDrought' : 'otherwise']
  let acc = 0
  for (const kind of ['drought', 'heavy-rain', 'favorable'] as const) {
    acc += t[kind]
    if (u < acc) return kind
  }
  return 'normal'
}

/**
 * Generate the full season sequence. Prefix-stable: generating more years never changes
 * earlier seasons, so the sandbox can be extended without altering the guided run.
 */
export function generateWeather(seed: number, opts: WeatherOptions = {}): WeatherSeason[] {
  const years = opts.years ?? TIME.weatherYears.value
  const guided = opts.guidedHorizonYears ?? TIME.horizonYears.value
  const rnd = stream(seed, STREAM.weather)
  const draws: Draw[] = []
  const kinds: Kind[] = []
  for (let s = 0; s < years * 2; s++) {
    const d = { uKind: rnd(), uRain: rnd(), uPet: rnd(), uInt: rnd() }
    draws.push(d)
    const season: Season = s % 2 === 0 ? 'wet' : 'dry'
    kinds.push(drawKind(season, s > 0 ? kinds[s - 1] : null, d.uKind))
  }
  const designed = new Uint8Array(kinds.length)
  if (guided > 0) applyGuidedDesign(seed, kinds, designed, Math.min(guided, years))
  return kinds.map((kind, s) => {
    const season: Season = s % 2 === 0 ? 'wet' : 'dry'
    return { year: Math.floor(s / 2) + 1, season, kind, designed: designed[s] === 1, ...seasonValues(season, kind, draws[s]) }
  })
}

/** Scenario design for the guided horizon (pure function of the seed). */
function applyGuidedDesign(seed: number, kinds: Kind[], designed: Uint8Array, horizon: number): void {
  const g = CLIMATE.guided.value
  const rnd = stream(seed, STREAM.weatherDesign)
  // calm opening so new players can learn before the first shock
  for (let s = 0; s < g.graceYears * 2 && s < kinds.length; s++) {
    if (kinds[s] === 'drought' || kinds[s] === 'heavy-rain') {
      kinds[s] = 'normal'
      designed[s] = 1
    }
  }
  const [dLo, dHi] = g.droughtStartYear
  const droughtYear = Math.min(horizon - 1, dLo + Math.floor(rnd() * (dHi - dLo + 1)))
  const dStart = (droughtYear - 1) * 2 // a wet season
  for (let s = dStart; s < dStart + g.droughtSeasons && s < kinds.length; s++) {
    kinds[s] = 'drought'
    designed[s] = 1
  }
  // the season after the designed drought breaks it (no accidental 4th season)
  const after = dStart + g.droughtSeasons
  if (after < kinds.length && kinds[after] === 'drought') {
    kinds[after] = 'normal'
    designed[after] = 1
  }
  const [hLo, hHi] = g.heavyRainYear
  const allowed: number[] = []
  for (let y = hLo; y <= hHi; y++) {
    const s = (y - 1) * 2
    if (s >= dStart - 1 && s <= after) continue
    allowed.push(y)
  }
  const heavyYear = allowed[Math.floor(rnd() * allowed.length)] ?? hLo
  const hs = (heavyYear - 1) * 2
  if (hs < kinds.length) {
    kinds[hs] = 'heavy-rain'
    designed[hs] = 1
  }
}

/** Weather for a step; extends deterministically past the stored sequence if ever needed. */
export function weatherForStep(seed: number, weather: WeatherSeason[], step: number, guidedHorizonYears: number): WeatherSeason {
  if (step < weather.length) return weather[step]
  const years = Math.ceil((step + 1) / 2) + 10
  return generateWeather(seed, { years, guidedHorizonYears })[step]
}

/** Count of designed and drawn extreme seasons within a range, for reports. */
export function summarizeWeather(weather: WeatherSeason[], fromStep: number, toStep: number) {
  const out = { drought: 0, 'heavy-rain': 0, favorable: 0, normal: 0, longestDrought: 0 }
  let run = 0
  for (let s = fromStep; s < Math.min(toStep, weather.length); s++) {
    out[weather[s].kind]++
    run = weather[s].kind === 'drought' ? run + 1 : 0
    out.longestDrought = Math.max(out.longestDrought, run)
  }
  return out
}
