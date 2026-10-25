// Read-only view of a stored Snapshot for split-screen compare and before/after sliders.
// Give two views the same syncGroup (or drive cameraState/onCameraChange yourself) to keep
// their cameras synchronised. No tools, no picking, no store writes. Camera sync runs inside
// the camera rig through refs, so moving one view never re-renders the React tree of another.
import { useMemo } from 'react'
import { useGame } from '../../state/store'
import type { OverlayId } from '../core/overlays'
import type { Snapshot, Terrain, WeatherSeason } from '../../simulation/types'
import { terrainHeights } from '../core/coords'
import { frameFromSnapshot } from '../core/frame'
import { CameraRig } from '../controls/CameraRig'
import type { CameraState } from '../controls/cameraMath'
import { SceneCanvas } from './SceneCanvas'
import { snapshotKey } from './snapshotUtils'
import { WorldRenderer } from './WorldRenderer'

export interface SnapshotViewProps {
  snapshot: Snapshot
  terrain: Terrain
  /** Views with the same syncGroup share one camera (simplest way to synchronise compare views). */
  syncGroup?: string
  /** Explicit camera control, for callers that keep the camera state themselves. */
  cameraState?: CameraState | null
  /** Called when the player moves this view's camera. */
  onCameraChange?: (state: CameraState) => void
  /** Weather of the season that produced the snapshot (see weatherForSnapshot). */
  weather?: WeatherSeason | null
  /** Overlay override; defaults to the store's overlay. */
  overlay?: OverlayId
  /** Reservoir fill 0..1 for that season (see reservoirFillForSnapshot). */
  reservoirFill?: number | null
  /** Shared overlay scale for side-by-side comparison (see sharedOverlayDomain). */
  overlayDomain?: [number, number] | null
  className?: string
  /** Accessible label, e.g. "Scenario A, year 12". */
  label?: string
}

export function SnapshotView({ snapshot, terrain, syncGroup, cameraState, onCameraChange, weather, reservoirFill, overlay, overlayDomain, className, label }: SnapshotViewProps) {
  const quality = useGame((s) => s.quality)
  const frame = useMemo(() => frameFromSnapshot(snapshot, terrain, weather, reservoirFill), [snapshot, terrain, weather, reservoirFill])
  const key = snapshotKey(snapshot)
  return (
    <SceneCanvas quality={quality} className={className} label={label ?? `Landscape in year ${snapshot.year}, ${snapshot.season} season`}>
      <WorldRenderer frame={frame} sourceKey={key} quality={quality} overlay={overlay} overlayDomain={overlayDomain} />
      <CameraRig dims={terrain} heights={terrainHeights(terrain)} interactive={false} syncGroup={syncGroup} cameraState={cameraState} onCameraChange={onCameraChange} />
    </SceneCanvas>
  )
}
