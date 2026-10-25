// Exogenous demographic pressure: natural increase plus a regional migration wave.
// Seeded and generated once; it never reads player state. How many of the would-be
// arrivals actually settle depends on housing, jobs, food and water (models/community).
import { DEMOGRAPHY } from '../params'
import { STREAM, signed, stream } from '../rng'
import type { DemographySeason } from '../types'

export function generateDemography(seed: number, seasons: number): DemographySeason[] {
  const rnd = stream(seed, STREAM.demography)
  const ng = DEMOGRAPHY.naturalGrowth.value
  const mg = DEMOGRAPHY.migration.value
  const out: DemographySeason[] = []
  for (let s = 0; s < seasons; s++) {
    const year = s / 2 + 1
    const wave = Math.exp(-0.5 * Math.pow((year - mg.waveYear) / mg.waveWidthYears, 2))
    out.push({
      naturalGrowthRate: Math.max(0, ng.base + ng.noise * signed(rnd)),
      migrationPressure: Math.max(0, mg.base + (mg.wavePeak - mg.base) * wave + mg.noise * signed(rnd)),
    })
  }
  return out
}

export function demographyForStep(seed: number, demography: DemographySeason[], step: number): DemographySeason {
  if (step < demography.length) return demography[step]
  return generateDemography(seed, step + 20)[step]
}
