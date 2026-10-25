import { describe, expect, it } from 'vitest'
import { raycastHeightfield } from '../core/raycast'
import { cellToWorld, heightAt, worldToCell } from '../core/coords'

const dims = { width: 16, height: 16 }
const heights = new Float32Array(256).map((_, i) => ((i % 16) + Math.floor(i / 16)) * 0.3)
const bounds = { minX: -8, maxX: 8, minZ: -8, maxZ: 8, maxY: 10 }
const sample = (x: number, z: number) => heightAt(heights, dims, x, z)

describe('raycastHeightfield', () => {
  it('hits the surface straight down at the right height', () => {
    const p = raycastHeightfield({ x: 1.2, y: 50, z: -2.3 }, { x: 0, y: -1, z: 0 }, sample, bounds)
    expect(p).not.toBeNull()
    expect(p!.x).toBeCloseTo(1.2)
    expect(p!.z).toBeCloseTo(-2.3)
    expect(p!.y).toBeCloseTo(sample(1.2, -2.3), 2)
  })

  it('picks the right cell for an oblique ray aimed at a cell centre', () => {
    const target = 9 * 16 + 4
    const c = cellToWorld(target, dims)
    const ty = sample(c.x, c.z)
    const origin = { x: c.x + 20, y: ty + 25, z: c.z + 15 }
    const dir = { x: c.x - origin.x, y: ty - origin.y, z: c.z - origin.z }
    const p = raycastHeightfield(origin, dir, sample, bounds, 0.1)
    expect(p).not.toBeNull()
    expect(worldToCell(p!.x, p!.z, dims)).toBe(target)
  })

  it('returns null for rays that miss or point away', () => {
    expect(raycastHeightfield({ x: 0, y: 50, z: 0 }, { x: 0, y: 1, z: 0 }, sample, bounds)).toBeNull()
    expect(raycastHeightfield({ x: 100, y: 50, z: 0 }, { x: 0, y: -1, z: 0 }, sample, bounds)).toBeNull()
    expect(raycastHeightfield({ x: 0, y: 50, z: 0 }, { x: 0, y: 0, z: 0 }, sample, bounds)).toBeNull()
  })
})
