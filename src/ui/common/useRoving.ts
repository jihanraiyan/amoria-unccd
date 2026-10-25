// Roving focus for radio groups and tab lists (WAI-ARIA APG pattern): only the checked item is
// in the Tab order, and the arrow keys (plus Home and End) move the selection and the focus.
// The key is consumed so the camera and the global shortcuts do not also react to it.
import { useRef, type KeyboardEvent } from 'react'

export interface RovingItemProps {
  tabIndex: number
  onKeyDown(e: KeyboardEvent<HTMLElement>): void
  ref(el: HTMLElement | null): void
}

const NEXT = new Set(['ArrowRight', 'ArrowDown'])
const PREV = new Set(['ArrowLeft', 'ArrowUp'])

/** Index the arrow key moves to, or null for keys the group does not handle. */
export function rovingTarget(key: string, index: number, count: number): number | null {
  if (count <= 0) return null
  if (NEXT.has(key)) return (index + 1) % count
  if (PREV.has(key)) return (index - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

/**
 * Returns a function giving each item its roving props. `select` is called with the newly
 * chosen value; selection follows focus, as the radio and tab patterns expect.
 */
export function useRoving<T>(values: readonly T[], current: T, select: (v: T) => void): (v: T) => RovingItemProps {
  const els = useRef(new Map<number, HTMLElement>())
  const at = values.indexOf(current)
  const tabStop = at >= 0 ? at : 0
  return (v: T) => {
    const i = values.indexOf(v)
    return {
      tabIndex: i === tabStop ? 0 : -1,
      ref: (el) => {
        if (el) els.current.set(i, el)
        else els.current.delete(i)
      },
      onKeyDown: (e) => {
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
        const to = rovingTarget(e.key, i, values.length)
        if (to === null) return
        e.preventDefault()
        e.stopPropagation()
        select(values[to])
        els.current.get(to)?.focus()
      },
    }
  }
}
