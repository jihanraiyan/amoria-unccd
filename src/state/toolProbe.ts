// Read-only questions the interface asks the engine about tools: "what would this cost
// here?", "is there anywhere this tool can be used right now?". Nothing here changes state.
import { validateAction } from '../simulation/engine'
import { INTENSITIES, coverCode, type ActionValidation, type Intensity, type SimulationState } from '../simulation/types'
import { buildToolAction, type ToolId, type ToolOptions } from './toolActions'

export interface ToolAvailability {
  /** True if at least one parcel accepts this tool right now (budget aside). */
  placeable: boolean
  /** True if a single-parcel use passes full validation, budget included. */
  affordable: boolean
  /** Cheapest and dearest single-parcel cost seen among valid parcels. */
  minCost: number | null
  maxCost: number | null
  /** Why it cannot be used, when it cannot. */
  reason: string | null
}

export function validateToolAt(sim: SimulationState, tool: ToolId, cells: number[], options: ToolOptions): ActionValidation | null {
  const action = buildToolAction(tool, cells, options)
  return action ? validateAction(sim, action) : null
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}
function coprimeStride(n: number): number {
  let s = 97
  while (n > 1 && gcd(s, n) !== 1) s++
  return s
}

/** Cropland parcels at each intensity level, in INTENSITIES order. */
export function intensityCounts(sim: SimulationState): Record<Intensity, number> {
  const crop = coverCode('cropland')
  const counts: Record<Intensity, number> = { low: 0, medium: 0, high: 0 }
  const { cover, intensity } = sim.layers
  for (let i = 0; i < cover.length; i++) {
    if (cover[i] !== crop) continue
    const lvl = INTENSITIES[intensity[i]]
    if (lvl) counts[lvl]++
  }
  return counts
}

/**
 * Intensity the Farming intensity tool should start on: the current option if some field
 * is not at that level yet, otherwise a level that differs from the most common one
 * (high when most fields are medium, so intensification is one click away).
 */
export function suggestedIntensity(sim: SimulationState, current: Intensity): Intensity {
  const counts = intensityCounts(sim)
  const total = counts.low + counts.medium + counts.high
  if (total === 0 || counts[current] < total) return current
  const common = INTENSITIES.reduce((a, b) => (counts[b] > counts[a] ? b : a))
  return common === 'high' ? 'medium' : common === 'medium' ? 'high' : 'medium'
}

/** Reasons the engine gives for every parcel; never shown as a tool-level explanation. */
const MAP_REASONS = new Set(['Protected land (forest reserve or map edge)', 'River channel', 'Outside the map'])
const CROPLAND_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['set-intensity', 'toggle-irrigation'])

const cache = new WeakMap<SimulationState, Map<string, ToolAvailability>>()
const SAMPLE_COSTS = 12

function scan(sim: SimulationState, tool: ToolId, options: ToolOptions): ToolAvailability {
  const n = sim.terrain.width * sim.terrain.height
  let minCost: number | null = null
  let maxCost: number | null = null
  let affordable = false
  let found = 0
  let budgetReason: string | null = null
  const tally = new Map<string, number>()
  // visit every parcel in a scattered order so cost samples span the whole map
  const stride = coprimeStride(n)
  for (let k = 0; k < n && found < SAMPLE_COSTS; k++) {
    const i = (k * stride) % n
    const v = validateToolAt(sim, tool, [i], options)
    if (!v) break
    if (v.cellOk[0]) {
      found++
      if (v.cost > 0) {
        minCost = minCost === null ? v.cost : Math.min(minCost, v.cost)
        maxCost = maxCost === null ? v.cost : Math.max(maxCost, v.cost)
      }
      if (v.ok) affordable = true
      else if (!budgetReason) budgetReason = v.reasons[0] ?? 'Not enough budget.'
    } else {
      const r = v.cellReasons?.[0] || v.reasons[0]
      if (r) tally.set(r, (tally.get(r) ?? 0) + 1)
    }
  }
  const placeable = found > 0
  return {
    placeable,
    affordable,
    minCost,
    maxCost,
    reason: !placeable ? toolReason(sim, tool, tally) : affordable ? null : budgetReason,
  }
}

/** A reason that describes the tool as a whole: the most common parcel-level reason that is not about the map edge. */
function toolReason(sim: SimulationState, tool: ToolId, tally: Map<string, number>): string {
  if (CROPLAND_TOOLS.has(tool)) {
    const c = intensityCounts(sim)
    if (c.low + c.medium + c.high === 0) return 'No cropland yet. Plant fields first.'
  }
  let best: string | null = null
  let bestCount = 0
  for (const [r, k] of tally) {
    if (MAP_REASONS.has(r)) continue
    if (k > bestCount) {
      best = r
      bestCount = k
    }
  }
  return best ? `Nowhere right now. Most parcels: ${best.charAt(0).toLowerCase()}${best.slice(1)}.` : 'No parcel accepts this right now.'
}

function cached(sim: SimulationState, tool: ToolId, options: ToolOptions): ToolAvailability {
  const key = `${tool}|${options.intensity}|${options.irrigated}`
  let perState = cache.get(sim)
  if (!perState) {
    perState = new Map()
    cache.set(sim, perState)
  }
  const hit = perState.get(key)
  if (hit) return hit
  const result = scan(sim, tool, options)
  perState.set(key, result)
  return result
}

/**
 * Scans parcels for one where the tool is placeable. Results are cached per state object,
 * and states are immutable, so the scan reruns only after an action or a step.
 *
 * Farming intensity is judged across all three levels: a field can always be moved to a
 * level it is not at yet, so the tool is never disabled just because of the chosen level.
 */
export function toolAvailability(sim: SimulationState, tool: ToolId, options: ToolOptions): ToolAvailability {
  if (tool === 'inspect') return { placeable: true, affordable: true, minCost: null, maxCost: null, reason: null }
  if (tool !== 'set-intensity') return cached(sim, tool, options)
  const current = cached(sim, tool, options)
  if (current.placeable) return current
  const others = INTENSITIES.filter((lvl) => lvl !== options.intensity).map((lvl) => cached(sim, tool, { ...options, intensity: lvl }))
  const open = others.filter((a) => a.placeable)
  if (!open.length) return current
  const costs = open.flatMap((a) => [a.minCost, a.maxCost]).filter((c): c is number => c !== null)
  const affordable = open.some((a) => a.affordable)
  return {
    placeable: true,
    affordable,
    minCost: costs.length ? Math.min(...costs) : null,
    maxCost: costs.length ? Math.max(...costs) : null,
    reason: affordable ? null : (open[0].reason ?? 'Not enough budget.'),
  }
}
