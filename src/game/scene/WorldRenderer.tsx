// Everything that draws one world frame: atmosphere, terrain, water, props and overlay cues.
// Shared by the game view, the landing view and the snapshot compare views.
import type { OverlayId } from '../core/overlays'
import { useGame } from '../../state/store'
import type { WorldFrame } from '../core/frame'
import { terrainHeights } from '../core/coords'
import { Atmosphere } from '../effects/Atmosphere'
import { RunoffArrows } from '../effects/RunoffArrows'
import { PropLayers } from '../props/PropLayers'
import { TerrainMesh } from '../terrain/TerrainMesh'
import { WaterSurface } from '../water/WaterSurface'

export interface WorldRendererProps {
  frame: WorldFrame
  /** Identifies the source of the frame; a change snaps visuals instead of animating. */
  sourceKey: string
  quality: 'high' | 'low'
  /** Overlay override; defaults to the store's overlay. */
  overlay?: OverlayId
  overlayDomain?: [number, number] | null
}

export function WorldRenderer({ frame, sourceKey, quality, overlay, overlayDomain }: WorldRendererProps) {
  const storeOverlay = useGame((s) => s.overlay)
  // a settings toggle, so a React re-render (rare) is the simplest way to recolor everything
  const colorblind = useGame((s) => s.colorblind === true)
  const activeOverlay = overlay ?? storeOverlay
  const overlayOn = activeOverlay !== 'none'
  const extent = Math.max(frame.terrain.width, frame.terrain.height) / 2
  return (
    <>
      <Atmosphere season={frame.season} weather={frame.weather} quality={quality} extent={extent} sourceKey={sourceKey} overlayActive={overlayOn} ground={{ heights: terrainHeights(frame.terrain), dims: frame.terrain }} />
      <TerrainMesh frame={frame} sourceKey={sourceKey} overlay={overlay} overlayDomain={overlayDomain} colorblind={colorblind} />
      <WaterSurface frame={frame} sourceKey={sourceKey} overlayActive={overlayOn} />
      <PropLayers frame={frame} sourceKey={sourceKey} quality={quality} colorblind={colorblind} overlayActive={overlayOn} />
      <RunoffArrows frame={frame} visible={activeOverlay === 'runoff'} quality={quality} />
    </>
  )
}
