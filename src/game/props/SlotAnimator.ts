// Turns SlotTargets into InstancedMeshes and tweens between successive targets: new props grow
// or rise in, removed props shrink away, colors blend. It only does work while something is
// changing; a settled world costs nothing per frame. Instance buffers are compacted per kind
// and grow on demand, so draw cost tracks what is actually visible.
import {
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three'
import type { SlotTargets } from '../core/placement'

export interface KindSpec {
  geometry: BufferGeometry
  /** 'y' makes props rise from the ground (buildings); 'uniform' scales them (plants). */
  grow?: 'uniform' | 'y'
  castShadow?: boolean
  receiveShadow?: boolean
}

const GROW_RATE = 1.4 // per second
const BLEND_RATE = 4 // per second (exponential)

const _m = new Matrix4()
const _p = new Vector3()
const _q = new Quaternion()
const _s = new Vector3()
const _e = new Euler(0, 0, 0, 'YZX')

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

export class SlotAnimator {
  readonly group = new Group()
  private kinds: KindSpec[]
  private material: Material
  private meshes: (InstancedMesh | null)[] = []
  private capacity: number[] = []
  private n = 0
  private curKind = new Int8Array(0)
  private growth = new Float32Array(0)
  private curPos = new Float32Array(0)
  private curRot = new Float32Array(0)
  private curScale = new Float32Array(0)
  private curColor = new Float32Array(0)
  private target: SlotTargets | null = null
  private dirty = false
  private shadows = true
  animating = false

  constructor(kinds: KindSpec[], material: Material, name = 'props') {
    this.kinds = [...kinds]
    this.material = material
    this.group.name = name
    this.meshes = kinds.map(() => null)
    this.capacity = kinds.map(() => 0)
  }

  /** Swap geometries (e.g. once the Kenney models load) without touching state. */
  setGeometries(geometries: BufferGeometry[]): void {
    for (let k = 0; k < this.kinds.length; k++) {
      const g = geometries[k]
      if (!g || g === this.kinds[k].geometry) continue
      this.kinds[k] = { ...this.kinds[k], geometry: g }
      const mesh = this.meshes[k]
      if (mesh) mesh.geometry = g
    }
  }

  setShadows(on: boolean): void {
    this.shadows = on
    for (let k = 0; k < this.meshes.length; k++) {
      const m = this.meshes[k]
      if (m) m.castShadow = on && !!this.kinds[k].castShadow
    }
  }

  setTargets(t: SlotTargets, instant: boolean): void {
    const n = t.kind.length
    if (n !== this.n) {
      this.n = n
      this.curKind = new Int8Array(n).fill(-1)
      this.growth = new Float32Array(n)
      this.curPos = new Float32Array(n * 3)
      this.curRot = new Float32Array(n * 2)
      this.curScale = new Float32Array(n * 3)
      this.curColor = new Float32Array(n * 3)
      instant = true
    }
    this.target = t
    if (instant) this.snap()
    else this.animating = true
    this.dirty = true
  }

  private copySlot(s: number) {
    const t = this.target!
    this.curPos[s * 3] = t.pos[s * 3]
    this.curPos[s * 3 + 1] = t.pos[s * 3 + 1]
    this.curPos[s * 3 + 2] = t.pos[s * 3 + 2]
    this.curRot[s * 2] = t.rot[s * 2]
    this.curRot[s * 2 + 1] = t.rot[s * 2 + 1]
  }

  private snap() {
    const t = this.target
    if (!t) return
    for (let s = 0; s < this.n; s++) {
      this.curKind[s] = t.kind[s]
      this.growth[s] = t.kind[s] >= 0 ? 1 : 0
      this.copySlot(s)
      for (let c = 0; c < 3; c++) {
        this.curScale[s * 3 + c] = t.scale[s * 3 + c]
        this.curColor[s * 3 + c] = t.color[s * 3 + c]
      }
    }
    this.animating = false
  }

  /** Advance tweens; call every frame. Cheap when nothing is changing. */
  tick(dt: number, reducedMotion: boolean): void {
    if (!this.target) return
    if (this.animating && reducedMotion) {
      this.snap()
      this.dirty = true
    }
    if (this.animating) {
      this.dirty = true
      const t = this.target
      const step = Math.min(0.1, dt) * GROW_RATE
      const blend = 1 - Math.exp(-BLEND_RATE * Math.min(0.1, dt))
      let busy = false
      for (let s = 0; s < this.n; s++) {
        const tk = t.kind[s]
        const ck = this.curKind[s]
        if (ck !== tk) {
          if (ck >= 0 && this.growth[s] > 0) {
            this.growth[s] = Math.max(0, this.growth[s] - step * 1.5)
            busy = true
          } else {
            this.curKind[s] = tk
            this.growth[s] = 0
            this.copySlot(s)
            for (let c = 0; c < 3; c++) {
              this.curScale[s * 3 + c] = t.scale[s * 3 + c]
              this.curColor[s * 3 + c] = t.color[s * 3 + c]
            }
            if (tk >= 0) busy = true
          }
          continue
        }
        if (tk < 0) continue
        this.copySlot(s)
        if (this.growth[s] < 1) {
          this.growth[s] = Math.min(1, this.growth[s] + step)
          busy = true
        }
        for (let c = 0; c < 3; c++) {
          const o = s * 3 + c
          const ds = t.scale[o] - this.curScale[o]
          const dc = t.color[o] - this.curColor[o]
          if (Math.abs(ds) > 1e-4) {
            this.curScale[o] += ds * blend
            busy = true
          } else this.curScale[o] = t.scale[o]
          if (Math.abs(dc) > 1e-4) {
            this.curColor[o] += dc * blend
            busy = true
          } else this.curColor[o] = t.color[o]
        }
      }
      this.animating = busy
    }
    if (this.dirty) {
      this.write()
      this.dirty = false
    }
  }

  private ensureMesh(kind: number, needed: number): InstancedMesh {
    let mesh = this.meshes[kind]
    if (mesh && this.capacity[kind] >= needed) return mesh
    let cap = 64
    while (cap < needed * 1.25) cap *= 2
    if (mesh) {
      this.group.remove(mesh)
      mesh.dispose()
    }
    const spec = this.kinds[kind]
    mesh = new InstancedMesh(spec.geometry, this.material, cap)
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(cap * 3), 3)
    mesh.instanceColor.setUsage(DynamicDrawUsage)
    mesh.frustumCulled = false
    mesh.castShadow = this.shadows && !!spec.castShadow
    mesh.receiveShadow = !!spec.receiveShadow
    mesh.count = 0
    mesh.name = `${this.group.name}-${kind}`
    this.meshes[kind] = mesh
    this.capacity[kind] = cap
    this.group.add(mesh)
    return mesh
  }

  private write() {
    const K = this.kinds.length
    const counts = new Int32Array(K)
    for (let s = 0; s < this.n; s++) {
      const k = this.curKind[s]
      if (k >= 0 && k < K && this.growth[s] > 0.001) counts[k]++
    }
    const meshes: (InstancedMesh | null)[] = []
    for (let k = 0; k < K; k++) meshes[k] = counts[k] > 0 || this.meshes[k] ? this.ensureMesh(k, Math.max(1, counts[k])) : null
    const cursor = new Int32Array(K)
    for (let s = 0; s < this.n; s++) {
      const k = this.curKind[s]
      if (k < 0 || k >= K) continue
      const g = this.growth[s]
      if (g <= 0.001) continue
      const mesh = meshes[k]!
      const e = easeOut(g)
      const sx = this.curScale[s * 3]
      const sy = this.curScale[s * 3 + 1]
      const sz = this.curScale[s * 3 + 2]
      if (this.kinds[k].grow === 'y') _s.set(sx * (0.75 + 0.25 * e), sy * e, sz * (0.75 + 0.25 * e))
      else _s.set(sx * e, sy * e, sz * e)
      _p.set(this.curPos[s * 3], this.curPos[s * 3 + 1], this.curPos[s * 3 + 2])
      _e.set(0, this.curRot[s * 2], this.curRot[s * 2 + 1])
      _q.setFromEuler(_e)
      _m.compose(_p, _q, _s)
      const idx = cursor[k]++
      mesh.instanceMatrix.array.set(_m.elements, idx * 16)
      const col = mesh.instanceColor!.array as Float32Array
      col[idx * 3] = this.curColor[s * 3]
      col[idx * 3 + 1] = this.curColor[s * 3 + 1]
      col[idx * 3 + 2] = this.curColor[s * 3 + 2]
    }
    for (let k = 0; k < K; k++) {
      const mesh = meshes[k]
      if (!mesh) continue
      mesh.count = cursor[k]
      mesh.instanceMatrix.needsUpdate = true
      mesh.instanceColor!.needsUpdate = true
    }
  }

  /** Number of visible instances per kind (for tests and the debug HUD). */
  visibleCounts(): number[] {
    return this.meshes.map((m) => m?.count ?? 0)
  }

  dispose(): void {
    for (const m of this.meshes) {
      if (!m) continue
      this.group.remove(m)
      m.dispose()
    }
    this.meshes = this.kinds.map(() => null)
  }
}
