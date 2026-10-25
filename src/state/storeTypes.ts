// Store types. Field names marked [render-contract] are read by src/game/** and must not be
// renamed without updating the renderer. Re-exported from ./store.
import type { ActionValidation, Explanation, PlayerAction, SimulationState, Snapshot, WorldInput } from '../simulation/types'
import type { ScenarioId, ScenarioSlot } from './persistence'
import type { LogEntry } from './replay'
import type { Settings } from './settings'
import type { ToolId, ToolOptions } from './toolActions'
import type { TutorialEvent, TutorialState } from './tutorial'

export type OverlayId =
  | 'none'
  | 'landcover'
  | 'elevation'
  | 'slope'
  | 'runoff'
  | 'soil'
  | 'erosion'
  | 'productivity'
  | 'moisture'
  | 'sensitivity'
  | 'susceptibility'
  | 'urban'

export type PanelId = 'overlays' | 'budget' | 'community' | 'insights' | 'charts' | 'objectives' | 'settings'

export type Speed = 1 | 2 | 3

/** What a load error was about: the stored save itself, the world data, or the engine starting up. */
export type LoadErrorKind = 'save' | 'world' | 'engine'

export interface Feedback {
  id: number
  kind: 'ok' | 'error' | 'info' | 'warning'
  text: string
}

export interface Toast {
  id: number
  title: string
  body: string
  severity: Explanation['severity']
  /** Explanation to open when the toast is clicked. */
  explanationId?: string
  cells?: number[]
  /** Set when this news paused play: the toast stays until dismissed and offers the place on the map. */
  paused?: boolean
}

/** One screen-reader line for a season's toasts (the toasts themselves are not a live region). */
export interface ToastAnnouncement {
  id: number
  text: string
}

/** A finished or ongoing run held in memory for Compare Futures. */
export interface RunData {
  slot: ScenarioSlot
  state: SimulationState
  snapshots: Snapshot[]
  /** Every explanation the run produced, oldest first (the start briefing included). */
  explanations: Explanation[]
}

export interface CompareState {
  A: RunData | null
  B: RunData | null
  loading: boolean
  error: string | null
  /** Step shown in the landscape views (both runs at the same season). */
  step: number
}

export interface GameStore {
  screen: 'landing' | 'game' | 'compare'
  /** [render-contract] live simulation state */
  sim: SimulationState | null
  /** [render-contract] when non-null the renderer shows this past snapshot read-only */
  viewSnapshot: Snapshot | null
  /** [render-contract] */
  tool: ToolId
  /** [render-contract] brush radius in cells (0 = single cell) */
  brush: number
  /** [render-contract] */
  hoverCell: number | null
  /** [render-contract] */
  selectedCell: number | null
  /** [render-contract] cells the current drag/brush would affect, with validation */
  preview: { cells: number[]; validation: ActionValidation } | null
  /** [render-contract] */
  overlay: OverlayId
  /** [render-contract] respects prefers-reduced-motion + settings */
  reducedMotion: boolean
  /** [render-contract] 'high' | 'low' render quality */
  quality: 'high' | 'low'
  /** [render-contract] camera focus request; renderer animates to it then clears it */
  focusCell: number | null
  /** [render-contract] true when the player asked for the colorblind-safe palette */
  colorblind: boolean

  // run identity and history
  worldId: string | null
  seed: number
  world: WorldInput | null
  log: LogEntry[]
  /** snapshots[k] = world at the start of season k; index 0 is the initial world. */
  snapshots: Snapshot[]
  /** Step being viewed in history mode, or null for the present. */
  viewStep: number | null
  explanations: Explanation[]
  /** How many explanations the player had when Insights was last open (drives the badge). */
  seenExplanations: number
  undoStack: { state: SimulationState; logLength: number }[]
  redoStack: PlayerAction[]

  /**
   * Parcel under the keyboard cursor (Shift+arrows), or null when the pointer is in charge.
   * Hovering another parcel, clicking one or building with the pointer hands control back.
   */
  cursorCell: number | null

  /**
   * How the world is drawn right now: the 3D view, the flat fallback map, or null while
   * nothing is mounted yet. Set by the app shell; camera controls only show for '3d'.
   */
  worldView: '3d' | 'flat' | null
  setWorldView(v: '3d' | 'flat' | null): void

  /** Seasons replayed so far while a save or Scenario A is being rebuilt, or null when idle. */
  loadProgress: { done: number; total: number } | null

  // time
  playing: boolean
  speed: Speed

  // tools
  toolOptions: ToolOptions

  // ui
  settings: Settings
  panel: PanelId | null
  activeExplanationId: string | null
  toasts: Toast[]
  /**
   * What the toast live region reads after a season: every toast, merged into one line, when
   * the player stepped by hand; only warnings and critical ones while playing. Null when
   * nothing should be read.
   */
  toastAnnouncement: ToastAnnouncement | null
  feedback: Feedback | null
  tutorial: TutorialState
  reportOpen: boolean
  reportShown: boolean
  busy: boolean
  loadError: string | null
  /** Only 'save' errors offer to delete the stored save. */
  loadErrorKind: LoadErrorKind | null
  hasSave: boolean
  lastSavedAt: string | null
  /** True after an automatic save failed, until the next save succeeds. */
  autosaveFailed: boolean
  /** Identifies this run (made when it starts, kept across reloads); keys the reflection notes. */
  runId: string | null

  // scenarios
  runLabel: ScenarioId | null
  scenarios: { A: ScenarioSlot | null; B: ScenarioSlot | null }
  compare: CompareState

  // renderer-facing
  setHoverCell(i: number | null): void
  selectCell(i: number | null): void
  /** Called by the renderer while hovering/dragging with a tool; store computes validation. */
  setPreviewCells(cells: number[] | null): void
  /** Called by the renderer on pointer-up / click with the tool's affected cells. */
  commitCells(cells: number[]): void
  dispatch(action: PlayerAction): ActionValidation | null
  /** Moves the keyboard parcel cursor by (dx, dz) cells, selecting and previewing as it goes. */
  moveCursor(dx: number, dz: number): void
  /** Applies the active tool at the keyboard cursor (Enter). Returns false if nothing happened. */
  commitCursor(): boolean
  /** Drops the keyboard cursor and its preview (Escape). */
  clearCursor(): void
  clearFocus(): void
  requestFocus(i: number | null): void

  // lifecycle
  newGame(worldId: string, seed?: number, opts?: { runLabel?: ScenarioId | null; keepScenarios?: boolean }): Promise<boolean>
  continueGame(): Promise<boolean>
  saveGame(opts?: { silent?: boolean }): boolean
  resetRun(): Promise<boolean>
  /** Saves and returns to the title. If the save fails it warns and stays; a second call while that warning shows leaves anyway. */
  exitToLanding(): void
  discardSave(): void
  dismissLoadError(): void

  // tools
  setTool(t: ToolId): void
  setBrush(n: number): void
  setToolOptions(o: Partial<ToolOptions>): void
  setOverlay(o: OverlayId): void

  // time
  stepSeason(): void
  stepYear(): void
  setPlaying(p: boolean): void
  togglePlay(): void
  setSpeed(s: Speed): void
  undo(): void
  redo(): void
  viewHistory(step: number | null): void

  // ui
  updateSettings(p: Partial<Settings>): void
  openPanel(p: PanelId | null): void
  togglePanel(p: PanelId): void
  /** Opens an explanation in Insights (and focuses its parcel); null closes the open one. */
  openExplanation(id: string | null): void
  dismissToast(id: number): void
  notify(kind: Feedback['kind'], text: string): void
  /** Clears the feedback line if it still shows message `id`. */
  clearFeedback(id: number): void
  tutorialEvent(ev: TutorialEvent): void
  skipTutorial(): void
  restartTutorial(): void
  closeReport(): void
  openReport(): void

  // scenarios
  saveScenarioA(): boolean
  branchScenarioB(): Promise<boolean>
  openCompare(): Promise<boolean>
  closeCompare(): void
  setCompareStep(step: number): void
  clearScenarios(): void
}
