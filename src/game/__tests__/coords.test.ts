import { describe, expect, it } from 'vitest'
import { cellGradient, cellToWorld, computeCellHeights, heightAt, sampleBilinear, worldToCell } from '../core/coords'

const dims = { width: 64, height: 48 }

describe('cell <-> world mapping', () => {
  it('round-trips every cell centre', () => {
    for (let i = 0; i < dims.width * dims.height; i++) {
      const { x, z } = cellToWorld(i, dims)
      expect(worldToCell(x, z, dims)).toBe(i)
    }
  })

  it('centres the grid on the origin', () => {
    expect(cellToWorld(0, dims)).toEqual({ x: -31.5, z: -23.5 })
    expect(cellToWorld(dims.width * dims.height - 1, dims)).toEqual({ x: 31.5, z: 23.5 })
  })

  it('maps points anywhere inside a cell to that cell and rejects points outside', () => {
    const i = 5 * dims.width + 7
    const { x, z } = cellToWorld(i, dims)
    expect(worldToCell(x - 0.49, z + 0.49, dims)).toBe(i)
    expect(worldToCell(x + 0.51, z, dims)).toBe(i + 1)
    expect(worldToCell(-32.01, 0, dims)).toBe(-1)
    expect(worldToCell(0, 24.01, dims)).toBe(-1)
  })
})

describe('height sampling', () => {
  const d = { width: 3, height: 2 }
  const field = Float32Array.from([0, 1, 2, 10, 11, 12])

  it('returns exact values at cell centres', () => {
    for (let i = 0; i < 6; i++) {
      const { x, z } = cellToWorld(i, d)
      expect(sampleBilinear(field, d, x, z)).toBeCloseTo(field[i])
    }
  })

  it('interpolates bilinearly between centres', () => {
    const a = cellToWorld(0, d)
    // halfway between cells 0,1,3,4
    expect(sampleBilinear(field, d, a.x + 0.5, a.z + 0.5)).toBeCloseTo((0 + 1 + 10 + 11) / 4)
    expect(sampleBilinear(field, d, a.x + 0.25, a.z)).toBeCloseTo(0.25)
  })

  it('clamps outside the grid so the surface has no gaps', () => {
    expect(heightAt(field, d, -100, -100)).toBeCloseTo(0)
    expect(heightAt(field, d, 100, 100)).toBeCloseTo(12)
  })

  it('is continuous across cell borders', () => {
    const a = cellToWorld(0, d)
    const left = sampleBilinear(field, d, a.x + 0.5 - 1e-6, a.z + 0.2)
    const right = sampleBilinear(field, d, a.x + 0.5 + 1e-6, a.z + 0.2)
    expect(Math.abs(left - right)).toBeLessThan(1e-4)
  })

  it('converts elevation to exaggerated world heights relative to the minimum', () => {
    const h = computeCellHeights(Float32Array.from([1000, 1100, NaN]), 100, 2)
    expect(Array.from(h)).toEqual([0, 2, 0])
  })

  it('computes a downhill-pointing gradient', () => {
    const g = cellGradient(field, d, 1)
    expect(g.mag).toBeGreaterThan(0)
    expect(g.gz).toBeGreaterThan(0.9) // values increase toward +z
  })
})
