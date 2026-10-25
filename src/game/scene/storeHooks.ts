// Store access without React re-renders: components that update three.js objects every frame
// read store values from refs kept current by a zustand subscription.
import { useEffect, useRef, type RefObject } from 'react'
import { useGame, type GameStore } from '../../state/store'

/** Ref that always holds selector(store); optional onChange fires on every change. */
export function useStoreRef<T>(selector: (s: GameStore) => T, onChange?: (value: T, prev: T) => void): RefObject<T> {
  const ref = useRef<T>(selector(useGame.getState()))
  const cb = useRef(onChange)
  const sel = useRef(selector)
  useEffect(() => {
    cb.current = onChange
    sel.current = selector
  })
  useEffect(() => {
    ref.current = sel.current(useGame.getState())
    return useGame.subscribe((s, p) => {
      const v = sel.current(s)
      const pv = sel.current(p)
      if (Object.is(v, pv)) return
      ref.current = v
      cb.current?.(v, pv)
    })
  }, [])
  return ref
}

/** True when the page URL has ?debug (enables the FPS / draw-call HUD). */
export function debugEnabled(): boolean {
  try {
    return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')
  } catch {
    return false
  }
}
