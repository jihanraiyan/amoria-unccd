// Brush and stroke cell selection for tools. Pure functions over grid indices.
import type { ToolId } from '../../state/store'

/**
 * Cells within a disc of `radius` cells around `center` (radius 0 = the centre only),
 * clipped to the grid. Uses the same disc rule as the UI's tool helpers
 * (dx^2 + dz^2 <= r^2 + r) so previews and committed actions agree.
 */
export function brushCells(center: number, radius: number, width: number, height: number): number[] {
  if (center < 0 || center >= width * height) return []
  const r = Math.max(0, Math.floor(radius))
  const cx = center % width
  const cz = Math.floor(center / width)
  const out: number[] = []
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > r * r + r) continue
      const x = cx + dx
      const z = cz + dz
      if (x < 0 || z < 0 || x >= width || z >= height) continue
      out.push(z * width + x)
    }
  }
  return out
}

/**
 * A 4-connected path of cells from `a` to `b` (inclusive). Roads need edge-adjacent cells
 * to connect, so the walk never moves diagonally. Steps alternate between axes in
 * proportion to the remaining distance, which gives a straight-looking staircase.
 */
export function lineCells(a: number, b: number, width: number, height: number): number[] {
  const n = width * height
  if (a < 0 || b < 0 || a >= n || b >= n) return []
  let x = a % width
  let z = Math.floor(a / width)
  const x1 = b % width
  const z1 = Math.floor(b / width)
  const dx = Math.abs(x1 - x)
  const dz = Math.abs(z1 - z)
  const sx = x1 > x ? 1 : -1
  const sz = z1 > z ? 1 : -1
  const out = [z * width + x]
  let movedX = 0
  let movedZ = 0
  while (x !== x1 || z !== z1) {
    // progress fraction along each axis; advance the one that is lagging
    const fx = dx === 0 ? 1 : (movedX + 0.5) / dx
    const fz = dz === 0 ? 1 : (movedZ + 0.5) / dz
    if (x !== x1 && (z === z1 || fx <= fz)) {
      x += sx
      movedX++
    } else {
      z += sz
      movedZ++
    }
    out.push(z * width + x)
  }
  return out
}

/** Union of cell lists, sorted ascending, without duplicates. */
export function unionCells(...lists: readonly (readonly number[])[]): number[] {
  const s = new Set<number>()
  for (const l of lists) for (const c of l) s.add(c)
  return Array.from(s).sort((p, q) => p - q)
}

export function sameCells(a: readonly number[] | null | undefined, b: readonly number[] | null | undefined): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** How a tool reacts to pointer input. */
export type ToolMode = 'inspect' | 'paint' | 'line' | 'single'

export function toolMode(tool: ToolId): ToolMode {
  switch (tool) {
    case 'inspect':
      return 'inspect'
    case 'road':
      return 'line'
    case 'waterworks':
    case 'market':
      return 'single'
    default:
      return 'paint'
  }
}

/** Cells a tool would affect for a hover (no drag) at `cell`. */
export function hoverCellsForTool(tool: ToolId, cell: number, brush: number, width: number, height: number): number[] {
  const mode = toolMode(tool)
  if (mode === 'inspect' || cell < 0) return []
  if (mode === 'line' || mode === 'single') return brushCells(cell, 0, width, height)
  return brushCells(cell, brush, width, height).sort((p, q) => p - q)
}

/**
 * Cells for a drag stroke. `path` is the sequence of cells the pointer visited.
 * Paint tools union a brush disc at every visited cell (and fill the gaps between
 * consecutive visits so fast drags do not skip cells). Line tools connect start to end.
 */
export function strokeCellsForTool(tool: ToolId, path: readonly number[], brush: number, width: number, height: number): number[] {
  const mode = toolMode(tool)
  if (mode === 'inspect' || path.length === 0) return []
  const last = path[path.length - 1]
  if (mode === 'single') return brushCells(last, 0, width, height)
  if (mode === 'line') return lineCells(path[0], last, width, height)
  const s = new Set<number>()
  for (let k = 0; k < path.length; k++) {
    const seg = k === 0 ? [path[0]] : lineCells(path[k - 1], path[k], width, height)
    for (const c of seg) for (const b of brushCells(c, brush, width, height)) s.add(b)
  }
  return Array.from(s).sort((p, q) => p - q)
}
