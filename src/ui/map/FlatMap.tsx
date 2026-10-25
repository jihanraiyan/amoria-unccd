// Playable flat map of the live valley, used when the 3D view cannot run (no WebGL, or the
// renderer failed). It paints land cover and buildings from the store, previews the active
// tool the same way the 3D view does (blue = can build, orange with stripes = cannot), and
// sends hover, selection and building through the same store calls as the 3D view.
import { useEffect, useRef } from 'react'
import { lineCells } from '../../game/core/brush'
import { useGame } from '../../state/store'
import { toolCellsAt } from '../../state/toolActions'
import { COVER_COLORS } from '../compare/MiniMap'
import { LandCoverLegend, PREVIEW_INVALID as INVALID, PREVIEW_VALID as VALID, STRUCTURE_COLOR } from './LandCoverLegend'

const SCALE = 8

function useDraw(ref: React.RefObject<HTMLCanvasElement | null>) {
  const sim = useGame((s) => s.sim)
  const view = useGame((s) => s.viewSnapshot)
  const preview = useGame((s) => s.preview)
  const selected = useGame((s) => s.selectedCell)
  const hover = useGame((s) => s.hoverCell)
  useEffect(() => {
    const c = ref.current
    const ctx = c?.getContext?.('2d')
    if (!c || !ctx || !sim) return
    const { width, height, elevationM } = sim.terrain
    const layers = (view ?? sim).layers
    let lo = Infinity
    let hi = -Infinity
    for (const e of elevationM) {
      lo = Math.min(lo, e)
      hi = Math.max(hi, e)
    }
    const span = Math.max(1e-6, hi - lo)
    for (let i = 0; i < width * height; i++) {
      const hex = layers.structure[i] > 0 ? STRUCTURE_COLOR : (COVER_COLORS[layers.cover[i]] ?? '#000000')
      const v = parseInt(hex.slice(1), 16)
      const k = 0.7 + 0.3 * ((elevationM[i] - lo) / span)
      ctx.fillStyle = `rgb(${((v >> 16) & 255) * k} ${((v >> 8) & 255) * k} ${(v & 255) * k})`
      ctx.fillRect((i % width) * SCALE, Math.floor(i / width) * SCALE, SCALE, SCALE)
    }
    if (preview) {
      preview.cells.forEach((cell, j) => {
        const x = (cell % width) * SCALE
        const z = Math.floor(cell / width) * SCALE
        const ok = preview.validation.cellOk[j]
        ctx.fillStyle = ok ? VALID : INVALID
        ctx.fillRect(x, z, SCALE, SCALE)
        if (!ok) {
          // diagonal stripes so invalid parcels read without color
          ctx.strokeStyle = 'rgba(23, 18, 13, 0.85)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(x, z + SCALE)
          ctx.lineTo(x + SCALE, z)
          ctx.moveTo(x, z + SCALE / 2)
          ctx.lineTo(x + SCALE / 2, z)
          ctx.moveTo(x + SCALE / 2, z + SCALE)
          ctx.lineTo(x + SCALE, z + SCALE / 2)
          ctx.stroke()
        }
      })
    }
    const outline = (cell: number | null, color: string, w: number) => {
      if (cell === null || cell < 0) return
      ctx.strokeStyle = color
      ctx.lineWidth = w
      ctx.strokeRect((cell % width) * SCALE + w / 2, Math.floor(cell / width) * SCALE + w / 2, SCALE - w, SCALE - w)
    }
    outline(hover, 'rgba(247, 238, 220, 0.9)', 1)
    outline(selected, '#f4ae3f', 2)
  }, [ref, sim, view, preview, selected, hover])
}

export function FlatMap() {
  const ref = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ start: number; cells: Set<number> } | null>(null)
  const sim = useGame((s) => s.sim)
  const tool = useGame((s) => s.tool)
  const overlay = useGame((s) => s.overlay)
  useDraw(ref)
  if (!sim) return null
  const { width, height } = sim.terrain

  const cellAt = (clientX: number, clientY: number): number => {
    const r = ref.current?.getBoundingClientRect()
    if (!r || r.width <= 0 || r.height <= 0) return -1
    const x = Math.floor(((clientX - r.left) / r.width) * width)
    const z = Math.floor(((clientY - r.top) / r.height) * height)
    return x < 0 || z < 0 || x >= width || z >= height ? -1 : z * width + x
  }
  const strokeCells = (start: number, cell: number, visited: Set<number>): number[] => {
    const g = useGame.getState()
    if (g.tool === 'road') return lineCells(start, cell, width, height)
    const out = new Set<number>()
    for (const c of visited) for (const b of toolCellsAt(g.tool, c, g.brush, width, height)) out.add(b)
    return [...out].sort((a, b) => a - b)
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <canvas
        ref={ref}
        width={width * SCALE}
        height={height * SCALE}
        tabIndex={0}
        role="application"
        aria-label={`Flat map of ${sim.meta.name}. Arrow keys move the parcel cursor, Enter applies the active tool. Current tool: ${tool}.`}
        data-testid="flat-map"
        className="aspect-square w-[min(calc(100vh-15rem),calc(100vw-2rem))] max-w-full cursor-crosshair touch-none rounded-xl border border-[var(--panel-line)] [image-rendering:pixelated]"
        onPointerMove={(e) => {
          const g = useGame.getState()
          const cell = cellAt(e.clientX, e.clientY)
          g.setHoverCell(cell >= 0 ? cell : null)
          if (cell < 0) return
          const d = drag.current
          if (d) {
            d.cells.add(cell)
            g.setPreviewCells(strokeCells(d.start, cell, d.cells))
          } else if (g.tool !== 'inspect') g.setPreviewCells(toolCellsAt(g.tool, cell, g.brush, width, height))
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          const cell = cellAt(e.clientX, e.clientY)
          if (cell < 0) return
          if (useGame.getState().tool !== 'inspect') drag.current = { start: cell, cells: new Set([cell]) }
        }}
        onPointerUp={(e) => {
          const g = useGame.getState()
          const cell = cellAt(e.clientX, e.clientY)
          const d = drag.current
          drag.current = null
          // on the flat map, clicking a parcel is how the player looks around
          if (cell >= 0) g.tutorialEvent('navigate')
          if (g.tool === 'inspect') {
            if (cell >= 0) g.selectCell(cell)
            return
          }
          if (!d) return
          const end = cell >= 0 ? cell : d.start
          d.cells.add(end)
          g.commitCells(strokeCells(d.start, end, d.cells))
        }}
        onPointerLeave={() => {
          const g = useGame.getState()
          drag.current = null
          g.setHoverCell(null)
          if (g.cursorCell === null) g.setPreviewCells(null)
        }}
        onKeyDown={(e) => {
          // plain arrows move the parcel cursor here (there is no 3D camera to pan); Enter is the global shortcut
          const moves: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }
          const m = moves[e.key]
          if (!m || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
          e.preventDefault()
          useGame.getState().moveCursor(m[0], m[1])
        }}
      />
      <div className="panel max-w-[min(calc(100vh-15rem),calc(100vw-2rem))] px-3 py-2">
        <LandCoverLegend preview />
      </div>
      {overlay !== 'none' && <p className="panel px-3 py-1 text-xs text-muted">Overlays are drawn on the 3D view only. The flat map shows land cover.</p>}
    </div>
  )
}
