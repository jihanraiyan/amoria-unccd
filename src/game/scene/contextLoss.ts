// Watches a WebGL canvas for context loss. three.js already calls preventDefault on
// 'webglcontextlost' so the browser may restore the context; this only reports what happens so
// the UI can tell the player, and gives up after a timeout so the app can fall back to the flat map.

/** How long to wait for the browser to restore a lost context before giving up. */
export const CONTEXT_RESTORE_TIMEOUT_MS = 5000

export interface ContextLossHandlers {
  onLost: () => void
  onRestored: () => void
  /** Called once if the context is still lost after the timeout. */
  onGiveUp: () => void
}

/** Attach the listeners; returns a cleanup that removes them and cancels any pending timeout. */
export function watchContextLoss(
  canvas: EventTarget,
  handlers: ContextLossHandlers,
  timeoutMs: number = CONTEXT_RESTORE_TIMEOUT_MS,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const clear = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  const lost = (e: Event) => {
    // keep the context restorable even if three.js has not attached its own handler yet
    e.preventDefault()
    handlers.onLost()
    clear()
    timer = setTimeout(() => {
      timer = null
      handlers.onGiveUp()
    }, timeoutMs)
  }
  const restored = () => {
    clear()
    handlers.onRestored()
  }
  canvas.addEventListener('webglcontextlost', lost)
  canvas.addEventListener('webglcontextrestored', restored)
  return () => {
    clear()
    canvas.removeEventListener('webglcontextlost', lost)
    canvas.removeEventListener('webglcontextrestored', restored)
  }
}
