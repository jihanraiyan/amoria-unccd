// Shared Canvas setup: filtered shadows on high quality, capped pixel ratio, R3F's default ACES tone mapping,
// a narrow field of view for the miniature-diorama look, and the optional ?debug HUD.
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { PCFShadowMap } from 'three'
import { DebugHudPanel, DebugProbe } from '../effects/DebugHud'
import { CANVAS_LIVE_ATTR, CANVAS_WRAPPER_ATTR } from '../controls/cameraBus'
import { debugEnabled } from './storeHooks'
import { watchContextLoss } from './contextLoss'

const PAUSED_STATUS: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(28, 22, 16, 0.55)',
  color: '#f6efe2',
  font: '600 0.95rem/1.4 system-ui, sans-serif',
  pointerEvents: 'none',
}

/** Shown over the canvas while the browser restores a lost WebGL context. */
export const CONTEXT_LOST_MESSAGE = '3D view paused, restoring...'

const VISUALLY_HIDDEN: CSSProperties = { position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }

/** Read by screen readers when the world gets keyboard focus. */
export const KEYBOARD_HELP =
  'Arrow keys move the parcel cursor. Enter inspects the parcel, or applies the selected tool to it. W A S D move the camera. Q and E turn it, minus and equals zoom, Home resets the view.'

export interface SceneCanvasProps {
  quality: 'high' | 'low'
  children: ReactNode
  className?: string
  /** Accessible description of what the canvas shows. */
  label: string
  /** Interactive views are exposed as an application region, passive ones as an image. */
  interactive?: boolean
}

export function SceneCanvas({ quality, children, className, label, interactive = false }: SceneCanvasProps) {
  const hud = useRef<HTMLDivElement>(null)
  const keysId = useId()
  const debug = debugEnabled()
  const high = quality === 'high'
  const [glCanvas, setGlCanvas] = useState<HTMLCanvasElement | null>(null)
  const [contextLost, setContextLost] = useState(false)
  const [fatal, setFatal] = useState<Error | null>(null)
  useEffect(() => {
    if (!glCanvas) return
    return watchContextLoss(glCanvas, {
      onLost: () => setContextLost(true),
      onRestored: () => setContextLost(false),
      onGiveUp: () => setFatal(new Error('The browser lost the 3D graphics context and did not restore it.')),
    })
  }, [glCanvas])
  // thrown during render so the surrounding CanvasBoundary switches to the flat map
  if (fatal) throw fatal
  return (
    <div
      className={className}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', touchAction: 'none' }}
      role={interactive ? 'application' : 'img'}
      aria-label={label}
      aria-describedby={interactive ? keysId : undefined}
      tabIndex={interactive ? 0 : undefined}
      {...{ [CANVAS_WRAPPER_ATTR]: '' }}
    >
      <Canvas
        shadows={high ? { type: PCFShadowMap } : false}
        dpr={high ? [1, 2] : 1}
        gl={{ antialias: high, powerPreference: 'high-performance' }}
        camera={{ fov: 34, near: 0.5, far: 1200, position: [30, 45, 50] }}
        style={{ position: 'absolute', inset: 0 }}
        onContextMenu={(e) => e.preventDefault()}
        onCreated={({ gl }) => setGlCanvas(gl.domElement)}
      >
        {children}
        {debug ? <DebugProbe target={hud} /> : null}
      </Canvas>
      {debug ? <DebugHudPanel hudRef={hud} /> : null}
      {contextLost ? (
        <div role="status" style={PAUSED_STATUS}>
          {CONTEXT_LOST_MESSAGE}
        </div>
      ) : null}
      {interactive ? (
        <>
          <p id={keysId} style={VISUALLY_HIDDEN}>
            {KEYBOARD_HELP}
          </p>
          <p style={VISUALLY_HIDDEN} aria-live="polite" {...{ [CANVAS_LIVE_ATTR]: '' }} />
        </>
      ) : null}
    </div>
  )
}
