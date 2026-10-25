// Error boundaries. The canvas boundary keeps the interface usable when 3D rendering fails
// (no WebGL, lost GPU context, a renderer bug); the app boundary catches everything else.
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useGame } from '../state/store'

export function webglAvailable(): boolean {
  try {
    if (typeof document === 'undefined') return false
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2') ?? c.getContext('webgl')
    return !!gl
  } catch {
    return false
  }
}

interface BoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  /** Fallback that needs to know what went wrong (takes precedence over `fallback`). */
  renderFallback?(error: Error): ReactNode
  /** Changing this value resets the boundary (e.g. after a new game starts). */
  resetKey?: unknown
}

interface BoundaryState {
  error: Error | null
  key: unknown
}

/** Short note shown above the flat map when the 3D view is not available. */
export function FlatModeNotice({ reason, detail }: { reason: 'no-webgl' | 'crashed' | 'missing'; detail?: string }) {
  const why =
    reason === 'no-webgl'
      ? 'Your browser or device did not give Amoria access to 3D graphics (WebGL).'
      : reason === 'crashed'
        ? 'The 3D view stopped working.'
        : 'The 3D view is not part of this build.'
  return (
    <div className="panel pointer-events-auto max-w-xl px-4 py-2 text-center text-sm" role="note" aria-label="Flat map mode">
      <p className="text-base font-semibold">The 3D valley could not be drawn, so you are playing on a flat map</p>
      <p className="mt-0.5 text-parchment">
        {why} Everything else works: click a parcel or use the arrow keys on the map to pick one, build with the tools at the bottom, and advance time. Overlays need the 3D view.
      </p>
      {reason === 'no-webgl' && (
        <p className="mt-0.5 text-xs text-muted">For the 3D view, try an up-to-date Chrome, Edge, Firefox or Safari with hardware acceleration turned on, then reload.</p>
      )}
      {detail && <p className="mt-0.5 text-xs text-dim">Details: {detail}</p>}
    </div>
  )
}

export function WebGLMessage({ detail }: { detail?: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(ellipse_at_center,#2a2018,#17120d_70%)] p-6" role="alert">
      <div className="panel max-w-md p-5 text-center">
        <h2 className="text-xl font-semibold">The 3D valley could not be drawn</h2>
        <p className="mt-2 text-sm text-parchment">
          Your browser or device did not give Amoria access to 3D graphics (WebGL), so this landscape view cannot be shown here.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-left text-sm text-muted">
          <li>Try an up-to-date Chrome, Edge, Firefox or Safari.</li>
          <li>Turn on hardware acceleration in your browser settings.</li>
          <li>Close other tabs that use a lot of graphics, then reload.</li>
        </ul>
        {detail && <p className="mt-3 text-xs text-dim">Details: {detail}</p>}
      </div>
    </div>
  )
}

export class CanvasBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, key: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error }
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('3D view failed', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) return this.props.renderFallback?.(this.state.error) ?? this.props.fallback ?? <WebGLMessage detail={this.state.error.message} />
    return this.props.children
  }
}

export class AppBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Amoria crashed', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full items-center justify-center bg-ink p-6" role="alert">
        <div className="panel max-w-md p-5 text-center">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-parchment">
            {useGame.getState().autosaveFailed
              ? 'Amoria hit an unexpected problem. The last change could not be saved in this browser, so reloading brings back the last save that worked, if there is one.'
              : 'Amoria hit an unexpected problem. Your game was saved after your last change, so reloading should bring you back.'}
          </p>
          <p className="mt-2 text-xs text-dim">{this.state.error.message}</p>
          <button type="button" className="btn btn-primary mt-4" onClick={() => window.location.reload()}>
            Reload Amoria
          </button>
        </div>
      </div>
    )
  }
}
