// Read-only access to the simulation's documented parameters (src/simulation/params.ts)
// for display: wellbeing weights, loan interest, scenario goals, the assumptions list.
// Reads are defensive so a renamed parameter shows "not available" instead of crashing.
import * as params from '../simulation/params'

const P = params as unknown as Record<string, unknown>

interface ParamLike<T> {
  value: T
  evidence?: string
  note?: string
}

function isParam(x: unknown): x is ParamLike<unknown> {
  return !!x && typeof x === 'object' && 'value' in x
}

function group(name: string): Record<string, unknown> | null {
  const g = P[name]
  return g && typeof g === 'object' ? (g as Record<string, unknown>) : null
}

const numRecord = (v: unknown): Record<string, number> | null => {
  if (!v || typeof v !== 'object') return null
  const out: Record<string, number> = {}
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return null
    out[k] = n
  }
  return out
}

export interface ParamInfo<T> {
  value: T
  evidence: string
  note: string
}

export function wellbeingWeights(): ParamInfo<Record<string, number>> | null {
  const w = P.WELLBEING_WEIGHTS
  if (!isParam(w)) return null
  const value = numRecord(w.value)
  return value ? { value, evidence: w.evidence ?? '', note: w.note ?? '' } : null
}

export function loanInterestPerSeason(): ParamInfo<number> | null {
  const e = group('ECON')?.interestPerSeason
  if (!isParam(e) || typeof e.value !== 'number') return null
  return { value: e.value, evidence: e.evidence ?? '', note: e.note ?? '' }
}

export interface ParamRow {
  group: string
  key: string
  evidence: string
  note: string
}

export function listParams(): ParamRow[] {
  const fn = P.listParameters
  if (typeof fn !== 'function') return []
  try {
    const rows = (fn as () => unknown)()
    return Array.isArray(rows)
      ? rows.filter((r): r is ParamRow => !!r && typeof r === 'object' && typeof (r as ParamRow).key === 'string')
      : []
  } catch {
    return []
  }
}
