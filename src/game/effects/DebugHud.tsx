// ?debug HUD: FPS, frame time, draw calls, triangles, geometries/textures and instance counts.
// Writes straight into a DOM node twice a second, so it never re-renders React.
import { useEffect, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { InstancedMesh } from 'three'

export interface DebugProbeProps {
  target: RefObject<HTMLDivElement | null>
}

/** Lives inside the Canvas; measures and writes to `target`. */
export function DebugProbe({ target }: DebugProbeProps) {
  const { gl, scene } = useThree()
  const acc = useRef({ frames: 0, time: 0, worst: 0 })
  useEffect(() => {
    gl.info.autoReset = true
  }, [gl])
  useFrame((_, dt) => {
    const a = acc.current
    a.frames++
    a.time += dt
    a.worst = Math.max(a.worst, dt)
    if (a.time < 0.5) return
    const fps = a.frames / a.time
    let instances = 0
    let meshes = 0
    scene.traverse((o) => {
      if ((o as InstancedMesh).isInstancedMesh) {
        meshes++
        instances += (o as InstancedMesh).count
      }
    })
    const info = gl.info
    if (target.current) {
      target.current.textContent = [
        `${fps.toFixed(0)} fps  (worst ${(a.worst * 1000).toFixed(1)} ms)`,
        `draw calls ${info.render.calls}  triangles ${info.render.triangles.toLocaleString()}`,
        `geometries ${info.memory.geometries}  textures ${info.memory.textures}`,
        `instanced meshes ${meshes}  instances ${instances.toLocaleString()}`,
        `pixel ratio ${gl.getPixelRatio().toFixed(2)}`,
      ].join('\n')
    }
    a.frames = 0
    a.time = 0
    a.worst = 0
  })
  return null
}

export function DebugHudPanel({ hudRef }: { hudRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={hudRef}
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: 8,
        bottom: 8,
        zIndex: 50,
        pointerEvents: 'none',
        whiteSpace: 'pre',
        font: '11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
        color: '#f5efe0',
        background: 'rgba(30, 24, 18, 0.72)',
        padding: '6px 8px',
        borderRadius: 6,
      }}
    >
      measuring...
    </div>
  )
}
