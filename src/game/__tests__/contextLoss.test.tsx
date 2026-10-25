// WebGL context loss: the real SceneCanvas wrapper with <Canvas> replaced by a stub that hands
// onCreated a renderer whose domElement is a plain canvas, so the test can dispatch the
// browser's webglcontextlost / webglcontextrestored events on it.
import './dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Component, act, useEffect, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CONTEXT_RESTORE_TIMEOUT_MS, watchContextLoss } from '../scene/contextLoss'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const stubCanvas = { current: null as HTMLCanvasElement | null }

vi.mock('@react-three/fiber', () => ({
  // like the real Canvas, onCreated runs once after the renderer is created
  Canvas: ({ onCreated }: { onCreated?: (s: { gl: { domElement: HTMLCanvasElement } }) => void }) => {
    useEffect(() => {
      const canvas = document.createElement('canvas')
      stubCanvas.current = canvas
      onCreated?.({ gl: { domElement: canvas } })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return null
  },
}))
vi.mock('../effects/DebugHud', () => ({ DebugHudPanel: () => null, DebugProbe: () => null }))

const { SceneCanvas, CONTEXT_LOST_MESSAGE } = await import('../scene/SceneCanvas')

class Boundary extends Component<{ children: ReactNode; onError: (e: Error) => void }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    this.props.onError(error)
  }
  render() {
    return this.state.error ? <p data-testid="fallback">flat map</p> : this.props.children
  }
}

const fire = (type: string) => act(() => void stubCanvas.current!.dispatchEvent(new Event(type, { cancelable: true })))
const status = (host: HTMLElement) => host.querySelector('[role="status"]')

describe('watchContextLoss', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reports loss, restore and give-up, keeps the context restorable, and cleans up', () => {
    const canvas = document.createElement('canvas')
    const onLost = vi.fn()
    const onRestored = vi.fn()
    const onGiveUp = vi.fn()
    const stop = watchContextLoss(canvas, { onLost, onRestored, onGiveUp }, 1000)
    const ev = new Event('webglcontextlost', { cancelable: true })
    canvas.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(onLost).toHaveBeenCalledTimes(1)
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    expect(onRestored).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5000)
    expect(onGiveUp).not.toHaveBeenCalled()

    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    vi.advanceTimersByTime(999)
    expect(onGiveUp).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onGiveUp).toHaveBeenCalledTimes(1)

    stop()
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    vi.advanceTimersByTime(5000)
    expect(onLost).toHaveBeenCalledTimes(2)
    expect(onGiveUp).toHaveBeenCalledTimes(1)
  })

  it('cleanup cancels a pending give-up', () => {
    const canvas = document.createElement('canvas')
    const onGiveUp = vi.fn()
    const stop = watchContextLoss(canvas, { onLost: () => {}, onRestored: () => {}, onGiveUp }, 1000)
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    stop()
    vi.advanceTimersByTime(5000)
    expect(onGiveUp).not.toHaveBeenCalled()
  })
})

describe('SceneCanvas context loss', () => {
  let host: HTMLDivElement
  let root: Root
  let caught: Error[]
  let errSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.useFakeTimers()
    // React logs caught boundary errors to console.error
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    caught = []
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root.render(
        <Boundary onError={(e) => caught.push(e)}>
          <SceneCanvas quality="low" label="World">
            {null}
          </SceneCanvas>
        </Boundary>,
      )
    })
    expect(stubCanvas.current).not.toBeNull()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    errSpy.mockRestore()
    vi.useRealTimers()
  })

  it('shows a paused status on loss and clears it on restore', () => {
    expect(status(host)).toBeNull()
    fire('webglcontextlost')
    expect(status(host)?.textContent).toBe(CONTEXT_LOST_MESSAGE)
    fire('webglcontextrestored')
    expect(status(host)).toBeNull()
    act(() => void vi.advanceTimersByTime(CONTEXT_RESTORE_TIMEOUT_MS * 2))
    expect(caught).toHaveLength(0)
    expect(host.querySelector('[data-testid="fallback"]')).toBeNull()
  })

  it('raises into the error boundary when the context is never restored', () => {
    fire('webglcontextlost')
    act(() => void vi.advanceTimersByTime(CONTEXT_RESTORE_TIMEOUT_MS - 1))
    expect(caught).toHaveLength(0)
    act(() => void vi.advanceTimersByTime(1))
    expect(caught).toHaveLength(1)
    expect(caught[0].message).toMatch(/lost the 3D graphics context/)
    expect(host.querySelector('[data-testid="fallback"]')).not.toBeNull()
  })

  it('removes its listeners on unmount', async () => {
    const canvas = stubCanvas.current!
    await act(async () => root.unmount())
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    vi.advanceTimersByTime(CONTEXT_RESTORE_TIMEOUT_MS * 2)
    expect(caught).toHaveLength(0)
    // remount so afterEach can unmount cleanly
    root = createRoot(host)
  })
})
