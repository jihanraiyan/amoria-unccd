// App shell: screens, the 3D world behind a translucent HUD, settings applied to the page.
import { Home, RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react'
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { resetCamera, rotateCamera, zoomCamera } from '../game/controls/cameraBus'
import { useGame, type PanelId } from '../state/store'
import { restoreRememberedFocus } from '../ui/common/focusReturn'
import { PanelIdContext } from '../ui/common/Panel'
import { CompareScreen } from '../ui/compare/CompareScreen'
import { FlatMap } from '../ui/map/FlatMap'
import { FeedbackLine, Toasts } from '../ui/hud/Notifications'
import { OverlayChip } from '../ui/hud/OverlayChip'
import { PanelRail } from '../ui/hud/PanelRail'
import { GameMenu, MetricsBar, TimeControls } from '../ui/hud/TopBar'
import { Inspector } from '../ui/inspector/Inspector'
import { Landing } from '../ui/landing/Landing'
import { BudgetPanel } from '../ui/panels/BudgetPanel'
import { ChartsPanel } from '../ui/panels/ChartsPanel'
import { CommunityPanel } from '../ui/panels/CommunityPanel'
import { InsightsPanel } from '../ui/panels/InsightsPanel'
import { ObjectivesPanel } from '../ui/panels/ObjectivesPanel'
import { OverlaysPanel } from '../ui/panels/OverlaysPanel'
import { SettingsPanel } from '../ui/panels/SettingsPanel'
import { EndReport } from '../ui/report/EndReport'
import { Toolbar } from '../ui/toolbar/Toolbar'
import { TutorialCoach } from '../ui/tutorial/TutorialCoach'
import { PastBanner, ScenarioBar, Timeline } from '../ui/timeline/Timeline'
import { AppBoundary, CanvasBoundary, FlatModeNotice, webglAvailable } from './ErrorBoundary'
import { useGameExports } from './gameModules'
import { useShortcuts } from './useShortcuts'

function useApplySettings() {
  const settings = useGame((s) => s.settings)
  useEffect(() => {
    const root = document.documentElement
    root.dataset.colorblind = String(settings.colorblind)
    root.dataset.reducedMotion = String(settings.reducedMotion)
    root.style.setProperty('--ui-scale', String(settings.uiScale))
  }, [settings])
}

function WorldFallback({ children }: { children: ReactNode }) {
  return <div className="flex h-full w-full items-center justify-center bg-ink">{children}</div>
}

/** Tells the store how the world is drawn while this is mounted (camera controls depend on it). */
function useWorldView(view: '3d' | 'flat') {
  const setWorldView = useGame((s) => s.setWorldView)
  useEffect(() => {
    setWorldView(view)
    return () => setWorldView(null)
  }, [view, setWorldView])
}

/** Mounted next to the 3D world once it rendered: the 3D camera is live. */
function Mark3D() {
  useWorldView('3d')
  return null
}

/** The valley as a playable flat map, with a plain note on why the 3D view is missing. */
function FlatWorld({ reason, detail }: { reason: 'no-webgl' | 'crashed' | 'missing'; detail?: string }) {
  useWorldView('flat')
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-ink px-4 pt-20 pb-36">
      <FlatModeNotice reason={reason} detail={detail} />
      <FlatMap />
    </div>
  )
}

/** The live 3D world, or an honest, playable fallback when it cannot be shown. */
function World() {
  const game = useGameExports()
  const worldId = useGame((s) => s.worldId)
  const seed = useGame((s) => s.seed)
  const [gl] = useState(webglAvailable)
  if (!gl) return <FlatWorld reason="no-webgl" />
  if (!game) {
    return (
      <WorldFallback>
        <p className="text-xl text-muted" role="status">
          Drawing the valley...
        </p>
      </WorldFallback>
    )
  }
  const GameWorld = game.GameWorld
  if (!GameWorld) return <FlatWorld reason="missing" />
  return (
    <CanvasBoundary resetKey={`${worldId}:${seed}`} renderFallback={(error) => <FlatWorld reason="crashed" detail={error.message} />}>
      <Suspense
        fallback={
          <WorldFallback>
            <p className="text-xl text-muted" role="status">
              Drawing the valley...
            </p>
          </WorldFallback>
        }
      >
        <GameWorld />
        <Mark3D />
      </Suspense>
    </CanvasBoundary>
  )
}

/** On-screen camera controls (the render team's camera bus; keyboard: - = Q E Home). Only for the 3D view. */
function CameraButtons() {
  const worldView = useGame((s) => s.worldView)
  if (worldView !== '3d') return null
  const buttons = [
    { label: 'Zoom in', icon: ZoomIn, run: () => zoomCamera(1) },
    { label: 'Zoom out', icon: ZoomOut, run: () => zoomCamera(-1) },
    { label: 'Turn left', icon: RotateCcw, run: () => rotateCamera(-1) },
    { label: 'Turn right', icon: RotateCw, run: () => rotateCamera(1) },
    { label: 'Reset view', icon: Home, run: () => resetCamera() },
  ]
  return (
    <div className="panel pointer-events-auto hidden shrink-0 flex-col gap-0.5 p-1 sm:flex" role="toolbar" aria-label="Camera">
      {buttons.map(({ label, icon: Icon, run }) => (
        <button
          key={label}
          type="button"
          className="rail-btn !h-8 !w-8"
          aria-label={label}
          title={label}
          onClick={() => {
            run()
            // the on-screen buttons count as looking around, like the wheel, drag and camera keys
            useGame.getState().tutorialEvent('navigate')
          }}
        >
          <Icon size={15} aria-hidden />
        </button>
      ))}
    </div>
  )
}

function ActivePanel() {
  const panel = useGame((s) => s.panel)
  return <PanelIdContext.Provider value={panel}>{panelFor(panel)}</PanelIdContext.Provider>
}

function panelFor(panel: PanelId | null) {
  switch (panel) {
    case 'overlays':
      return <OverlaysPanel />
    case 'budget':
      return <BudgetPanel />
    case 'community':
      return <CommunityPanel />
    case 'insights':
      return <InsightsPanel />
    case 'charts':
      return <ChartsPanel />
    case 'objectives':
      return <ObjectivesPanel />
    case 'settings':
      return <SettingsPanel />
    default:
      return null
  }
}

/**
 * Screen-reader heading for the game. Focus lands here when the game screen opens (from the
 * title or from Compare when there is no button to return to), so the player knows where they are.
 */
function GameHeading() {
  const ref = useRef<HTMLHeadingElement>(null)
  const name = useGame((s) => s.sim?.meta.name ?? 'Amoria')
  useEffect(() => {
    if (restoreRememberedFocus()) return
    ref.current?.focus({ preventScroll: true })
  }, [])
  const year = useGame((s) => s.sim?.year ?? 1)
  const season = useGame((s) => s.sim?.season ?? 'wet')
  return (
    <h1 ref={ref} tabIndex={-1} className="sr-only" id="game-title">
      {name}: year {year}, {season} season. Time controls at the top, panels on the left, building tools at the bottom.
    </h1>
  )
}

function GameScreen() {
  const tutorialEvent = useGame((s) => s.tutorialEvent)
  const selected = useGame((s) => s.selectedCell)
  const worldView = useGame((s) => s.worldView)
  const drag = useRef<{ x: number; y: number } | null>(null)
  // the wheel and drags only move a camera in the 3D view; the flat map counts clicks and arrows
  const looked = () => {
    if (useGame.getState().worldView === '3d') tutorialEvent('navigate')
  }
  return (
    <div className="relative h-full w-full overflow-hidden" data-world-view={worldView ?? 'none'}>
      <GameHeading />
      <div
        className="absolute inset-0"
        data-testid="world-layer"
        onWheel={looked}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) {
            looked()
            drag.current = null
          }
        }}
        onPointerUp={() => {
          drag.current = null
        }}
      >
        <World />
      </div>

      {/* Floating islands over the world, laid out like an editor: menu, time and indicators on
          top, panels on a left rail, the inspector on the right, tools docked at the bottom. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col gap-2 p-2 sm:gap-3 sm:p-3">
        <div className="flex flex-wrap items-start gap-2">
          <GameMenu />
          <div className="flex flex-1 justify-center">
            <TimeControls />
          </div>
          {/* sized to its contents, so all six indicators show; it scrolls only on a phone */}
          <div className="flex max-w-full grow justify-end max-xl:basis-full max-xl:justify-center">
            <MetricsBar />
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 items-start gap-2 sm:gap-3">
          <PanelRail />
          <div className="flex max-h-full min-w-0 flex-1 justify-start [&>*]:max-w-full">
            <ActivePanel />
          </div>
          <div className="pointer-events-none absolute inset-x-12 top-0 flex flex-col items-center gap-2 empty:hidden sm:inset-x-16">
            <PastBanner />
            <OverlayChip />
          </div>
          {selected !== null && (
            <div className="absolute inset-x-0 top-0 flex max-h-full justify-end md:static md:inset-auto">
              <Inspector />
            </div>
          )}
          <div className="pointer-events-none absolute right-0 bottom-0 flex flex-col items-end gap-2">
            <Toasts />
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2">
            <TutorialCoach />
            <FeedbackLine />
          </div>
        </div>

        <div className="flex flex-col gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-end lg:gap-3">
          <div className="flex min-w-0 items-end gap-2">
            <CameraButtons />
            <div className="min-w-0 flex-1 lg:max-w-[26rem]">
              <Timeline />
            </div>
          </div>
          <div className="order-last flex min-w-0 justify-center lg:order-none">
            <Toolbar />
          </div>
          <div className="flex min-w-0 justify-end">
            <ScenarioBar />
          </div>
        </div>
      </div>
      <EndReport />
    </div>
  )
}

export default function App() {
  const screen = useGame((s) => s.screen)
  useApplySettings()
  useShortcuts()
  return (
    <AppBoundary>
      <div className="h-full w-full">
        {screen === 'landing' && <Landing />}
        {screen === 'game' && <GameScreen />}
        {screen === 'compare' && <CompareScreen />}
      </div>
    </AppBoundary>
  )
}
