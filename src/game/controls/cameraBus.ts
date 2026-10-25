// Camera commands the UI can send to the active 3D view (reset, zoom, rotate), plus shared
// input state between the interaction handler and the camera rig.
export type CameraCommand = { type: 'reset' } | { type: 'zoom'; direction: 1 | -1 } | { type: 'rotate'; direction: 1 | -1 }

type Listener = (cmd: CameraCommand) => void
const listeners = new Set<Listener>()

export function onCameraCommand(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

function send(cmd: CameraCommand) {
  for (const l of listeners) l(cmd)
}

/** Animate the main game camera back to the default strategic view. */
export const resetCamera = () => send({ type: 'reset' })
/** Zoom the main game camera in (1) or out (-1) one step. */
export const zoomCamera = (direction: 1 | -1) => send({ type: 'zoom', direction })
/** Rotate the main game camera left (-1) or right (1) by 45 degrees. */
export const rotateCamera = (direction: 1 | -1) => send({ type: 'rotate', direction })

/** Shared between Interaction and CameraRig inside one canvas. */
export interface InputState {
  /** Space held: left-drag moves the camera even with a build tool. */
  spaceHeld: boolean
  /** A tool stroke is in progress (camera must not react to the left button). */
  painting: boolean
  /** The pointer is over the canvas (Space only means "pan" there). */
  pointerOver: boolean
  /** The canvas wrapper has keyboard focus: arrows move the cell cursor, Shift+arrows pan. */
  canvasFocused: boolean
}

export function createInputState(): InputState {
  return { spaceHeld: false, painting: false, pointerOver: false, canvasFocused: false }
}

/** Attribute on the canvas wrapper (SceneCanvas) so controls can find it from the canvas. */
export const CANVAS_WRAPPER_ATTR = 'data-amoria-canvas'
/** Attribute on the canvas's polite live region, used to announce the keyboard cursor. */
export const CANVAS_LIVE_ATTR = 'data-amoria-live'

function scrollsItself(el: HTMLElement): boolean {
  if (typeof getComputedStyle !== 'function') return false
  const st = getComputedStyle(el)
  const y = st.overflowY === 'auto' || st.overflowY === 'scroll'
  const x = st.overflowX === 'auto' || st.overflowX === 'scroll'
  return (y && el.scrollHeight > el.clientHeight) || (x && el.scrollWidth > el.clientWidth)
}

/**
 * True when a key event should not move the camera: typing in a field, focus inside a dialog
 * or a scrollable panel (whose own arrow keys and scrolling must keep working), an open modal
 * anywhere on the page, or a handler that already used the key.
 */
export function keyBlocksCamera(e: Pick<KeyboardEvent, 'target' | 'defaultPrevented'>): boolean {
  if (e.defaultPrevented) return true
  const t = e.target
  if (isTypingTarget(t)) return true
  if (typeof document !== 'undefined' && document.querySelector?.('[aria-modal="true"], dialog[open]')) return true
  if (!t || typeof (t as Element).closest !== 'function') return false
  const el = t as HTMLElement
  if (el.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog')) return true
  for (let n: HTMLElement | null = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    if (n.hasAttribute?.(CANVAS_WRAPPER_ATTR)) return false
    if (scrollsItself(n)) return true
  }
  return false
}

/** True when keyboard focus is in a text field, so game shortcuts should be ignored. */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!t || typeof (t as HTMLElement).tagName !== 'string') return false
  const el = t as HTMLElement
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true
}
