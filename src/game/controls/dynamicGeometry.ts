// A BufferGeometry whose attributes live in preallocated buffers that are written in place.
// Capacity grows by doubling, so frequent rebuilds (hover, brush preview) reuse the same GPU
// buffers and only upload the part that changed; the draw range hides the unused tail.
import { BufferAttribute, BufferGeometry, DynamicDrawUsage } from 'three'

export class DynamicGeometry {
  readonly geometry = new BufferGeometry()
  private vertexCap = 0
  private indexCap = 0
  /** Number of times the buffers were (re)allocated; exposed for tests. */
  allocations = 0

  constructor(
    private readonly layout: Readonly<Record<string, number>>,
    private readonly indexed: boolean,
    initialVertices = 64,
  ) {
    this.allocate(initialVertices, indexed ? initialVertices * 2 : 0)
  }

  private allocate(vertices: number, indices: number) {
    // free the GPU buffers of the attributes about to be replaced; three only frees buffers for
    // attributes still attached at dispose time, and re-uploads the new ones on the next render
    if (this.allocations > 0) this.geometry.dispose()
    this.vertexCap = vertices
    for (const [name, size] of Object.entries(this.layout)) {
      const attr = new BufferAttribute(new Float32Array(vertices * size), size)
      attr.setUsage(DynamicDrawUsage)
      this.geometry.setAttribute(name, attr)
    }
    if (this.indexed) {
      this.indexCap = indices
      const index = new BufferAttribute(new Uint32Array(indices), 1)
      index.setUsage(DynamicDrawUsage)
      this.geometry.setIndex(index)
    }
    this.allocations++
  }

  /** Write vertexCount vertices (each attribute array holds vertexCount * size floats) and an optional index. */
  write(attrs: Readonly<Record<string, Float32Array>>, vertexCount: number, index?: Uint32Array): void {
    const indexCount = index ? index.length : 0
    if (vertexCount > this.vertexCap || indexCount > this.indexCap) {
      let v = Math.max(1, this.vertexCap)
      while (v < vertexCount) v *= 2
      let i = Math.max(1, this.indexCap)
      while (this.indexed && i < indexCount) i *= 2
      this.allocate(v, this.indexed ? i : 0)
    }
    for (const [name, size] of Object.entries(this.layout)) {
      const attr = this.geometry.getAttribute(name) as BufferAttribute
      const src = attrs[name]
      const len = vertexCount * size
      ;(attr.array as Float32Array).set(len === src.length ? src : src.subarray(0, len))
      attr.clearUpdateRanges()
      attr.addUpdateRange(0, len)
      attr.needsUpdate = true
    }
    const ix = this.geometry.getIndex()
    if (this.indexed && ix) {
      if (index) (ix.array as Uint32Array).set(index)
      ix.clearUpdateRanges()
      ix.addUpdateRange(0, indexCount)
      ix.needsUpdate = true
    }
    this.geometry.setDrawRange(0, this.indexed ? indexCount : vertexCount)
  }

  /** Vertices the buffers can hold without reallocating. */
  get capacity(): number {
    return this.vertexCap
  }

  dispose(): void {
    this.geometry.dispose()
  }
}
