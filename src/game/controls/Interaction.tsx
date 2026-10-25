// Pointer input on the game canvas: heightfield picking to a cell, hover, click to inspect,
// click or drag to apply the active tool. Raycasts happen at most once per frame. The store
// owns validation and actions: the renderer only reports cells (setHoverCell, setPreviewCells,
// commitCells, selectCell).
// Keyboard: when the canvas has focus, arrow keys move a parcel cursor (relative to the way
// the camera faces), Enter inspects that parcel or applies the active tool there, and the
// cursor's parcel is announced through the canvas's polite live region. W A S D still pan.
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Raycaster, Vector2, Vector3 } from 'three'
import { useGame } from '../../state/store'
import { hoverCellsForTool, sameCells, strokeCellsForTool, toolMode } from '../core/brush'
import { heightAt, worldBounds, worldToCell, type GridDims } from '../core/coords'
import { raycastHeightfield } from '../core/raycast'
import { cursorAnnouncement } from './announce'
import { CANVAS_LIVE_ATTR, CANVAS_WRAPPER_ATTR, type InputState } from './cameraBus'

const ARROWS: Record<string, [number, number]> = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }

/** Grid step for an arrow key, relative to the camera's facing on the ground plane. */
export function arrowStep(key: string, forwardX: number, forwardZ: number): [number, number] | null {
  const a = ARROWS[key]
  if (!a) return null
  const quant = (x: number, z: number): [number, number] => (Math.abs(x) >= Math.abs(z) ? [Math.sign(x) || 1, 0] : [0, Math.sign(z) || 1])
  const fwd = quant(forwardX, forwardZ)
  const right: [number, number] = [-fwd[1], fwd[0]]
  return [fwd[0] * a[1] + right[0] * a[0], fwd[1] * a[1] + right[1] * a[0]]
}

export interface InteractionProps {
  dims: GridDims
  heights: Float32Array
  input: InputState
  /** When true (viewing a past snapshot) tools are disabled; hover and inspect still work. */
  readOnly: boolean
}

const CLICK_PX = 6

export function Interaction({ dims, heights, input, readOnly }: InteractionProps) {
  const { camera, gl } = useThree()
  const st = useRef({
    ndc: new Vector2(),
    inside: false,
    dirty: false,
    hover: -1,
    path: [] as number[],
    down: null as null | { x: number; y: number; button: number },
    lastPreview: null as number[] | null,
    /** keyboard cursor active (the pointer has not moved since) and its cell */
    kbd: false,
    kbdCell: -1,
  })
  const raycaster = useRef(new Raycaster())
  const frameUpdate = useRef<null | (() => void)>(null)
  const readOnlyRef = useRef(readOnly)
  useEffect(() => {
    readOnlyRef.current = readOnly
  })

  useEffect(() => {
    const el = gl.domElement
    const s = st.current
    let maxY = 0
    for (let i = 0; i < heights.length; i++) maxY = Math.max(maxY, heights[i])
    const [minX, maxX, minZ, maxZ] = worldBounds(dims)
    const bounds = { minX, maxX, minZ, maxZ, maxY }
    const sample = (x: number, z: number) => heightAt(heights, dims, x, z)

    const pick = (): number => {
      if (!s.inside) return -1
      raycaster.current.setFromCamera(s.ndc, camera)
      const { origin, direction } = raycaster.current.ray
      const hit = raycastHeightfield(origin, direction, sample, bounds, 0.2)
      return hit ? worldToCell(hit.x, hit.z, dims) : -1
    }
    const setPointer = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      s.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      s.inside = true
      s.dirty = true
    }
    const activeTool = () => (readOnlyRef.current ? 'inspect' : useGame.getState().tool)
    const pushPreview = (cells: number[] | null) => {
      const next = cells && cells.length ? cells : null
      if (sameCells(next, s.lastPreview) || (next === null && s.lastPreview === null)) return
      s.lastPreview = next
      useGame.getState().setPreviewCells(next)
    }
    const cancelStroke = () => {
      if (!input.painting) return
      input.painting = false
      s.path = []
      s.dirty = true
    }

    const onMove = (e: PointerEvent) => {
      s.kbd = false
      setPointer(e)
    }
    const onEnter = () => {
      input.pointerOver = true
    }
    const onDown = (e: PointerEvent) => {
      setPointer(e)
      s.down = { x: e.clientX, y: e.clientY, button: e.button }
      if (e.button !== 0 || input.spaceHeld) return
      const tool = activeTool()
      if (toolMode(tool) === 'inspect') return
      const cell = pick()
      if (cell < 0) return
      input.painting = true
      s.path = [cell]
      s.hover = cell
      pushPreview(strokeCellsForTool(tool, s.path, useGame.getState().brush, dims.width, dims.height))
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* capture is best-effort */
      }
    }
    const onUp = (e: PointerEvent) => {
      setPointer(e)
      const down = s.down
      s.down = null
      if (e.button !== 0) return
      const tool = activeTool()
      if (input.painting) {
        const cell = pick()
        if (cell >= 0 && cell !== s.path[s.path.length - 1]) s.path.push(cell)
        const cells = strokeCellsForTool(tool, s.path, useGame.getState().brush, dims.width, dims.height)
        input.painting = false
        s.path = []
        s.lastPreview = null
        if (cells.length) useGame.getState().commitCells(cells)
        s.dirty = true
        return
      }
      if (toolMode(tool) === 'inspect' && down && !input.spaceHeld && Math.hypot(e.clientX - down.x, e.clientY - down.y) < CLICK_PX) {
        const cell = pick()
        useGame.getState().selectCell(cell >= 0 ? cell : null)
      }
    }
    const onLeave = () => {
      input.pointerOver = false
      input.spaceHeld = false
      if (input.painting || s.kbd) return
      s.inside = false
      s.hover = -1
      useGame.getState().setHoverCell(null)
      pushPreview(null)
    }
    // Escape cancels a stroke in progress (the UI's own Escape shortcut handles the rest)
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') cancelStroke()
    }
    // ---- keyboard cursor on the focused canvas wrapper
    const wrapper = el.closest(`[${CANVAS_WRAPPER_ATTR}]`) as HTMLElement | null
    const live = wrapper?.querySelector(`[${CANVAS_LIVE_ATTR}]`) ?? null
    const announce = (cell: number) => {
      const g = useGame.getState()
      if (!live || !g.sim) return
      live.textContent = cursorAnnouncement(cell, g.sim.terrain, g.viewSnapshot?.layers ?? g.sim.layers, activeTool(), g.viewSnapshot != null)
    }
    const keyboardPreview = () => {
      if (s.kbdCell < 0) return
      pushPreview(hoverCellsForTool(activeTool(), s.kbdCell, useGame.getState().brush, dims.width, dims.height))
    }
    const fwd = new Vector3()
    // only keyboard focus (Tab) turns arrows into the cursor; a mouse click that focuses the
    // canvas leaves arrows panning the camera as before
    const keyboardFocus = (el2: HTMLElement) => {
      try {
        return el2.matches(':focus-visible')
      } catch {
        return true
      }
    }
    const onFocus = (e: FocusEvent) => {
      if (e.target === wrapper && wrapper) input.canvasFocused = keyboardFocus(wrapper)
    }
    const onBlur = (e: FocusEvent) => {
      if (e.target === wrapper) input.canvasFocused = false
    }
    const onWrapperKey = (e: KeyboardEvent) => {
      if (e.target !== wrapper || !input.canvasFocused || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
      const g = useGame.getState()
      if (g.reportOpen || g.screen !== 'game' || !g.sim) return
      // The store may own a keyboard cursor (cursorCell, moveCursor, commitCursor); when it
      // does, the canvas drives that one so there is only ever one cursor. Otherwise the
      // canvas keeps its own cursor on the hover cell.
      const storeCursor = typeof g.moveCursor === 'function' && typeof g.commitCursor === 'function'
      if (ARROWS[e.code] && !e.shiftKey) {
        e.preventDefault()
        if (input.painting) return
        camera.getWorldDirection(fwd)
        const [dx, dz] = arrowStep(e.code, fwd.x, fwd.z)!
        if (storeCursor) {
          g.moveCursor(dx, dz)
          const c = useGame.getState().cursorCell
          if (c !== null && c !== undefined) announce(c)
          return
        }
        const centre = Math.floor(dims.height / 2) * dims.width + Math.floor(dims.width / 2)
        const from = s.kbdCell >= 0 && s.kbd ? s.kbdCell : (g.hoverCell ?? g.selectedCell ?? centre)
        const x = Math.min(dims.width - 1, Math.max(0, (from % dims.width) + dx))
        const z = Math.min(dims.height - 1, Math.max(0, Math.floor(from / dims.width) + dz))
        const cell = z * dims.width + x
        s.kbd = true
        s.kbdCell = cell
        s.hover = cell
        g.setHoverCell(cell)
        keyboardPreview()
        announce(cell)
        return
      }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        // handled here only, so a global Enter shortcut cannot apply the tool a second time
        if (storeCursor && g.cursorCell !== null && g.cursorCell !== undefined) {
          e.preventDefault()
          e.stopPropagation()
          g.commitCursor()
          return
        }
        const cell = s.kbd && s.kbdCell >= 0 ? s.kbdCell : (g.hoverCell ?? -1)
        if (cell < 0) return
        e.preventDefault()
        e.stopPropagation()
        const tool = activeTool()
        if (toolMode(tool) === 'inspect') g.selectCell(cell)
        else {
          const cells = hoverCellsForTool(tool, cell, g.brush, dims.width, dims.height)
          s.lastPreview = null
          if (cells.length) g.commitCells(cells)
          s.dirty = true
        }
      }
    }
    if (wrapper) {
      wrapper.addEventListener('focus', onFocus)
      wrapper.addEventListener('blur', onBlur)
      wrapper.addEventListener('keydown', onWrapperKey)
      input.canvasFocused = typeof document !== 'undefined' && document.activeElement === wrapper && keyboardFocus(wrapper)
    }

    el.addEventListener('pointerenter', onEnter)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', cancelStroke)
    el.addEventListener('pointerleave', onLeave)
    window.addEventListener('keydown', onKey)
    // tool or brush changes refresh the preview; switching tools cancels a stroke; a new
    // simulation state (action applied, time advanced) re-validates the current preview
    const unsub = useGame.subscribe((n, p) => {
      if (n.tool !== p.tool) cancelStroke()
      if (n.tool !== p.tool || n.brush !== p.brush) s.dirty = true
      if (n.sim !== p.sim && s.lastPreview) {
        s.lastPreview = null
        s.dirty = true
      }
    })
    // expose the per-frame update to useFrame
    frameUpdate.current = () => {
      if (!s.dirty) return
      s.dirty = false
      if (s.kbd) {
        keyboardPreview()
        return
      }
      const cell = pick()
      if (cell !== s.hover) {
        s.hover = cell
        useGame.getState().setHoverCell(cell >= 0 ? cell : null)
      }
      const tool = activeTool()
      const brush = useGame.getState().brush
      if (input.painting) {
        if (cell >= 0 && cell !== s.path[s.path.length - 1]) s.path.push(cell)
        pushPreview(strokeCellsForTool(tool, s.path, brush, dims.width, dims.height))
      } else pushPreview(cell >= 0 ? hoverCellsForTool(tool, cell, brush, dims.width, dims.height) : null)
    }
    return () => {
      el.removeEventListener('pointerenter', onEnter)
      el.removeEventListener('pointermove', onMove)
      if (wrapper) {
        wrapper.removeEventListener('focus', onFocus)
        wrapper.removeEventListener('blur', onBlur)
        wrapper.removeEventListener('keydown', onWrapperKey)
      }
      input.canvasFocused = false
      input.pointerOver = false
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', cancelStroke)
      el.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('keydown', onKey)
      unsub()
      frameUpdate.current = null
      input.painting = false
      useGame.getState().setHoverCell(null)
      if (s.lastPreview) useGame.getState().setPreviewCells(null)
      s.lastPreview = null
    }
  }, [gl, camera, dims, heights, input])

  // the camera moves under a still pointer, so re-pick while it is moving
  const lastCam = useRef({ x: 0, y: 0, z: 0 })
  useFrame(() => {
    const c = camera.position
    const l = lastCam.current
    if (c.x !== l.x || c.y !== l.y || c.z !== l.z) {
      st.current.dirty = st.current.dirty || st.current.inside
      l.x = c.x
      l.y = c.y
      l.z = c.z
    }
    frameUpdate.current?.()
  })
  return null
}
