// Accessible tooltip: opens on hover and on keyboard focus, is linked to its trigger with
// aria-describedby, and closes on Escape. Rendered in a portal with fixed positioning so
// scrolling panels never clip it. With `toggle` it is a toggletip: a click or tap on the
// trigger also opens it (and a second one closes it), for touch screens that never hover or
// focus a button; a press anywhere else closes it.
import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface TipProps {
  content: ReactNode
  children: ReactElement<{ 'aria-describedby'?: string }>
  side?: 'top' | 'bottom' | 'left' | 'right'
  width?: string
  className?: string
  /** Also open and close on click or tap (for info buttons whose only job is this note). */
  toggle?: boolean
}

const GAP = 8
const MARGIN = 8

export function Tip({ content, children, side = 'bottom', width = 'w-72', className = '', toggle = false }: TipProps) {
  const id = useId()
  const [hovered, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const open = hovered || pinned
  const anchor = useRef<HTMLSpanElement>(null)
  const tip = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !anchor.current || !tip.current) return
    const a = anchor.current.getBoundingClientRect()
    const t = tip.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = 0
    let top = 0
    if (side === 'bottom' || side === 'top') {
      left = a.left + a.width / 2 - t.width / 2
      top = side === 'bottom' ? a.bottom + GAP : a.top - GAP - t.height
      if (side === 'bottom' && top + t.height > vh - MARGIN) top = a.top - GAP - t.height
      if (side === 'top' && top < MARGIN) top = a.bottom + GAP
    } else {
      top = a.top + a.height / 2 - t.height / 2
      left = side === 'right' ? a.right + GAP : a.left - GAP - t.width
      if (side === 'right' && left + t.width > vw - MARGIN) left = a.left - GAP - t.width
      if (side === 'left' && left < MARGIN) left = a.right + GAP
    }
    left = Math.max(MARGIN, Math.min(vw - t.width - MARGIN, left))
    top = Math.max(MARGIN, Math.min(vh - t.height - MARGIN, top))
    setPos({ left, top })
  }, [open, side])

  // a pinned toggletip closes when the player presses anywhere outside its trigger
  useEffect(() => {
    if (!pinned) return
    const away = (e: PointerEvent) => {
      if (anchor.current && e.target instanceof Node && anchor.current.contains(e.target)) return
      setPinned(false)
      setOpen(false)
      setPos(null)
    }
    window.addEventListener('pointerdown', away, true)
    return () => window.removeEventListener('pointerdown', away, true)
  }, [pinned])

  const trigger = isValidElement(children) ? cloneElement(children, { 'aria-describedby': id }) : children
  const body = (
    <span
      id={id}
      ref={tip}
      role="tooltip"
      style={pos && open ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
      className={`panel panel-strong pointer-events-none fixed z-[100] block max-w-[calc(100vw-16px)] ${width} p-3 text-left text-xs leading-relaxed font-normal text-parchment normal-case tracking-normal ${
        open ? 'visible' : 'invisible'
      }`}
    >
      {content}
    </span>
  )
  return (
    <span
      ref={anchor}
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        setOpen(false)
        setPos(null)
      }}
      onFocus={() => setOpen(true)}
      onBlur={() => {
        setOpen(false)
        setPinned(false)
        setPos(null)
      }}
      onClick={
        toggle
          ? () => {
              if (pinned) {
                setPinned(false)
                setOpen(false)
                setPos(null)
              } else setPinned(true)
            }
          : undefined
      }
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          setOpen(false)
          setPinned(false)
        }
      }}
    >
      {trigger}
      {typeof document !== 'undefined' ? createPortal(body, document.body) : body}
    </span>
  )
}
