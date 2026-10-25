// Editing: hover, selection, the keyboard cursor, the live preview, tools and options, and
// undo and redo of edits within the current season.
import { validateAction } from '../../simulation/engine'
import { structureCode, type ActionValidation, type SimulationState } from '../../simulation/types'
import { undoMessage } from '../messages'
import type { GameStore } from '../storeTypes'
import { MAX_BRUSH, buildToolAction, toolCellsAt } from '../toolActions'
import { suggestedIntensity } from '../toolProbe'
import type { StoreCtx } from './context'

/** True while commitCursor builds at the keyboard cursor, so that commit keeps the cursor. */
let committingCursor = false

/** Where the keyboard cursor starts: the middle of the village if there is one, else the map centre. */
function cursorStart(sim: SimulationState): number {
  const { width, height } = sim.terrain
  const housing = structureCode('housing')
  let sx = 0
  let sz = 0
  let k = 0
  for (let i = 0; i < sim.layers.structure.length; i++) {
    if (sim.layers.structure[i] !== housing) continue
    sx += i % width
    sz += Math.floor(i / width)
    k++
  }
  if (!k) return Math.floor(height / 2) * width + Math.floor(width / 2)
  let best = -1
  let bestD = Infinity
  const cx = sx / k
  const cz = sz / k
  for (let i = 0; i < sim.layers.structure.length; i++) {
    if (sim.layers.structure[i] !== housing) continue
    const d = (i % width - cx) ** 2 + (Math.floor(i / width) - cz) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

export function editingActions(ctx: StoreCtx) {
  const { set, get, notify, tutorialEvent, saveGame, refreshPreview, record } = ctx
  return {
    setHoverCell: (i) => {
      const s = get()
      if (s.hoverCell === i) return
      // the pointer over another parcel takes over from the keyboard cursor (moveCursor never
      // calls this, so the keyboard path keeps its cursor)
      if (i !== null && s.cursorCell !== null && i !== s.cursorCell) {
        set({ hoverCell: i, cursorCell: null })
        refreshPreview(true)
        return
      }
      set({ hoverCell: i })
    },

    selectCell: (i) => {
      const s = get()
      if (i === null) set({ selectedCell: null, cursorCell: null })
      else if (s.cursorCell !== null && i !== s.cursorCell) {
        // picking another parcel (a click, a "show on map" link) hands control back to the pointer
        set({ selectedCell: i, cursorCell: null })
        refreshPreview(true)
      } else set({ selectedCell: i })
      if (i !== null) tutorialEvent('inspect')
    },

    setWorldView: (v) => {
      if (get().worldView !== v) set({ worldView: v })
    },

    setPreviewCells: (cells) => {
      const s = get()
      if (!cells || !cells.length || !s.sim) {
        if (s.preview) set({ preview: null })
        return
      }
      const action = buildToolAction(s.tool, cells, s.toolOptions)
      if (!action) {
        if (s.preview) set({ preview: null })
        return
      }
      const validation: ActionValidation =
        s.viewStep !== null
          ? { ok: false, cost: 0, cellOk: cells.map(() => false), reasons: ['You are viewing the past.'] }
          : validateAction(s.sim, action)
      // the action dedupes and sorts cells, so align validation with that order
      const ordered = 'cells' in action ? action.cells : cells
      set({ preview: { cells: ordered, validation } })
    },

    commitCells: (cells) => {
      const s = get()
      if (!s.sim || !cells.length) return
      // a build from the pointer means the pointer is in charge again
      if (!committingCursor && s.cursorCell !== null) set({ cursorCell: null })
      if (s.tool === 'inspect') {
        get().selectCell(cells[0])
        return
      }
      const action = buildToolAction(s.tool, cells, s.toolOptions)
      if (!action) return
      // the inspector follows the change only when it actually happened
      if (record(action, { fromRedo: false })?.ok) set({ selectedCell: cells[0] })
    },

    dispatch: (action) => record(action, { fromRedo: false }),

    moveCursor: (dx, dz) => {
      const s = get()
      if (!s.sim) return
      const { width, height } = s.sim.terrain
      const from = s.cursorCell ?? s.selectedCell
      let cell: number
      if (from === null) cell = cursorStart(s.sim)
      else {
        const x = Math.max(0, Math.min(width - 1, (from % width) + dx))
        const z = Math.max(0, Math.min(height - 1, Math.floor(from / width) + dz))
        cell = z * width + x
      }
      set({ cursorCell: cell, focusCell: cell })
      get().selectCell(cell)
      const after = get()
      if (after.tool !== 'inspect') after.setPreviewCells(toolCellsAt(after.tool, cell, after.brush, width, height))
      else if (after.preview) set({ preview: null })
      tutorialEvent('navigate')
    },

    commitCursor: () => {
      const s = get()
      if (!s.sim || s.cursorCell === null) return false
      if (s.tool === 'inspect') {
        s.selectCell(s.cursorCell)
        return true
      }
      const { width, height } = s.sim.terrain
      const cells = toolCellsAt(s.tool, s.cursorCell, s.brush, width, height)
      if (!cells.length) return false
      committingCursor = true
      try {
        s.commitCells(cells)
      } finally {
        committingCursor = false
      }
      // keep showing what the tool would do next at the same spot
      const after = get()
      if (after.cursorCell !== null && after.tool !== 'inspect') after.setPreviewCells(toolCellsAt(after.tool, after.cursorCell, after.brush, width, height))
      return true
    },

    clearCursor: () => set({ cursorCell: null, preview: null }),

    clearFocus: () => set({ focusCell: null }),

    requestFocus: (i) => set({ focusCell: i }),

    setTool: (t) => {
      const s = get()
      // Farming intensity starts on a level some field is not at yet, so it always has something to do
      const intensity = t === 'set-intensity' && s.sim ? suggestedIntensity(s.sim, s.toolOptions.intensity) : s.toolOptions.intensity
      set({
        tool: t,
        ...(intensity !== s.toolOptions.intensity ? { toolOptions: { ...s.toolOptions, intensity } } : {}),
      })
      refreshPreview(true)
    },

    setBrush: (n) => {
      set({ brush: Math.max(0, Math.min(MAX_BRUSH, Math.round(n))) })
      refreshPreview(true)
    },

    setToolOptions: (o) => {
      set({ toolOptions: { ...get().toolOptions, ...o } })
      refreshPreview(false)
    },

    setOverlay: (o) => {
      set({ overlay: o })
      if (o !== 'none') tutorialEvent('investigate')
    },

    undo: () => {
      const s = get()
      if (s.viewStep !== null) {
        notify('info', 'You are viewing the past. Return to the present to undo edits.')
        return
      }
      const last = s.undoStack[s.undoStack.length - 1]
      if (!last) {
        notify(
          'info',
          s.sim && s.sim.step > 0
            ? 'Nothing to undo this season. Seasons that already happened cannot be undone: scrub the timeline to look back, or save this run as Scenario A and branch to try another path.'
            : 'Nothing to undo yet.',
        )
        return
      }
      const undone = s.log[last.logLength]
      // the engine's record of the undone action (cost and any one-off revenue), when it is the last one
      const record = s.sim && s.sim.decisions.length > last.state.decisions.length ? s.sim.decisions[last.state.decisions.length] : undefined
      const budgetChange = s.sim ? last.state.economy.budget - s.sim.economy.budget : 0
      set({
        sim: last.state,
        log: s.log.slice(0, last.logLength),
        undoStack: s.undoStack.slice(0, -1),
        redoStack: undone ? [...s.redoStack, undone.action] : s.redoStack,
        preview: null,
      })
      notify('info', undoMessage(undone?.action, record, budgetChange))
      saveGame({ silent: true })
    },

    redo: () => {
      const s = get()
      if (s.viewStep !== null) {
        notify('info', 'You are viewing the past. Return to the present to redo edits.')
        return
      }
      const action = s.redoStack[s.redoStack.length - 1]
      if (!action) {
        notify('info', 'Nothing to redo.')
        return
      }
      const rest = s.redoStack.slice(0, -1)
      set({ redoStack: rest })
      const v = record(action, { fromRedo: true })
      // the engine refused the action (the world changed since): later redos built on it cannot apply either
      if (v && !v.ok) set({ redoStack: [] })
    },
  } satisfies Partial<GameStore>
}
