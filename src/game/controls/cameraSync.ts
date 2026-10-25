// Camera sharing between views: every view with the same syncGroup shows the same camera, so
// split-screen and before/after comparisons stay aligned while you move either one.
// The view the player last touched is the group's leader: it publishes its camera, and the
// other views (followers) only apply what they receive and never publish it back. That keeps
// one source of truth and avoids views nudging each other every frame.
import type { CameraState } from './cameraMath'

interface Group {
  state: CameraState | null
  leader: symbol | null
  listeners: Set<(s: CameraState, from: symbol) => void>
}

const groups = new Map<string, Group>()

function group(name: string): Group {
  let g = groups.get(name)
  if (!g) {
    g = { state: null, leader: null, listeners: new Set() }
    groups.set(name, g)
  }
  return g
}

export function getGroupCamera(name: string): CameraState | null {
  return groups.get(name)?.state ?? null
}

/** Publish a camera from one view (identified by `from`) to the rest of its group. */
export function publishGroupCamera(name: string, state: CameraState, from: symbol): void {
  const g = group(name)
  g.state = state
  for (const l of g.listeners) l(state, from)
}

export function subscribeGroupCamera(name: string, cb: (s: CameraState, from: symbol) => void): () => void {
  const g = group(name)
  g.listeners.add(cb)
  return () => {
    g.listeners.delete(cb)
    if (!g.listeners.size) groups.delete(name)
  }
}

/** Mark a view as the one the player is moving. */
export function claimGroupLeader(name: string, who: symbol): void {
  group(name).leader = who
}

/** Give up leadership (e.g. when the view unmounts). */
export function releaseGroupLeader(name: string, who: symbol): void {
  const g = groups.get(name)
  if (g && g.leader === who) g.leader = null
}

/** True when another view of the group currently leads, so this one only follows. */
export function isGroupFollower(name: string, who: symbol): boolean {
  const g = groups.get(name)
  return !!g && g.leader !== null && g.leader !== who
}

/** True when this view leads its group. */
export function isGroupLeader(name: string, who: symbol): boolean {
  return groups.get(name)?.leader === who
}
