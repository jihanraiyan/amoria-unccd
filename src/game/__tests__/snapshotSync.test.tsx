import './dom'
import { describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { CameraRigProps } from '../controls/CameraRig'

const counts = { world: 0, rig: 0 }
const rigProps: CameraRigProps[] = []

vi.mock('../scene/SceneCanvas', () => ({ SceneCanvas: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock('../scene/WorldRenderer', () => ({
  WorldRenderer: () => {
    counts.world++
    return null
  },
}))
vi.mock('../controls/CameraRig', () => ({
  CameraRig: (p: CameraRigProps) => {
    counts.rig++
    rigProps.push(p)
    return null
  },
}))

const { SnapshotView } = await import('../scene/SnapshotView')
const { publishGroupCamera } = await import('../controls/cameraSync')
const { defaultCameraState } = await import('../controls/cameraMath')
const { keyBlocksCamera } = await import('../controls/cameraBus')
const { makeFrame } = await import('./fixtures')

describe('compare views', () => {
  it('a camera published to the sync group does not re-render either SnapshotView', () => {
    const f = makeFrame(6, 6)
    const snap = { year: 2, season: 'dry' as const, layers: f.layers, fields: f.fields, community: {} as never, economy: {} as never, totals: {} as never }
    render(
      <>
        <SnapshotView snapshot={snap} terrain={f.terrain} syncGroup="compare-test" />
        <SnapshotView snapshot={snap} terrain={f.terrain} syncGroup="compare-test" />
      </>,
    )
    const before = { ...counts }
    expect(before.world).toBe(2)
    expect(rigProps.every((p) => p.syncGroup === 'compare-test' && p.cameraState === undefined)).toBe(true)
    act(() => {
      for (let k = 0; k < 30; k++) {
        const s = defaultCameraState(6, 6)
        s.position[0] += k * 0.1
        publishGroupCamera('compare-test', s, Symbol('other view'))
      }
    })
    expect(counts).toEqual(before)
  })
})

describe('camera keys', () => {
  it('are ignored in dialogs, scrollable panels, text fields and when already handled', () => {
    const panel = document.createElement('div')
    panel.style.overflowY = 'auto'
    Object.defineProperty(panel, 'scrollHeight', { value: 500 })
    Object.defineProperty(panel, 'clientHeight', { value: 100 })
    const button = document.createElement('button')
    panel.appendChild(button)
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const inDialog = document.createElement('button')
    dialog.appendChild(inDialog)
    const plain = document.createElement('button')
    const input = document.createElement('input')
    document.body.append(panel, dialog, plain, input)
    const ev = (target: EventTarget, defaultPrevented = false) => ({ target, defaultPrevented })
    expect(keyBlocksCamera(ev(plain))).toBe(false)
    expect(keyBlocksCamera(ev(document.body))).toBe(false)
    expect(keyBlocksCamera(ev(button))).toBe(true)
    expect(keyBlocksCamera(ev(inDialog))).toBe(true)
    expect(keyBlocksCamera(ev(input))).toBe(true)
    expect(keyBlocksCamera(ev(plain, true))).toBe(true)
    // an open modal anywhere blocks the camera even with focus on the page body
    dialog.setAttribute('aria-modal', 'true')
    expect(keyBlocksCamera(ev(document.body))).toBe(true)
    document.body.innerHTML = ''
  })
})
