// Deterministic seeded PRNG (mulberry32). Never use Math.random in simulation code.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stable hash of integers to a 32-bit seed (for deriving sub-streams). */
export function hashSeed(...parts: number[]): number {
  let h = 2166136261
  for (const p of parts) {
    h ^= p >>> 0
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Named sub-stream tags so independent systems never share random draws. */
export const STREAM = {
  weather: 101,
  weatherDesign: 102,
  demography: 201,
  soil: 301,
} as const

/** Independent seeded stream for one subsystem. */
export function stream(seed: number, tag: number): () => number {
  return mulberry32(hashSeed(seed, tag))
}

/** Uniform in [-1, 1). */
export const signed = (rnd: () => number): number => rnd() * 2 - 1
