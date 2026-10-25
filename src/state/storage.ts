// Safe wrappers around localStorage. Private browsing, quota errors and disabled
// storage must never crash the game, so every call is guarded.

export const STORAGE_KEYS = {
  save: 'amoria.save.v1',
  settings: 'amoria.settings.v1',
  reflections: 'amoria.reflections.v1',
  tutorial: 'amoria.tutorial.v1',
} as const

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

export function readItem(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** Returns false when the browser refused the write (quota, privacy mode). */
export function writeItem(key: string, value: string): boolean {
  const s = storage()
  if (!s) return false
  try {
    s.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeItem(key: string): void {
  try {
    storage()?.removeItem(key)
  } catch {
    // ignore: nothing to clean up if storage is unavailable
  }
}

export function readJson(key: string): unknown {
  const raw = readItem(key)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}
