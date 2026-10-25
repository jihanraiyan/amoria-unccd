// Focus handling for modal dialogs: focus moves in on open, Tab cycles inside the dialog,
// everything else on the page is made inert (so pointer, keyboard and screen readers stay in
// the dialog), and focus returns to whatever opened it when it closes.
import { useEffect, type RefObject } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Elements outside `root` to make inert: the siblings of root and of each of its ancestors. */
function outside(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = []
  for (let n: HTMLElement | null = root; n && n.parentElement; n = n.parentElement) {
    for (const sib of Array.from(n.parentElement.children)) {
      if (sib !== n && sib instanceof HTMLElement && !sib.hasAttribute('inert')) out.push(sib)
    }
    if (n.parentElement === document.body) break
  }
  return out
}

/**
 * @param fallbackFocus selector to focus on close when the opener is gone (for example a
 * button that only exists after the dialog first opened).
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, open: boolean, fallbackFocus?: string): void {
  useEffect(() => {
    const root = ref.current
    if (!open || !root) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const inerted = outside(root)
    for (const el of inerted) el.setAttribute('inert', '')
    root.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[inert]'))
      if (!items.length) {
        e.preventDefault()
        root.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      } else if (!root.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      for (const el of inerted) el.removeAttribute('inert')
      const target = opener && opener.isConnected && opener !== document.body ? opener : fallbackFocus ? document.querySelector<HTMLElement>(fallbackFocus) : null
      target?.focus({ preventScroll: true })
    }
  }, [ref, open, fallbackFocus])
}
