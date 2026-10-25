// Mood per season and weather: sky gradient, fog, sun and fill light. Pure data so it can be
// tested and blended. Drought reads hot and hazy, heavy rain grey and close, the wet season
// clear and fresh, the dry season golden.
import { Color } from 'three'
import type { Season } from '../../simulation/types'
import type { WeatherKind } from '../core/frame'
import { CAMERA_LIMITS } from '../controls/cameraMath'

export interface Mood {
  skyTop: Color
  skyHorizon: Color
  fog: Color
  fogNear: number
  fogFar: number
  sun: Color
  sunIntensity: number
  hemiSky: Color
  hemiGround: Color
  hemiIntensity: number
  /** 0..1 rain particle strength */
  rain: number
  /** 0..1 dust haze strength */
  dust: number
}

const c = (hex: string) => new Color(hex)

export function moodFor(season: Season, weather: WeatherKind): Mood {
  const wet = season === 'wet'
  const base: Mood = wet
    ? {
        skyTop: c('#7fb0d6'),
        skyHorizon: c('#f1dfc4'),
        fog: c('#e6dccb'),
        fogNear: 75,
        fogFar: 230,
        sun: c('#fff0d6'),
        sunIntensity: 2.6,
        hemiSky: c('#cfe2f0'),
        hemiGround: c('#7a6648'),
        hemiIntensity: 1.15,
        rain: 0.18,
        dust: 0,
      }
    : {
        skyTop: c('#93b7cf'),
        skyHorizon: c('#f4d9aa'),
        fog: c('#ecd8b4'),
        fogNear: 70,
        fogFar: 220,
        sun: c('#ffe2b0'),
        sunIntensity: 2.8,
        hemiSky: c('#dfe4e2'),
        hemiGround: c('#8a6a44'),
        hemiIntensity: 1.05,
        rain: 0,
        dust: 0.2,
      }
  switch (weather) {
    case 'drought':
      return {
        ...base,
        skyTop: c('#b4b9b0'),
        skyHorizon: c('#e9c58e'),
        fog: c('#dfbf8c'),
        fogNear: 40,
        fogFar: 165,
        sun: c('#ffc98a'),
        sunIntensity: 3.0,
        hemiSky: c('#e6d7b8'),
        hemiGround: c('#8f6a40'),
        rain: 0,
        dust: 1,
      }
    case 'heavy-rain':
      return {
        ...base,
        skyTop: c('#6e7c88'),
        skyHorizon: c('#b9bcb5'),
        fog: c('#a9afab'),
        fogNear: 32,
        fogFar: 150,
        sun: c('#d9dde0'),
        sunIntensity: 1.25,
        hemiSky: c('#b7c2c9'),
        hemiGround: c('#5a5246'),
        hemiIntensity: 1.25,
        rain: 1,
        dust: 0,
      }
    case 'favorable':
      return { ...base, skyTop: c('#73acd9'), sunIntensity: base.sunIntensity + 0.15, rain: wet ? 0.12 : 0, dust: 0 }
    default:
      return base
  }
}

/** Blend `cur` toward `target` in place by factor k (0..1). */
export function blendMood(cur: Mood, target: Mood, k: number): void {
  for (const key of ['skyTop', 'skyHorizon', 'fog', 'sun', 'hemiSky', 'hemiGround'] as const) cur[key].lerp(target[key], k)
  for (const key of ['fogNear', 'fogFar', 'sunIntensity', 'hemiIntensity', 'rain', 'dust'] as const) cur[key] += (target[key] - cur[key]) * k
}

export function cloneMood(m: Mood): Mood {
  return {
    ...m,
    skyTop: m.skyTop.clone(),
    skyHorizon: m.skyHorizon.clone(),
    fog: m.fog.clone(),
    sun: m.sun.clone(),
    hemiSky: m.hemiSky.clone(),
    hemiGround: m.hemiGround.clone(),
  }
}

/** Direction toward the sun (unnormalised); the light sits at this times the map half-size. */
export const SUN_DIR_RAW: [number, number, number] = [0.75, 1.2, 0.55]

/**
 * Half-size of the orthographic shadow camera for a map of half-size `extent`. The light looks
 * at the map diagonally, so the map's footprint seen from the light is up to sqrt 2 times wider
 * than the map itself.
 */
export function shadowHalfExtent(extent: number): number {
  return extent * Math.SQRT2 * 1.05
}

/** Sky color reflected by water: the horizon with a little fog, so overcast and haze dull it. */
export function waterSkyColor(m: Mood, out: Color): Color {
  return out.copy(m.skyHorizon).lerp(m.fog, 0.35).lerp(m.skyTop, 0.25)
}

/** Sun glint strength on water, scaled by the sun's intensity (2.6 is a clear wet day). */
export function waterGlint(m: Mood): number {
  return Math.min(1.2, Math.max(0, m.sunIntensity / 2.6)) ** 1.5
}

/**
 * Fog range while an overlay is shown. Heavy rain and drought pull the fog in (near 32 and 40),
 * which would wash overlay colors away from their legend swatches exactly in the seasons players
 * check erosion, runoff and floods. At full overlay mix the fog starts beyond the farthest point
 * of the map the camera can see (the camera stays within maxDistance of a target inside the
 * map, so nothing is farther than maxDistance plus the map diagonal), so no overlay pixel is
 * fogged. `mix` is the eased overlay presence (0..1).
 */
export function overlayFogRange(near: number, far: number, extent: number, mix: number): [number, number] {
  const m = Math.min(1, Math.max(0, mix))
  const clearNear = CAMERA_LIMITS.maxDistance + 2 * Math.SQRT2 * extent
  const clearFar = clearNear * 1.6
  return [near + (Math.max(near, clearNear) - near) * m, far + (Math.max(far, clearFar) - far) * m]
}

/** Linear fog factor three applies at a distance (0 = clear, 1 = fully fogged). */
export function linearFog(distance: number, near: number, far: number): number {
  return Math.min(1, Math.max(0, (distance - near) / Math.max(1e-6, far - near)))
}

/** Rain column top above the ground under the view (matches the rain shader's uHeight). */
export const RAIN_COLUMN = 28
/** Dust layer starts this far above the ground so its faded lower band is not buried. */
export const DUST_LIFT = 0.4

/**
 * Base heights for the weather particles at the look point: the rain column and the dust
 * layer start on the drawn ground there (not at world y = 0), so on high ground neither is
 * buried in the terrain. Without terrain (the landing sky before a world loads) they sit at 0.
 */
export function particleBases(ground: number | null): { rainY: number; dustY: number } {
  const g = ground === null || !Number.isFinite(ground) ? 0 : ground
  return { rainY: g, dustY: g + DUST_LIFT }
}

/** Frame-rate independent ease of the particle base toward the ground under a moving view. */
export function easeBase(cur: number, target: number, dt: number, instant: boolean): number {
  if (instant || !Number.isFinite(cur)) return target
  const k = 1 - Math.exp(-Math.max(0, dt) * 4)
  return cur + (target - cur) * k
}
