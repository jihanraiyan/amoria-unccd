import { STORAGE_KEYS, readJson, writeItem } from './storage'

export interface Settings {
  quality: 'high' | 'low'
  reducedMotion: boolean
  /** Swap red/green status colors for a blue/orange palette that reads under common color-vision deficiencies. */
  colorblind: boolean
  /** Multiplier on the root font size, 0.85 to 1.3. */
  uiScale: number
  /** Stop play when a season brings critical news (homes flooded, unpaid bills, a drought starting). */
  pauseOnEvents: boolean
}

export const UI_SCALE_MIN = 0.85
export const UI_SCALE_MAX = 1.3

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  } catch {
    return false
  }
}

export function defaultSettings(): Settings {
  return { quality: 'high', reducedMotion: prefersReducedMotion(), colorblind: false, uiScale: 1, pauseOnEvents: true }
}

const clampScale = (v: number) => Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, v))

/** Accepts any value and returns valid settings, filling gaps from defaults. */
export function sanitizeSettings(raw: unknown, base: Settings = defaultSettings()): Settings {
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>
  return {
    quality: r.quality === 'low' || r.quality === 'high' ? r.quality : base.quality,
    reducedMotion: typeof r.reducedMotion === 'boolean' ? r.reducedMotion : base.reducedMotion,
    colorblind: typeof r.colorblind === 'boolean' ? r.colorblind : base.colorblind,
    uiScale: typeof r.uiScale === 'number' && Number.isFinite(r.uiScale) ? clampScale(r.uiScale) : base.uiScale,
    pauseOnEvents: typeof r.pauseOnEvents === 'boolean' ? r.pauseOnEvents : base.pauseOnEvents,
  }
}

export function loadSettings(): Settings {
  return sanitizeSettings(readJson(STORAGE_KEYS.settings))
}

export function persistSettings(s: Settings): boolean {
  return writeItem(STORAGE_KEYS.settings, JSON.stringify(s))
}
