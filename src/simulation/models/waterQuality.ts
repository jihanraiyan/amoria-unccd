// Drinking-water quality at the town intakes. Sediment washed off eroding land reaches the river
// intakes; the waterworks can clean muddy water up to a point, beyond which part of the piped
// supply is not safe to drink. Roof tanks and shallow wells are not affected.
import { WATER_QUALITY } from '../params'
import { clamp } from './cells'

/** Sediment tonnes per 1000 m3 of river water passing the intakes. */
export function intakeSedimentConc(intakeSedimentT: number, intakeFlowM3: number): number {
  return intakeFlowM3 > 0 ? intakeSedimentT / (intakeFlowM3 / 1000) : 0
}

/** Share of piped water that is safe to drink, 0..1 (1 = clean). */
export function pipedWaterQuality(concTPer1000M3: number): number {
  const q = WATER_QUALITY.value
  const unsafe = clamp((concTPer1000M3 - q.safeConc) / (q.failConc - q.safeConc), 0, 1) * q.maxUnsafeShare
  return 1 - unsafe
}
