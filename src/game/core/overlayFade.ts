// The one easing rule for an overlay fading in and out, shared by the terrain overlay, the prop
// ghosting and the fog push so they move together. Exponential approach at 4 per second that
// lands exactly on the target; reduced motion snaps.
export const OVERLAY_FADE_RATE = 4

export function easeOverlayMix(current: number, target: number, dt: number, reducedMotion: boolean): number {
  if (reducedMotion) return target
  const k = Math.min(1, dt * OVERLAY_FADE_RATE)
  const next = current + (target - current) * k
  return Math.abs(target - next) < 0.01 ? target : next
}
