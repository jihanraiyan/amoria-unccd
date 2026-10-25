// Camera limits and helpers, pure so they can be unit tested.

export interface CameraState {
  position: [number, number, number]
  target: [number, number, number]
}

export const CAMERA_LIMITS = {
  minDistance: 9,
  maxDistance: 105,
  /** radians from straight down; keeps an elevated strategic view */
  minPolar: 0.18,
  maxPolar: 1.18,
  /** minimum clearance of the camera above the terrain */
  clearance: 1.2,
}

/** Default strategic view for a map of the given size: south-east, about 50 degrees down. */
export function defaultCameraState(width: number, height: number, groundY = 0): CameraState {
  const size = Math.max(width, height)
  const dist = size * 0.95
  const polar = 0.86
  const azimuth = Math.PI * 0.2
  const tx = 0
  const tz = height * 0.06
  return {
    target: [tx, groundY, tz],
    position: [tx + Math.sin(azimuth) * Math.sin(polar) * dist, groundY + Math.cos(polar) * dist, tz + Math.cos(azimuth) * Math.sin(polar) * dist],
  }
}

/** Clamp a target point to the map rectangle (with a small margin). */
export function clampTarget(x: number, z: number, width: number, height: number, margin = 2): [number, number] {
  const hx = width / 2 + margin
  const hz = height / 2 + margin
  return [Math.min(hx, Math.max(-hx, x)), Math.min(hz, Math.max(-hz, z))]
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export function lerp3(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

export function sameCameraState(a: CameraState | null | undefined, b: CameraState | null | undefined, eps = 1e-3): boolean {
  if (!a || !b) return false
  for (let k = 0; k < 3; k++) {
    if (Math.abs(a.position[k] - b.position[k]) > eps) return false
    if (Math.abs(a.target[k] - b.target[k]) > eps) return false
  }
  return true
}

/** Half-size of the central part of the view (normalised device coordinates) a followed cell may sit in without moving the camera. */
export const FOCUS_SAFE_NDC = 0.6
/** Explicit focus requests bring the camera at least this close. */
export const FOCUS_MAX_DISTANCE = 32
export const FOCUS_DURATION_S = 0.9
export const FOLLOW_DURATION_S = 0.35

/**
 * Camera move for a focus request, or null when none is needed.
 * - 'focus' (an explicit request such as "show on map"): centre the cell and come in to at most
 *   FOCUS_MAX_DISTANCE, keeping the viewing direction.
 * - 'follow' (the keyboard parcel cursor): keep the distance and direction; do nothing while
 *   the cell is inside the central safe area of the view, otherwise pan just far enough to
 *   bring it back to the edge of that area. `ndc` is the cell projected by the camera (z > 1
 *   means behind it); null pans all the way.
 */
export function planFocus(cur: CameraState, cell: readonly [number, number, number], ndc: { x: number; y: number; z: number } | null, mode: 'focus' | 'follow'): CameraState | null {
  const off: [number, number, number] = [cur.position[0] - cur.target[0], cur.position[1] - cur.target[1], cur.position[2] - cur.target[2]]
  if (mode === 'focus') {
    const len = Math.hypot(off[0], off[1], off[2]) || 1
    const k = Math.min(len, FOCUS_MAX_DISTANCE) / len
    return { target: [cell[0], cell[1], cell[2]], position: [cell[0] + off[0] * k, cell[1] + off[1] * k, cell[2] + off[2] * k] }
  }
  const visible = ndc !== null && ndc.z < 1 && Number.isFinite(ndc.x) && Number.isFinite(ndc.y)
  const edge = visible ? Math.max(Math.abs(ndc.x), Math.abs(ndc.y)) : Infinity
  if (edge <= FOCUS_SAFE_NDC) return null
  const f = Number.isFinite(edge) ? Math.min(1, Math.max(0, 1 - FOCUS_SAFE_NDC / edge)) : 1
  const target: [number, number, number] = [cur.target[0] + (cell[0] - cur.target[0]) * f, cur.target[1] + (cell[1] - cur.target[1]) * f, cur.target[2] + (cell[2] - cur.target[2]) * f]
  return { target, position: [target[0] + off[0], target[1] + off[1], target[2] + off[2]] }
}

/** Rotate a camera offset (position minus target) about the vertical axis by `angle` radians. */
export function rotateOffsetY(off: readonly number[], angle: number): [number, number, number] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [off[0] * c - off[2] * s, off[1], off[0] * s + off[2] * c]
}

/**
 * Camera state a fraction `e` (0..1) of the way through an orbit of `angle` radians about the
 * fixed target of `from`. The azimuth is interpolated, so distance and height stay constant
 * the whole way round (a straight line between the end positions would cut in toward the target).
 */
export function orbitAt(from: CameraState, angle: number, e: number): CameraState {
  const t = from.target
  const off = rotateOffsetY([from.position[0] - t[0], from.position[1] - t[1], from.position[2] - t[2]], angle * e)
  return { target: [t[0], t[1], t[2]], position: [t[0] + off[0], t[1] + off[1], t[2] + off[2]] }
}
