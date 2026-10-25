// Shared helpers for UI/store tests.
import { coverName, type SimulationState } from '../../src/simulation/types'
import { DEFAULT_TOOL_OPTIONS, type ToolId } from '../../src/state/toolActions'
import { validateToolAt } from '../../src/state/toolProbe'

/** First parcel where `tool` fully validates (placement and budget), preferring the given covers. */
export function findValidCell(sim: SimulationState, tool: ToolId, prefer: string[] = []): number {
  const n = sim.terrain.width * sim.terrain.height
  let fallback = -1
  for (let i = 0; i < n; i++) {
    const v = validateToolAt(sim, tool, [i], DEFAULT_TOOL_OPTIONS)
    if (!v?.ok) continue
    if (!prefer.length || prefer.includes(coverName(sim.layers.cover[i]))) return i
    if (fallback < 0) fallback = i
  }
  if (fallback < 0) throw new Error(`no valid cell for ${tool}`)
  return fallback
}

/** jsdom has no WebGL; pretend it exists so the (mocked) world mounts. 2D stays unavailable. */
export function stubWebGL(): void {
  const proto = HTMLCanvasElement.prototype as unknown as { getContext: (id: string) => unknown }
  proto.getContext = (id: string) => (id === 'webgl' || id === 'webgl2' ? {} : null)
}
