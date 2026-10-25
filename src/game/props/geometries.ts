// Procedural low-poly prop geometry in the same flat-shaded style as the Kenney models.
// Every geometry is non-indexed and carries `color` (vertex color, linear RGB) and `aTint`
// (1 where the per-instance color applies: roofs, awnings, foliage). Shared across all views.
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Euler,
  IcosahedronGeometry,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PALETTE, type RGB } from '../core/palette'

const WHITE: RGB = [1, 1, 1]

/** Prepare a primitive: non-indexed, transformed, with color + tint attributes. */
export function part(g: BufferGeometry, color: RGB, tint: 0 | 1, at?: { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number; sx?: number; sy?: number; sz?: number }): BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g.clone()
  if (at) {
    const m = new Matrix4().compose(
      new Vector3(at.x ?? 0, at.y ?? 0, at.z ?? 0),
      new Quaternion().setFromEuler(new Euler(at.rx ?? 0, at.ry ?? 0, at.rz ?? 0)),
      new Vector3(at.sx ?? 1, at.sy ?? 1, at.sz ?? 1),
    )
    geo.applyMatrix4(m)
  }
  for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name)
  if (!geo.getAttribute('normal')) geo.computeVertexNormals()
  const n = geo.getAttribute('position').count
  const col = new Float32Array(n * 3)
  const tnt = new Float32Array(n)
  for (let v = 0; v < n; v++) {
    col[v * 3] = color[0]
    col[v * 3 + 1] = color[1]
    col[v * 3 + 2] = color[2]
    tnt[v] = tint
  }
  geo.setAttribute('color', new BufferAttribute(col, 3))
  geo.setAttribute('aTint', new BufferAttribute(tnt, 1))
  return geo
}

export function merge(parts: BufferGeometry[]): BufferGeometry {
  const m = mergeGeometries(parts, false)
  if (!m) throw new Error('Could not merge prop geometry parts')
  m.computeBoundingSphere()
  return m
}

/** Triangular prism (gable roof) along X: length in x, width in z, apex height in y, base at y=0. */
export function gablePrism(length: number, width: number, height: number): BufferGeometry {
  const hx = length / 2
  const hz = width / 2
  // cross-section points: (z, y)
  const L: [number, number, number][] = [
    [-hx, 0, -hz],
    [-hx, 0, hz],
    [-hx, height, 0],
  ]
  const R: [number, number, number][] = L.map(([, y, z]) => [hx, y, z])
  const tri = (a: number[], b: number[], c: number[]) => [...a, ...b, ...c]
  const pos = [
    ...tri(L[0], L[1], L[2]), // west gable
    ...tri(R[0], R[2], R[1]), // east gable
    ...tri(L[1], R[1], R[2]), // south slope
    ...tri(L[1], R[2], L[2]),
    ...tri(L[0], L[2], R[2]), // north slope
    ...tri(L[0], R[2], R[0]),
    ...tri(L[0], R[0], R[1]), // underside
    ...tri(L[0], R[1], L[1]),
  ]
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.computeVertexNormals()
  return g
}

/** Unit box with origin at the bottom centre: x,z in [-0.5,0.5], y in [0,1]. */
export function unitBox(): BufferGeometry {
  return new BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
}

/** Rounded crop-row hump along X, base at y=0, height 1, width 1. */
export function cropRowGeometry(): BufferGeometry {
  const prof: [number, number][] = [
    [-0.5, 0],
    [-0.42, 0.62],
    [-0.18, 1],
    [0.18, 1],
    [0.42, 0.62],
    [0.5, 0],
  ]
  const pos: number[] = []
  const hx = 0.5
  for (let k = 0; k < prof.length - 1; k++) {
    const [z0, y0] = prof[k]
    const [z1, y1] = prof[k + 1]
    pos.push(-hx, y0, z0, -hx, y1, z1, hx, y1, z1)
    pos.push(-hx, y0, z0, hx, y1, z1, hx, y0, z0)
  }
  // end caps
  for (let k = 1; k < prof.length - 2; k++) {
    const a = prof[0]
    const b = prof[k]
    const c = prof[k + 1]
    pos.push(-hx, a[1], a[0], -hx, c[1], c[0], -hx, b[1], b[0])
    pos.push(hx, a[1], a[0], hx, b[1], b[0], hx, c[1], c[0])
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.computeVertexNormals()
  return part(g, WHITE, 1)
}

export function stripGeometry(): BufferGeometry {
  return part(unitBox(), WHITE, 1)
}

export function roadGeometry(): BufferGeometry {
  return part(unitBox(), WHITE, 1)
}

const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d)

/** One-storey cottage, footprint 1 x 1 (scaled by placement), walls 0.16 tall. */
export function house1Geometry(): BufferGeometry {
  return merge([
    part(box(1.02, 0.2, 1.02), PALETTE.stone, 0, { y: -0.1 }),
    part(box(1, 0.16, 1), PALETTE.wall, 0, { y: 0.08 }),
    part(gablePrism(1.12, 1.16, 0.12), WHITE, 1, { y: 0.16 }),
    part(box(0.16, 0.1, 0.03), PALETTE.door, 0, { y: 0.05, z: 0.5 }),
    part(box(0.14, 0.06, 0.03), PALETTE.window, 0, { x: -0.28, y: 0.09, z: 0.5 }),
    part(box(0.14, 0.06, 0.03), PALETTE.window, 0, { x: 0.28, y: 0.09, z: 0.5 }),
    part(box(0.03, 0.06, 0.2), PALETTE.window, 0, { x: 0.5, y: 0.09 }),
    part(box(0.1, 0.1, 0.1), PALETTE.wallShade, 0, { x: 0.3, y: 0.24, z: -0.15 }),
  ])
}

/** Two-storey house, walls 0.3 tall. */
export function house2Geometry(): BufferGeometry {
  const parts = [
    part(box(1.02, 0.2, 1.02), PALETTE.stone, 0, { y: -0.1 }),
    part(box(1, 0.3, 1), PALETTE.wall, 0, { y: 0.15 }),
    part(box(1.04, 0.025, 1.04), PALETTE.wallShade, 0, { y: 0.15 }),
    part(gablePrism(1.12, 1.16, 0.13), WHITE, 1, { y: 0.3 }),
    part(box(0.16, 0.1, 0.03), PALETTE.door, 0, { y: 0.05, z: 0.5 }),
  ]
  for (const x of [-0.3, 0.3]) for (const y of [0.09, 0.22]) parts.push(part(box(0.14, 0.06, 0.03), PALETTE.window, 0, { x, y, z: 0.5 }))
  for (const z of [-0.2, 0.2]) parts.push(part(box(0.03, 0.06, 0.14), PALETTE.window, 0, { x: 0.5, y: 0.22, z }))
  return merge(parts)
}

/** Small apartment block, flat roof with a tinted accent band, walls 0.5 tall. */
export function blockGeometry(): BufferGeometry {
  const parts = [
    part(box(1.02, 0.2, 1.02), PALETTE.stone, 0, { y: -0.1 }),
    part(box(1, 0.5, 1), PALETTE.wall, 0, { y: 0.25 }),
    part(box(1.06, 0.05, 1.06), WHITE, 1, { y: 0.52 }),
    part(box(0.9, 0.04, 0.9), PALETTE.wallShade, 0, { y: 0.56 }),
    part(box(0.2, 0.08, 0.2), PALETTE.concrete, 0, { x: 0.25, y: 0.6, z: -0.2 }),
    part(box(1.03, 0.04, 1.03), WHITE, 1, { y: 0.03 }),
  ]
  for (const x of [-0.3, 0, 0.3]) for (const y of [0.12, 0.25, 0.38]) parts.push(part(box(0.13, 0.07, 0.03), PALETTE.window, 0, { x, y, z: 0.5 }))
  for (const z of [-0.25, 0.25]) for (const y of [0.12, 0.25, 0.38]) parts.push(part(box(0.03, 0.07, 0.13), PALETTE.window, 0, { x: 0.5, y, z }))
  return merge(parts)
}

/** Waterworks hall: low concrete building with a tinted roof slab and a pipe run. */
export function worksHallGeometry(): BufferGeometry {
  return merge([
    part(box(1.02, 0.2, 1.02), PALETTE.stone, 0, { y: -0.1 }),
    part(box(1, 0.2, 1), PALETTE.concrete, 0, { y: 0.1 }),
    part(box(1.06, 0.04, 1.06), WHITE, 1, { y: 0.22 }),
    part(box(0.16, 0.12, 0.03), PALETTE.door, 0, { y: 0.06, z: 0.5 }),
    part(new CylinderGeometry(0.06, 0.06, 0.9, 6), PALETTE.pipe, 0, { x: 0.62, y: 0.08, rz: Math.PI / 2 }),
    part(box(0.2, 0.3, 0.2), PALETTE.concrete, 0, { x: -0.32, y: 0.25, z: -0.3 }),
  ])
}

/** Water tank: cylinder with a domed lid, footprint radius 0.5. */
export function tankGeometry(): BufferGeometry {
  return merge([
    part(new CylinderGeometry(0.5, 0.52, 0.26, 10), PALETTE.tank, 0, { y: 0.13 }),
    part(new ConeGeometry(0.52, 0.1, 10), WHITE, 1, { y: 0.31 }),
    part(new CylinderGeometry(0.52, 0.52, 0.02, 10), PALETTE.pipe, 0, { y: 0.2 }),
  ])
}

/** Market stall: posts, counter and a tinted sloping awning. */
export function stallGeometry(): BufferGeometry {
  const parts = [part(box(1, 0.08, 0.6), PALETTE.marketWood, 0, { y: 0.04 })]
  for (const x of [-0.45, 0.45]) for (const z of [-0.45, 0.45]) parts.push(part(box(0.06, 0.22, 0.06), PALETTE.marketWood, 0, { x, y: 0.11, z }))
  parts.push(part(box(1.15, 0.03, 1.15), WHITE, 1, { y: 0.23, rx: 0.18 }))
  parts.push(part(box(0.25, 0.06, 0.2), PALETTE.reedDry, 0, { x: -0.2, y: 0.11 }))
  parts.push(part(box(0.2, 0.05, 0.2), PALETTE.eroded, 0, { x: 0.2, y: 0.105 }))
  return merge(parts)
}

/** Market square paving with a raised border. */
export function plazaGeometry(): BufferGeometry {
  return merge([
    part(box(1, 0.06, 1), WHITE, 1, { y: -0.01 }),
    part(box(1.04, 0.04, 0.06), PALETTE.stone, 0, { y: 0.02, z: 0.5 }),
    part(box(1.04, 0.04, 0.06), PALETTE.stone, 0, { y: 0.02, z: -0.5 }),
    part(box(0.06, 0.04, 1.04), PALETTE.stone, 0, { x: 0.5, y: 0.02 }),
    part(box(0.06, 0.04, 1.04), PALETTE.stone, 0, { x: -0.5, y: 0.02 }),
    part(new CylinderGeometry(0.08, 0.1, 0.06, 8), PALETTE.stone, 0, { y: 0.04 }),
  ])
}

/** Earth embankment segment: trapezoid profile along X, base at y=0, height 1, width 1. */
export function embankmentGeometry(): BufferGeometry {
  const prof: [number, number][] = [
    [-0.5, 0],
    [-0.2, 1],
    [0.2, 1],
    [0.5, 0],
  ]
  const pos: number[] = []
  for (let k = 0; k < prof.length - 1; k++) {
    const [z0, y0] = prof[k]
    const [z1, y1] = prof[k + 1]
    pos.push(-0.5, y0, z0, -0.5, y1, z1, 0.5, y1, z1, -0.5, y0, z0, 0.5, y1, z1, 0.5, y0, z0)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.computeVertexNormals()
  return part(g, WHITE, 1)
}

/** Reed clump: a few thin tilted blades about 0.3 world units tall. */
export function reedGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = []
  const blades: [number, number, number, number][] = [
    [0, 0, 0.32, 0],
    [0.05, 0.03, 0.26, 0.25],
    [-0.05, 0.02, 0.28, -0.22],
    [0.02, -0.05, 0.22, 0.15],
    [-0.03, -0.04, 0.3, -0.1],
  ]
  for (const [x, z, h, tilt] of blades) {
    parts.push(part(new ConeGeometry(0.018, h, 4), WHITE, 1, { x, y: h / 2, z, rz: tilt, rx: tilt * 0.5 }))
  }
  parts.push(part(new CylinderGeometry(0.02, 0.02, 0.06, 5), PALETTE.reedDry, 0, { x: 0.01, y: 0.3, z: 0.0 }))
  return merge(parts)
}

/** Flow arrow (chevron) lying flat, pointing +X, about 0.5 long. */
export function arrowGeometry(): BufferGeometry {
  const pos = new Float32Array([
    // head
    0.25, 0, 0, -0.05, 0, -0.2, -0.05, 0, 0.2,
    // tail
    -0.05, 0, -0.07, -0.25, 0, -0.07, -0.25, 0, 0.07, -0.05, 0, -0.07, -0.25, 0, 0.07, -0.05, 0, 0.07,
  ])
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}

// ------------------------------------------------- procedural fallbacks for the Kenney models

export function fallbackConifer(): BufferGeometry {
  return merge([
    part(new CylinderGeometry(0.06, 0.08, 0.35, 5), PALETTE.bark, 0, { y: 0.17 }),
    part(new ConeGeometry(0.34, 0.75, 6), WHITE, 1, { y: 0.65 }),
    part(new ConeGeometry(0.26, 0.55, 6), [0.85, 0.85, 0.85], 1, { y: 1.0 }),
  ])
}

export function fallbackBroadleaf(): BufferGeometry {
  return merge([
    part(new CylinderGeometry(0.06, 0.09, 0.5, 5), PALETTE.bark, 0, { y: 0.25 }),
    part(new IcosahedronGeometry(0.38, 0), WHITE, 1, { y: 0.78 }),
    part(new IcosahedronGeometry(0.24, 0), [0.85, 0.85, 0.85], 1, { x: 0.18, y: 0.95, z: 0.05 }),
  ])
}

export function fallbackBush(): BufferGeometry {
  return part(new IcosahedronGeometry(0.16, 0), WHITE, 1, { y: 0.1, sy: 0.75 })
}

export function fallbackStump(): BufferGeometry {
  return merge([part(new CylinderGeometry(0.13, 0.16, 0.18, 7), PALETTE.bark, 0, { y: 0.09 }), part(new CylinderGeometry(0.125, 0.125, 0.01, 7), PALETTE.stumpInner, 0, { y: 0.185 })])
}

export function fallbackRock(): BufferGeometry {
  return part(new DodecahedronGeometry(0.16, 0), PALETTE.stone, 0, { y: 0.06, sy: 0.6 })
}

export function fallbackLily(): BufferGeometry {
  return part(new CylinderGeometry(0.09, 0.09, 0.015, 7), WHITE, 1, { y: 0.01 })
}
