// Ray vs heightfield intersection, used for cell picking. Marching along the ray with
// bilinear height samples and refining by bisection is exact enough for a 64 x 64 grid
// and avoids raycasting tens of thousands of terrain triangles on every pointer move.

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface HeightfieldBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  maxY: number
}

/**
 * First intersection of the ray origin + t*dir (t >= 0) with the surface y = sample(x, z),
 * restricted to the bounds rectangle. Returns null if the ray misses.
 */
export function raycastHeightfield(
  origin: Vec3,
  dir: Vec3,
  sample: (x: number, z: number) => number,
  bounds: HeightfieldBounds,
  step = 0.25,
): Vec3 | null {
  const len = Math.hypot(dir.x, dir.y, dir.z)
  if (len < 1e-9) return null
  const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len }
  // Clip the ray to the slab [minX,maxX] x [-inf, maxY+1] x [minZ,maxZ]
  let t0 = 0
  let t1 = Infinity
  const slab = (o: number, dd: number, lo: number, hi: number) => {
    if (Math.abs(dd) < 1e-12) return o >= lo && o <= hi
    let a = (lo - o) / dd
    let b = (hi - o) / dd
    if (a > b) [a, b] = [b, a]
    t0 = Math.max(t0, a)
    t1 = Math.min(t1, b)
    return t0 <= t1
  }
  if (!slab(origin.x, d.x, bounds.minX, bounds.maxX)) return null
  if (!slab(origin.z, d.z, bounds.minZ, bounds.maxZ)) return null
  // upper cap: no surface above maxY
  if (d.y < 0) {
    const tTop = (bounds.maxY + 0.5 - origin.y) / d.y
    if (tTop > t0) t0 = tTop
  } else if (origin.y > bounds.maxY + 0.5) {
    return null
  }
  if (t0 > t1) return null
  const at = (t: number) => ({ x: origin.x + d.x * t, y: origin.y + d.y * t, z: origin.z + d.z * t })
  const above = (t: number) => {
    const p = at(t)
    return p.y - sample(p.x, p.z)
  }
  let prevT = t0
  if (above(prevT) <= 0) return at(prevT)
  const maxIter = Math.ceil((Math.min(t1, 1e5) - t0) / step) + 1
  for (let k = 1; k <= maxIter; k++) {
    const t = Math.min(t0 + k * step, t1)
    const h = above(t)
    if (h <= 0) {
      let lo = prevT
      let hi = t
      for (let b = 0; b < 12; b++) {
        const mid = (lo + hi) / 2
        if (above(mid) > 0) lo = mid
        else hi = mid
      }
      return at(hi)
    }
    prevT = t
    if (t >= t1) break
  }
  return null
}
