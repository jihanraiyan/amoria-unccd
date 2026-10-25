// Maps the active tool plus its options to a PlayerAction. This is the only place
// where UI tool ids become simulation actions.
import type { ActionType, Intensity, PlayerAction } from '../simulation/types'

export type ToolId =
  | 'inspect'
  | 'road'
  | 'housing'
  | 'cropland'
  | 'set-intensity'
  | 'toggle-irrigation'
  | 'agroforestry'
  | 'clear'
  | 'reforest'
  | 'wetland'
  | 'conservation'
  | 'reservoir'
  | 'waterworks'
  | 'market'
  | 'demolish'

export const TOOL_IDS: readonly ToolId[] = [
  'inspect',
  'road',
  'housing',
  'cropland',
  'set-intensity',
  'toggle-irrigation',
  'agroforestry',
  'clear',
  'reforest',
  'wetland',
  'conservation',
  'reservoir',
  'waterworks',
  'market',
  'demolish',
]

export interface ToolOptions {
  /** Used by cropland and set-intensity. */
  intensity: Intensity
  /** Used by cropland: whether new fields are irrigated. */
  irrigated: boolean
}

export const DEFAULT_TOOL_OPTIONS: ToolOptions = { intensity: 'medium', irrigated: false }

export const MAX_BRUSH = 3

/** Builds the action for a tool over the given cells, or null for the inspect tool / empty input. */
export function buildToolAction(tool: ToolId, cells: readonly number[], options: ToolOptions): PlayerAction | null {
  if (tool === 'inspect' || cells.length === 0) return null
  const c = Array.from(new Set(cells)).sort((a, b) => a - b)
  switch (tool) {
    case 'cropland':
      return { type: 'cropland', cells: c, intensity: options.intensity, irrigated: options.irrigated }
    case 'set-intensity':
      return { type: 'set-intensity', cells: c, intensity: options.intensity }
    case 'road':
    case 'housing':
    case 'toggle-irrigation':
    case 'agroforestry':
    case 'clear':
    case 'reforest':
    case 'wetland':
    case 'conservation':
    case 'reservoir':
    case 'waterworks':
    case 'market':
    case 'demolish':
      return { type: tool, cells: c }
  }
}

/** Cells within a square-ish disc of `radius` around `center` (radius 0 = the center only). */
export function brushCells(center: number, radius: number, width: number, height: number): number[] {
  const cx = center % width
  const cz = Math.floor(center / width)
  const out: number[] = []
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dz * dz > radius * radius + radius) continue
      const x = cx + dx
      const z = cz + dz
      if (x < 0 || z < 0 || x >= width || z >= height) continue
      out.push(z * width + x)
    }
  }
  return out
}

/** Tools that act on one parcel at a time whatever the brush size (roads draw lines with the pointer). */
const SINGLE_CELL_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['road', 'waterworks', 'market'])

/** Parcels the active tool would affect at `cell` without a drag (pointer hover or keyboard cursor). */
export function toolCellsAt(tool: ToolId, cell: number, brush: number, width: number, height: number): number[] {
  if (tool === 'inspect' || cell < 0 || cell >= width * height) return []
  return brushCells(cell, SINGLE_CELL_TOOLS.has(tool) ? 0 : brush, width, height).sort((a, b) => a - b)
}

/** Past-tense phrases for feedback messages ("Built 3 parcels of housing"). */
export const ACTION_PHRASE: Record<ActionType, string> = {
  road: 'Built road on',
  housing: 'Built housing on',
  cropland: 'Planted cropland on',
  'set-intensity': 'Changed farming intensity on',
  'toggle-irrigation': 'Switched irrigation on',
  agroforestry: 'Planted agroforestry on',
  clear: 'Cleared vegetation on',
  reforest: 'Started reforestation on',
  wetland: 'Started wetland restoration on',
  conservation: 'Applied soil conservation on',
  reservoir: 'Built a reservoir on',
  waterworks: 'Built waterworks on',
  market: 'Built a market on',
  demolish: 'Demolished',
  loan: 'Took a loan',
  repay: 'Repaid debt',
  'set-levy': 'Set the cooperative levy',
}
