// Game store. Owned by the UI/state team. Field names marked [render-contract] (see
// ./storeTypes) are read by src/game/** and must not be renamed without updating the renderer.
//
// The store is the only place that calls the engine for the live run. UI components
// dispatch PlayerActions through it and never edit simulation state directly. The actions
// live in focused slices under ./slices and are composed here.
import { create } from 'zustand'
import type { GameStore } from './storeTypes'
import { hasStoredSave } from './persistence'
import { loadSettings, persistSettings, sanitizeSettings } from './settings'
import { STORAGE_KEYS, removeItem, writeItem } from './storage'
import { DEFAULT_TOOL_OPTIONS } from './toolActions'
import { TUTORIAL_OFF, TUTORIAL_START } from './tutorial'
import { makeContext } from './slices/context'
import { compareActions } from './slices/compareActions'
import { editingActions } from './slices/editing'
import { persistenceActions } from './slices/persistenceActions'
import { clearTimer, emptyCompare, readTutorialDone, runDefaults } from './slices/runtime'
import { timeActions } from './slices/time'

export type { ToolId, ToolOptions } from './toolActions'
export type { LogEntry } from './replay'
export type { ScenarioId, ScenarioSlot } from './persistence'
export type { CompareState, Feedback, GameStore, LoadErrorKind, OverlayId, PanelId, RunData, Speed, Toast, ToastAnnouncement } from './storeTypes'
export { SPEED_MS, speedLabel } from './slices/runtime'

const initialSettings = loadSettings()

export const useGame = create<GameStore>((set, get) => {
  const ctx = makeContext(set, get)
  const { notify, tutorialEvent, saveGame } = ctx
  return {
    screen: 'landing',
    ...runDefaults,
    tool: 'inspect',
    brush: 0,
    overlay: 'none',
    reducedMotion: initialSettings.reducedMotion,
    quality: initialSettings.quality,
    colorblind: initialSettings.colorblind,
    worldId: null,
    seed: 0,
    speed: 1,
    toolOptions: DEFAULT_TOOL_OPTIONS,
    settings: initialSettings,
    panel: null,
    feedback: null,
    tutorial: readTutorialDone() ? TUTORIAL_OFF : TUTORIAL_START,
    busy: false,
    loadError: null,
    loadErrorKind: null,
    hasSave: hasStoredSave(),
    worldView: null,
    loadProgress: null,
    lastSavedAt: null,
    autosaveFailed: false,
    runId: null,
    runLabel: null,
    scenarios: { A: null, B: null },
    compare: emptyCompare(),

    ...editingActions(ctx),
    ...timeActions(ctx),
    ...persistenceActions(ctx),
    ...compareActions(ctx),
    saveGame,
    notify,
    tutorialEvent,

    updateSettings: (p) => {
      const settings = sanitizeSettings({ ...get().settings, ...p }, get().settings)
      set({ settings, quality: settings.quality, reducedMotion: settings.reducedMotion, colorblind: settings.colorblind })
      if (!persistSettings(settings)) notify('warning', 'Settings changed, but this browser would not store them for next time.')
    },

    openPanel: (p) => {
      set(p === 'insights' ? { panel: p, seenExplanations: get().explanations.length } : { panel: p })
      if (p === 'budget') tutorialEvent('see-cost')
    },

    togglePanel: (p) => get().openPanel(get().panel === p ? null : p),

    openExplanation: (id) => {
      if (id === null) {
        set({ activeExplanationId: null })
        return
      }
      const s = get()
      const e = s.explanations.find((x) => x.id === id)
      set({ activeExplanationId: id, panel: 'insights', seenExplanations: s.explanations.length })
      if (e?.cells?.length) {
        const cell = e.cells[0]
        set({ focusCell: cell, selectedCell: cell, ...(s.cursorCell !== null && s.cursorCell !== cell ? { cursorCell: null } : {}) })
      }
      tutorialEvent('investigate')
    },

    dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

    clearFeedback: (id) => {
      if (get().feedback?.id === id) set({ feedback: null })
    },

    skipTutorial: () => {
      set({ tutorial: TUTORIAL_OFF })
      writeItem(STORAGE_KEYS.tutorial, 'done')
    },

    restartTutorial: () => {
      // forget the "done" flag and save, so the replayed tutorial survives a reload
      removeItem(STORAGE_KEYS.tutorial)
      set({ tutorial: TUTORIAL_START })
      saveGame({ silent: true })
    },

    closeReport: () => set({ reportOpen: false }),

    openReport: () => set({ reportOpen: true, playing: false }),
  }
})

/** Test helper: stop the play timer. */
export const stopClock = (): void => clearTimer()
