import { describe, expect, it } from 'vitest'
import { BoxGeometry, MeshBasicMaterial, type InstancedMesh } from 'three'
import { SlotAnimator } from '../props/SlotAnimator'
import { createSlotTargets, type SlotTargets } from '../core/placement'

const kinds = [{ geometry: new BoxGeometry() }, { geometry: new BoxGeometry(), grow: 'y' as const }]
const make = (fill: (t: SlotTargets) => void) => {
  const t = createSlotTargets(10, 2)
  fill(t)
  return t
}
const put = (t: SlotTargets, s: number, kind: number, scale = 1) => {
  t.kind[s] = kind
  t.scale.fill(scale, s * 3, s * 3 + 3)
  t.color.fill(0.5, s * 3, s * 3 + 3)
}
const meshes = (a: SlotAnimator) => a.group.children as InstancedMesh[]

describe('SlotAnimator', () => {
  it('first targets appear instantly (no fake growth on load)', () => {
    const a = new SlotAnimator(kinds, new MeshBasicMaterial())
    a.setTargets(
      make((t) => {
        put(t, 0, 0)
        put(t, 3, 0)
        put(t, 5, 1)
      }),
      false,
    )
    a.tick(0.016, false)
    expect(a.visibleCounts()).toEqual([2, 1])
    expect(a.animating).toBe(false)
  })

  it('animates additions and removals, then settles and stops working', () => {
    const a = new SlotAnimator(kinds, new MeshBasicMaterial())
    a.setTargets(make((t) => put(t, 0, 0)), true)
    a.tick(0.016, false)
    a.setTargets(make((t) => put(t, 1, 0)), false)
    a.tick(0.016, false)
    // old one shrinking, new one waiting or growing: still animating
    expect(a.animating).toBe(true)
    for (let k = 0; k < 200 && a.animating; k++) a.tick(0.05, false)
    expect(a.animating).toBe(false)
    expect(a.visibleCounts()[0]).toBe(1)
    // the remaining instance is at full scale
    const e = meshes(a)[0].instanceMatrix.array
    expect(e[0]).toBeCloseTo(1, 3)
  })

  it('snaps immediately with reduced motion', () => {
    const a = new SlotAnimator(kinds, new MeshBasicMaterial())
    a.setTargets(make((t) => put(t, 0, 0)), true)
    a.tick(0.016, true)
    a.setTargets(make((t) => put(t, 0, 0, 2)), false)
    a.tick(0.016, true)
    expect(a.animating).toBe(false)
    expect(meshes(a)[0].instanceMatrix.array[0]).toBeCloseTo(2, 3)
  })

  it('does not rewrite buffers when nothing changes', () => {
    const a = new SlotAnimator(kinds, new MeshBasicMaterial())
    a.setTargets(make((t) => put(t, 0, 0)), true)
    a.tick(0.016, false)
    const m = meshes(a)[0]
    const v = m.instanceMatrix.version
    a.tick(0.016, false)
    a.tick(0.016, false)
    expect(m.instanceMatrix.version).toBe(v)
  })

  it('grows capacity on demand', () => {
    const a = new SlotAnimator(kinds, new MeshBasicMaterial())
    const big = createSlotTargets(200, 1)
    for (let s = 0; s < 200; s++) put(big, s, 0)
    a.setTargets(big, true)
    a.tick(0.016, false)
    expect(a.visibleCounts()[0]).toBe(200)
    expect(meshes(a)[0].instanceMatrix.count).toBeGreaterThanOrEqual(200)
  })
})
