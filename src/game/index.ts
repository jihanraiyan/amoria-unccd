// Public API of the 3D world. The UI imports only from here.
export { GameScene, type GameSceneProps } from './scene/GameScene'
export { LandingScene, type LandingSceneProps } from './scene/LandingScene'
export { SnapshotView, type SnapshotViewProps } from './scene/SnapshotView'
export { reservoirFillForSnapshot, seasonIndex, sharedOverlayDomain, snapshotKey, weatherForSnapshot } from './scene/snapshotUtils'

export {
  OVERLAYS,
  OVERLAY_IDS,
  RAMPS,
  overlayDomain,
  overlayValues,
  rampHex,
  resolveLegend,
  type CuePattern,
  type OverlayDef,
  type OverlayId as WorldOverlayId,
  type OverlayLegendStop,
  type OverlaySource,
  type OverlayValueKind,
} from './core/overlays'

export { resetCamera, rotateCamera, zoomCamera } from './controls/cameraBus'
export { defaultCameraState, type CameraState } from './controls/cameraMath'
export { brushCells, lineCells, toolMode, type ToolMode } from './core/brush'
export { cellToWorld, worldToCell } from './core/coords'
export { frameFromSim, frameFromSnapshot, type WorldFrame } from './core/frame'
