// Where keyboard focus should land when a screen comes back (for example the Compare futures
// button after leaving Compare). A screen that opens another remembers its opener here; the
// screen that mounts next takes it and focuses that element if it is on the page.

let pending: string | null = null

/** Remembers a CSS selector for the element to focus when the previous screen returns. */
export function rememberFocus(selector: string): void {
  pending = selector
}

/** Focuses the remembered element if it exists now. Returns true when focus moved. */
export function restoreRememberedFocus(): boolean {
  const sel = pending
  pending = null
  if (!sel || typeof document === 'undefined') return false
  const el = document.querySelector<HTMLElement>(sel)
  if (!el) return false
  el.focus({ preventScroll: true })
  return document.activeElement === el
}
