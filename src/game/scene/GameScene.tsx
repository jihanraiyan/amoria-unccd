// The main interactive world. Reads the live simulation (or, when store.viewSnapshot is set,
// a past snapshot shown read-only) and wires picking, tool previews and the camera.
import { useMemo, useState } from 'react'
import { useGame } from '../../state/store'
import { terrainHeights } from '../core/coords'
import { frameFromSim, frameFromSnapshot } from '../core/frame'
import { createInputState } from '../controls/cameraBus'
import { CameraRig } from '../controls/CameraRig'
import { Highlights } from '../controls/Highlights'
import { Interaction } from '../controls/Interaction'
import { SceneCanvas } from './SceneCanvas'
import { reservoirFillForSnapshot, snapshotKey, weatherForSnapshot } from './snapshotUtils'
import { WorldRenderer } from './WorldRenderer'

export interface GameSceneProps {
  className?: string
}

export function GameScene({ className }: GameSceneProps) {
  const sim = useGame((s) => s.sim)
  const snapshot = useGame((s) => s.viewSnapshot)
  const viewStep = useGame((s) => s.viewStep)
  const quality = useGame((s) => s.quality)
  const [input] = useState(createInputState)

  const frame = useMemo(() => {
    if (!sim) return null
    if (!snapshot) return frameFromSim(sim)
    const index = viewStep ?? undefined
    return frameFromSnapshot(snapshot, sim.terrain, weatherForSnapshot(sim.weather, snapshot, index), reservoirFillForSnapshot(sim.history, snapshot, index))
  }, [sim, snapshot, viewStep])
  const sourceKey = snapshot ? snapshotKey(snapshot) : 'live'
  const label = sim
    ? `3D view of ${sim.meta.name}${snapshot ? `, showing year ${snapshot.year} ${snapshot.season} season from history` : ''}. Hover or click parcels to inspect them; use the tools to change the land.`
    : 'Loading the 3D world'

  return (
    <SceneCanvas quality={quality} className={className} label={label} interactive>
      {frame ? (
        <>
          <WorldRenderer frame={frame} sourceKey={sourceKey} quality={quality} />
          <CameraRig dims={frame.terrain} heights={terrainHeights(frame.terrain)} interactive input={input} readOnly={!!snapshot} />
          <Interaction dims={frame.terrain} heights={terrainHeights(frame.terrain)} input={input} readOnly={!!snapshot} />
          <Highlights dims={frame.terrain} heights={terrainHeights(frame.terrain)} readOnly={!!snapshot} />
        </>
      ) : null}
    </SceneCanvas>
  )
}
