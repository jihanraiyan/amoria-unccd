// Pure sizing and motion rules for the runoff chevrons, shared by the shader and the tests.
// Bigger flows draw larger AND move faster; every chevron travels the same short world
// distance so it stays on its own cell's flow segment.

/** Instance scale of a chevron for a normalised flow strength 0..1. */
export const ARROW_SIZE_BASE = 0.45
export const ARROW_SIZE_GAIN = 0.75
export const arrowSize = (strength: number) => ARROW_SIZE_BASE + ARROW_SIZE_GAIN * clamp01(strength)

/** World distance one chevron slides per cycle (under half a cell, so it never leaves its segment). */
export const ARROW_TRAVEL = 0.42

/** Cycles per second of the slide: weak flows drift, strong flows run. */
export const ARROW_SPEED_BASE = 0.25
export const ARROW_SPEED_GAIN = 0.35
export const arrowSpeed = (strength: number) => ARROW_SPEED_BASE + ARROW_SPEED_GAIN * clamp01(strength)

/** Local-space slide amplitude the shader applies before the instance scale. */
export const arrowLocalTravel = (strength: number) => ARROW_TRAVEL / arrowSize(strength)

/** World-space slide distance per cycle (local travel times instance scale). */
export const arrowWorldTravel = (strength: number) => arrowLocalTravel(strength) * arrowSize(strength)

/** World-space speed of the slide (distance per second). */
export const arrowWorldSpeed = (strength: number) => arrowWorldTravel(strength) * arrowSpeed(strength)

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
