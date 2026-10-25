// Static terrain derivation: slope, depression filling, D8 flow directions, topological
// routing order, flow accumulation and floodplain geometry. Computed once per world.
//
// Depressions: closed pits would swallow routed water with no explanation. We fill them with
// the Priority-Flood algorithm (Barnes, Lehman & Mulla 2014, "Priority-Flood: An Optimal
// Depression-Filling and Watershed-Labeling Algorithm") using a tiny epsilon gradient so
// every interior cell has a strictly lower neighbour on the filled surface. Water therefore
// always reaches a map edge, where it is counted as outflow in the water ledger.
import type { Terrain, WorldInput } from '../types'

const EPSILON_M = 1e-4

/** Minimal binary min-heap keyed by Float64 priorities (ties broken by insertion order). */
class MinHeap {
  private keys: number[] = []
  private vals: number[] = []
  private order: number[] = []
  private counter = 0
  get size() {
    return this.vals.length
  }
  push(key: number, val: number) {
    this.keys.push(key)
    this.vals.push(val)
    this.order.push(this.counter++)
    this.up(this.vals.length - 1)
  }
  pop(): number {
    const top = this.vals[0]
    const lastK = this.keys.pop()!
    const lastV = this.vals.pop()!
    const lastO = this.order.pop()!
    if (this.vals.length > 0) {
      this.keys[0] = lastK
      this.vals[0] = lastV
      this.order[0] = lastO
      this.down(0)
    }
    return top
  }
  private less(a: number, b: number) {
    return this.keys[a] < this.keys[b] || (this.keys[a] === this.keys[b] && this.order[a] < this.order[b])
  }
  private swap(a: number, b: number) {
    ;[this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]]
    ;[this.vals[a], this.vals[b]] = [this.vals[b], this.vals[a]]
    ;[this.order[a], this.order[b]] = [this.order[b], this.order[a]]
  }
  private up(i: number) {
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!this.less(i, p)) break
      this.swap(i, p)
      i = p
    }
  }
  private down(i: number) {
    const n = this.vals.length
    for (;;) {
      const l = 2 * i + 1
      const r = l + 1
      let m = i
      if (l < n && this.less(l, m)) m = l
      if (r < n && this.less(r, m)) m = r
      if (m === i) break
      this.swap(i, m)
      i = m
    }
  }
}

const DX = [-1, 0, 1, -1, 1, -1, 0, 1]
const DZ = [-1, -1, -1, 0, 0, 1, 1, 1]

/** Priority-Flood with epsilon: returns a depression-free surface (Float64). */
export function fillDepressions(width: number, height: number, elevation: ArrayLike<number>): Float64Array {
  const n = width * height
  const filled = new Float64Array(n)
  for (let i = 0; i < n; i++) filled[i] = elevation[i]
  const closed = new Uint8Array(n)
  const heap = new MinHeap()
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      if (x === 0 || z === 0 || x === width - 1 || z === height - 1) {
        const i = z * width + x
        closed[i] = 1
        heap.push(filled[i], i)
      }
    }
  }
  while (heap.size > 0) {
    const c = heap.pop()
    const cx = c % width
    const cz = (c - cx) / width
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX[k]
      const nz = cz + DZ[k]
      if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue
      const j = nz * width + nx
      if (closed[j]) continue
      closed[j] = 1
      if (filled[j] <= filled[c]) filled[j] = filled[c] + EPSILON_M
      heap.push(filled[j], j)
    }
  }
  return filled
}

/** Horn (1981) 3x3 slope, rise/run, with edge cells using clamped neighbours. */
export function computeSlope(width: number, height: number, cellSizeM: number, e: ArrayLike<number>): Float32Array {
  const slope = new Float32Array(width * height)
  const at = (x: number, z: number) => e[Math.min(height - 1, Math.max(0, z)) * width + Math.min(width - 1, Math.max(0, x))]
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const a = at(x - 1, z - 1)
      const b = at(x, z - 1)
      const c = at(x + 1, z - 1)
      const d = at(x - 1, z)
      const f = at(x + 1, z)
      const g = at(x - 1, z + 1)
      const h = at(x, z + 1)
      const k = at(x + 1, z + 1)
      const dzdx = (c + 2 * f + k - (a + 2 * d + g)) / (8 * cellSizeM)
      const dzdz = (g + 2 * h + k - (a + 2 * b + c)) / (8 * cellSizeM)
      slope[z * width + x] = Math.hypot(dzdx, dzdz)
    }
  }
  return slope
}

/** D8 steepest descent on the filled surface. Edge cells with no lower neighbour drain off-map (-1). */
export function computeFlowTo(width: number, height: number, cellSizeM: number, filled: Float64Array): Int32Array {
  const n = width * height
  const flowTo = new Int32Array(n).fill(-1)
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const i = z * width + x
      let best = -1
      let bestDrop = 0
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k]
        const nz = z + DZ[k]
        if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue
        const j = nz * width + nx
        const drop = (filled[i] - filled[j]) / (Math.hypot(DX[k], DZ[k]) * cellSizeM)
        if (drop > bestDrop) {
          bestDrop = drop
          best = j
        }
      }
      flowTo[i] = best
    }
  }
  return flowTo
}

/** Kahn topological order: every cell appears before the cell it drains to. */
export function computeFlowOrder(flowTo: Int32Array): Int32Array {
  const n = flowTo.length
  const indeg = new Int32Array(n)
  for (let i = 0; i < n; i++) if (flowTo[i] >= 0) indeg[flowTo[i]]++
  const order = new Int32Array(n)
  let head = 0
  let tail = 0
  for (let i = 0; i < n; i++) if (indeg[i] === 0) order[tail++] = i
  while (head < tail) {
    const c = order[head++]
    const t = flowTo[c]
    if (t >= 0 && --indeg[t] === 0) order[tail++] = t
  }
  if (tail !== n) throw new Error(`flow graph has a cycle (${n - tail} cells unordered)`)
  return order
}

export function computeFlowAccumulation(flowTo: Int32Array, flowOrder: Int32Array): Float32Array {
  const acc = new Float32Array(flowTo.length).fill(1)
  for (let k = 0; k < flowOrder.length; k++) {
    const i = flowOrder[k]
    if (flowTo[i] >= 0) acc[flowTo[i]] += acc[i]
  }
  return acc
}

/** Multi-source BFS from channel cells (8-connected): nearest channel cell and distance in cells. */
export function computeChannelProximity(width: number, height: number, channel: Uint8Array) {
  const n = width * height
  const nearest = new Int32Array(n).fill(-1)
  const dist = new Float32Array(n).fill(Infinity)
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0
  for (let i = 0; i < n; i++) {
    if (channel[i]) {
      nearest[i] = i
      dist[i] = 0
      queue[tail++] = i
    }
  }
  while (head < tail) {
    const c = queue[head++]
    const cx = c % width
    const cz = (c - cx) / width
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX[k]
      const nz = cz + DZ[k]
      if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue
      const j = nz * width + nx
      if (dist[j] !== Infinity) continue
      dist[j] = dist[c] + 1
      nearest[j] = nearest[c]
      queue[tail++] = j
    }
  }
  for (let i = 0; i < n; i++) if (dist[i] === Infinity) dist[i] = width + height
  return { nearest, dist }
}

/**
 * Height Above Nearest Drainage (HAND, after Renno et al. 2008): follow each cell's D8 flow
 * path downstream to the first channel cell and take the elevation difference. Cells that
 * leave the map without meeting a channel get a large height (never flooded by the river).
 */
export function computeHand(flowTo: Int32Array, flowOrder: Int32Array, channel: Uint8Array, elevation: ArrayLike<number>) {
  const n = flowTo.length
  const drain = new Int32Array(n).fill(-1)
  // walk downstream-to-upstream so each cell can copy its receiver's drainage cell
  for (let k = n - 1; k >= 0; k--) {
    const i = flowOrder[k]
    if (channel[i]) drain[i] = i
    else if (flowTo[i] >= 0) drain[i] = drain[flowTo[i]]
  }
  const hand = new Float32Array(n)
  for (let i = 0; i < n; i++) hand[i] = drain[i] >= 0 ? Math.max(0, elevation[i] - elevation[drain[i]]) : 1e3
  return { drain, hand }
}

export function deriveTerrain(w: WorldInput): Terrain {
  const { width, height, cellSizeM, elevationM } = w
  const n = width * height
  if (elevationM.length !== n || w.cover.length !== n) throw new Error('world layers do not match width*height')
  const channel = w.channel ? w.channel.slice() : new Uint8Array(n)
  const filled = fillDepressions(width, height, elevationM)
  const slope = computeSlope(width, height, cellSizeM, elevationM)
  const flowTo = computeFlowTo(width, height, cellSizeM, filled)
  const flowOrder = computeFlowOrder(flowTo)
  const flowAccumulation = computeFlowAccumulation(flowTo, flowOrder)
  const { dist } = computeChannelProximity(width, height, channel)
  const { drain, hand } = computeHand(flowTo, flowOrder, channel, elevationM)
  return {
    width,
    height,
    cellSizeM,
    elevationM,
    slope,
    flowTo,
    flowOrder,
    flowAccumulation,
    channel,
    protected: w.protected ? w.protected.slice() : new Uint8Array(n),
    filledElevationM: filled,
    nearestChannel: drain,
    channelDistance: dist,
    heightAboveChannelM: hand,
    bankfullMm: new Float32Array(n),
  }
}
