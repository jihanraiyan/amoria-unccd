import { describe, expect, it } from 'vitest'
import { brushCells, hoverCellsForTool, lineCells, sameCells, strokeCellsForTool, toolMode, unionCells } from '../core/brush'
import { brushCells as uiBrushCells } from '../../state/toolActions'

const W = 10
const H = 8
const idx = (x: number, z: number) => z * W + x

describe('brushCells', () => {
  it('radius 0 is the centre only', () => {
    expect(brushCells(idx(3, 3), 0, W, H)).toEqual([idx(3, 3)])
  })

  it('radius 1 is a plus-and-corners disc (9 cells) inside the grid', () => {
    const c = brushCells(idx(4, 4), 1, W, H)
    expect(c).toHaveLength(9)
    expect(new Set(c).size).toBe(9)
  })

  it('clips at the grid bounds', () => {
    const c = brushCells(idx(0, 0), 2, W, H)
    for (const i of c) {
      expect(i % W).toBeLessThanOrEqual(2)
      expect(Math.floor(i / W)).toBeLessThanOrEqual(2)
    }
    expect(c).toContain(idx(0, 0))
    expect(brushCells(-1, 2, W, H)).toEqual([])
    expect(brushCells(W * H, 2, W, H)).toEqual([])
  })

  it('grows monotonically with radius and stays a disc', () => {
    let prev = 0
    for (let r = 0; r <= 3; r++) {
      const c = brushCells(idx(5, 4), r, W, H)
      expect(c.length).toBeGreaterThan(prev)
      prev = c.length
      for (const i of c) {
        const dx = (i % W) - 5
        const dz = Math.floor(i / W) - 4
        expect(dx * dx + dz * dz).toBeLessThanOrEqual(r * r + r)
      }
    }
  })

  it('matches the UI tool helper so previews and commits agree', () => {
    for (let r = 0; r <= 3; r++) {
      for (const c of [0, idx(4, 4), idx(9, 7), idx(2, 6)]) {
        expect(brushCells(c, r, W, H).sort((a, b) => a - b)).toEqual(uiBrushCells(c, r, W, H).sort((a, b) => a - b))
      }
    }
  })
})

describe('lineCells', () => {
  it('connects endpoints with an edge-adjacent path', () => {
    const path = lineCells(idx(1, 1), idx(7, 4), W, H)
    expect(path[0]).toBe(idx(1, 1))
    expect(path[path.length - 1]).toBe(idx(7, 4))
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1]
      const b = path[k]
      const d = Math.abs((a % W) - (b % W)) + Math.abs(Math.floor(a / W) - Math.floor(b / W))
      expect(d).toBe(1)
    }
    expect(path).toHaveLength(6 + 3 + 1)
  })

  it('is a single cell when start equals end and handles reverse direction', () => {
    expect(lineCells(idx(2, 2), idx(2, 2), W, H)).toEqual([idx(2, 2)])
    const back = lineCells(idx(7, 4), idx(1, 1), W, H)
    expect(back[0]).toBe(idx(7, 4))
    expect(back[back.length - 1]).toBe(idx(1, 1))
  })
})

describe('tool strokes', () => {
  it('classifies tools', () => {
    expect(toolMode('inspect')).toBe('inspect')
    expect(toolMode('road')).toBe('line')
    expect(toolMode('market')).toBe('single')
    expect(toolMode('reforest')).toBe('paint')
  })

  it('hover uses the brush for paint tools and one cell for others', () => {
    expect(hoverCellsForTool('reforest', idx(4, 4), 1, W, H)).toHaveLength(9)
    expect(hoverCellsForTool('road', idx(4, 4), 3, W, H)).toEqual([idx(4, 4)])
    expect(hoverCellsForTool('inspect', idx(4, 4), 3, W, H)).toEqual([])
  })

  it('paint strokes fill gaps between visited cells', () => {
    const s = strokeCellsForTool('clear', [idx(0, 0), idx(5, 0)], 0, W, H)
    expect(s).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('road strokes are a line from start to the current cell', () => {
    const s = strokeCellsForTool('road', [idx(0, 0), idx(3, 3), idx(4, 0)], 2, W, H)
    expect(s).toEqual(lineCells(idx(0, 0), idx(4, 0), W, H))
  })

  it('single tools only use the last cell', () => {
    expect(strokeCellsForTool('waterworks', [idx(0, 0), idx(4, 4)], 2, W, H)).toEqual([idx(4, 4)])
  })

  it('union and equality helpers', () => {
    expect(unionCells([3, 1], [2, 3])).toEqual([1, 2, 3])
    expect(sameCells([1, 2], [1, 2])).toBe(true)
    expect(sameCells([1, 2], [2, 1])).toBe(false)
    expect(sameCells(null, [])).toBe(false)
  })
})
