// Global keyboard shortcuts for tools, time, panels and the keyboard parcel cursor.
// Ignored while typing in a text field; sliders keep their arrow keys and checkboxes keep Space.
// Left free for the camera (src/game/controls/CameraRig): W A S D and plain arrows pan, Q E
// rotate, - and = zoom, Home resets, and holding Space lets left-drag pan with any tool.
// Shift plus an arrow moves the parcel cursor instead (the handler prevents the default, which
// the camera reads as "not mine") and moves focus to the cursor read-out, so Enter applies the
// active tool there rather than pressing whichever button had focus.
import { useEffect } from 'react'
import { useGame, type PanelId, type Speed } from '../state/store'
import { CURSOR_ANCHOR_ID } from '../ui/hud/cursorAnchor'
import { TOOL_BY_KEY } from '../ui/toolbar/tools'

const PANEL_KEYS: Record<string, PanelId> = {
  '1': 'overlays',
  '2': 'budget',
  '3': 'community',
  '4': 'insights',
  '5': 'charts',
  '6': 'objectives',
  '?': 'settings',
}

const CAMERA_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Equal', 'Minus', 'Home'])

const CURSOR_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
}

/** Input types that take typed text, where letters and Enter belong to the field. */
const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'datetime-local', 'month', 'time', 'week'])

/** Keys a focused slider uses to change its value. */
const SLIDER_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'])

/** True when the focused control should keep this key for itself instead of it being a shortcut. */
function ownedByControl(target: EventTarget | null, e: KeyboardEvent): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true
  if (!(target instanceof HTMLInputElement)) return false
  const type = target.type.toLowerCase()
  if (type === 'range') return SLIDER_KEYS.has(e.key)
  if (type === 'checkbox' || type === 'radio') return e.key === ' ' || (type === 'radio' && SLIDER_KEYS.has(e.key))
  if (type === 'button' || type === 'submit' || type === 'reset' || type === 'color' || type === 'file') return e.key === ' ' || e.key === 'Enter'
  return TEXT_INPUTS.has(type) || type === ''
}

/** True when Enter on this element should press it (a button or link) rather than build. */
function activates(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return !!target.closest('button, a[href], summary, [role="button"], [role="radio"], [role="tab"], [role="checkbox"], [role="menuitem"]')
}

/**
 * True right after Shift and an arrow moved the parcel cursor, until the player presses another
 * key, clicks, or moves focus somewhere else. While it is set, Enter builds at the cursor even if
 * a button somewhere still has focus.
 */
let cursorArmed = false

/** Moves focus to the cursor read-out so a following Enter belongs to the cursor, not to a button. */
function focusCursorAnchor(): void {
  const anchor = document.getElementById(CURSOR_ANCHOR_ID)
  if (anchor && document.activeElement !== anchor) anchor.focus({ preventScroll: true })
}

export function handleShortcut(e: KeyboardEvent): boolean {
  const s = useGame.getState()
  if (s.screen !== 'game' || !s.sim || s.reportOpen) return false
  if (ownedByControl(e.target, e)) return false
  const mod = e.ctrlKey || e.metaKey
  const key = e.key
  const armed = cursorArmed
  if (key !== 'Shift' && key !== 'Enter') cursorArmed = false

  if (mod && key.toLowerCase() === 'z') {
    if (e.shiftKey) s.redo()
    else s.undo()
    return true
  }
  if (mod && key.toLowerCase() === 'y') {
    s.redo()
    return true
  }
  if (mod || e.altKey) return false

  // keyboard parcel cursor
  const move = CURSOR_KEYS[e.code]
  if (move && e.shiftKey) {
    s.moveCursor(move[0], move[1])
    focusCursorAnchor()
    cursorArmed = true
    return true
  }
  if (key === 'Enter' && s.cursorCell !== null && (armed || !activates(e.target))) {
    if (s.viewStep !== null && s.tool !== 'inspect') {
      s.notify('info', 'You are viewing the past. Return to the present to build.')
      return true
    }
    return s.commitCursor()
  }

  // camera keys belong to the renderer; they still count as "looking around" for the tutorial
  if (CAMERA_KEYS.has(e.code)) {
    // the flat map has no camera: there the arrows move the parcel cursor, which counts itself
    if (s.worldView === '3d') s.tutorialEvent('navigate')
    return false
  }

  if (key === 'p' || key === 'P') {
    s.togglePlay()
    return true
  }
  if (key === '.') {
    s.stepSeason()
    return true
  }
  if (key === 'y' || key === 'Y') {
    s.stepYear()
    return true
  }
  if (key === '>') {
    s.setSpeed(Math.min(3, s.speed + 1) as Speed)
    return true
  }
  if (key === '<') {
    s.setSpeed(Math.max(1, s.speed - 1) as Speed)
    return true
  }
  if (key === '[') {
    s.setBrush(s.brush - 1)
    return true
  }
  if (key === ']') {
    s.setBrush(s.brush + 1)
    return true
  }
  if (key === 'Escape') {
    if (s.viewStep !== null) s.viewHistory(null)
    else if (s.panel) s.openPanel(null)
    else if (s.cursorCell !== null || s.preview) s.clearCursor()
    else if (s.tool !== 'inspect') s.setTool('inspect')
    else if (s.selectedCell !== null) s.selectCell(null)
    else return false
    return true
  }
  const panel = PANEL_KEYS[key]
  if (panel) {
    s.togglePanel(panel)
    return true
  }
  const tool = TOOL_BY_KEY[key.toLowerCase()]
  if (tool && key.length === 1) {
    if (s.viewStep !== null && tool !== 'inspect') {
      s.notify('info', 'You are viewing the past. Return to the present to use building tools.')
      return true
    }
    s.setTool(tool)
    return true
  }
  return false
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (handleShortcut(e)) e.preventDefault()
    }
    const disarm = () => {
      cursorArmed = false
    }
    const onFocus = (e: FocusEvent) => {
      if (!(e.target instanceof HTMLElement) || e.target.id !== CURSOR_ANCHOR_ID) cursorArmed = false
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', disarm, true)
    window.addEventListener('focusin', onFocus)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', disarm, true)
      window.removeEventListener('focusin', onFocus)
    }
  }, [])
}
