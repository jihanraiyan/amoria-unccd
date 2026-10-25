// Deterministic per-cell randomness for prop placement. The same cell, slot and channel
// always give the same number, so props never jump around between renders or reloads.
// (Visual only: the simulation has its own seeded streams in src/simulation/rng.ts.)

/** Integer hash -> [0, 1). */
export function hash01(a: number, b = 0, c = 0): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h ^ ((b | 0) + 0x632be5ab), 0xc2b2ae35)
  h ^= h >>> 16
  h = Math.imul(h ^ ((c | 0) + 0x7f4a7c15), 0x27d4eb2f)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

/** Hash -> [lo, hi). */
export function hashRange(lo: number, hi: number, a: number, b = 0, c = 0): number {
  return lo + (hi - lo) * hash01(a, b, c)
}
