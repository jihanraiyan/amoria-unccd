// MapControls-style camera: pan, zoom, rotate within limits (always an elevated view, never
// under the terrain), keyboard control, animated focus on store.focusCell, reset/zoom/rotate
// commands from the UI, and optional synchronisation with another view (compare mode).
// Mouse mapping: with the inspect tool left-drag pans; with a build tool left-drag paints, so
// the camera uses right-drag (rotate), shift+right or middle-drag (pan) and the wheel (zoom).
// Holding Space over the canvas lets left-drag pan in any mode. While viewing history the
// tools are off, so left-drag pans as with inspect.
// Views that share a syncGroup follow whichever of them the player last touched; the camera
// state moves through refs inside useFrame, never through React state.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { MOUSE, TOUCH, Vector3 } from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { useGame } from '../../state/store'
import { cellToWorld, heightAt, type GridDims } from '../core/coords'
import { useStoreRef } from '../scene/storeHooks'
import { keyBlocksCamera, onCameraCommand, type InputState } from './cameraBus'
import { claimGroupLeader, getGroupCamera, isGroupFollower, isGroupLeader, publishGroupCamera, releaseGroupLeader, subscribeGroupCamera } from './cameraSync'
import { CAMERA_LIMITS, FOCUS_DURATION_S, FOLLOW_DURATION_S, clampTarget, defaultCameraState, easeInOut, lerp3, orbitAt, planFocus, sameCameraState, type CameraState } from './cameraMath'

export interface CameraRigProps {
  dims: GridDims
  heights: Float32Array
  /** Game view: tools, keyboard, focus requests and UI camera commands. */
  interactive: boolean
  input?: InputState
  /** Viewing a past snapshot: tools are off, so the mouse behaves as with inspect. */
  readOnly?: boolean
  /** Views with the same group share one camera (compare mode). */
  syncGroup?: string
  /** Externally controlled camera. Applied whenever it changes; never echoed back. */
  cameraState?: CameraState | null
  /** Called when the player moves this view's camera. */
  onCameraChange?: (s: CameraState) => void
}

/** Zero OrbitControls' pending damping so an applied state is not nudged afterwards. */
function stopControlsMotion(controls: MapControls) {
  const c = controls as unknown as { _sphericalDelta?: { set(a: number, b: number, c: number): void }; _panOffset?: { set(a: number, b: number, c: number): void }; _scale?: number }
  c._sphericalDelta?.set(0, 0, 0)
  c._panOffset?.set(0, 0, 0)
  if (typeof c._scale === 'number') c._scale = 1
}

interface Anim {
  from: CameraState
  to: CameraState
  t: number
  dur: number
  onDone?: () => void
  /** set for rotate commands: orbit this many radians about the fixed target instead of a straight path */
  orbit?: number
}

const _offset = new Vector3()
const _ndc = new Vector3()
const PAN_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
}

export function CameraRig({ dims, heights, interactive, input, readOnly = false, syncGroup, cameraState, onCameraChange }: CameraRigProps) {
  const { camera, gl } = useThree()
  const setThree = useThree((s) => s.set)
  // created unconnected; the effect connects/disconnects so StrictMode remounts stay live
  const controls = useMemo(() => new MapControls(camera), [camera])
  const anim = useRef<Anim | null>(null)
  const keys = useRef(new Set<string>())
  const lastEmitted = useRef<CameraState | null>(null)
  const userMoved = useRef(false)
  const applying = useRef(false)
  /** the last camera came from outside (cameraState prop): hold it until the player moves */
  const driven = useRef(false)
  const [self] = useState(() => Symbol('camera-rig'))
  /** latest camera received from the sync group, applied on the next frame */
  const pending = useRef<CameraState | null>(null)
  const readOnlyRef = useRef(readOnly)
  const groupRef = useRef(syncGroup)
  const tool = useStoreRef((s) => s.tool)
  const reduced = useStoreRef((s) => s.reducedMotion)
  const emit = useRef(onCameraChange)
  useEffect(() => {
    emit.current = onCameraChange
    readOnlyRef.current = readOnly
    groupRef.current = syncGroup
  })

  const ground = (x: number, z: number) => heightAt(heights, dims, x, z)
  const groundRef = useRef(ground)
  useEffect(() => {
    groundRef.current = ground
  })

  const read = (): CameraState => ({
    position: [camera.position.x, camera.position.y, camera.position.z],
    target: [controls.target.x, controls.target.y, controls.target.z],
  })
  const apply = (s: CameraState) => {
    stopControlsMotion(controls)
    camera.position.set(...s.position)
    controls.target.set(...s.target)
    camera.lookAt(controls.target)
    // controls.update() syncs its internal state; its 'change' event is not a player move
    applying.current = true
    controls.update()
    applying.current = false
  }
  const applyRef = useRef(apply)
  const readRef = useRef(read)
  useEffect(() => {
    applyRef.current = apply
    readRef.current = read
  })

  const animateTo = (to: CameraState, onDone?: () => void, dur = FOCUS_DURATION_S, orbit?: number) => {
    driven.current = false
    if (reduced.current) {
      applyRef.current(to)
      onDone?.()
      anim.current = null
      return
    }
    anim.current = { from: readRef.current(), to, t: 0, dur, onDone, orbit }
  }
  const animateRef = useRef(animateTo)
  useEffect(() => {
    animateRef.current = animateTo
  })

  // configure controls once
  useEffect(() => {
    controls.connect(gl.domElement)
    // inertial glide after a drag is motion: off under reduced motion (kept in step each frame)
    controls.enableDamping = !reduced.current
    controls.dampingFactor = 0.09
    controls.screenSpacePanning = false
    controls.minDistance = CAMERA_LIMITS.minDistance
    controls.maxDistance = CAMERA_LIMITS.maxDistance
    controls.minPolarAngle = CAMERA_LIMITS.minPolar
    controls.maxPolarAngle = CAMERA_LIMITS.maxPolar
    controls.zoomToCursor = true
    controls.zoomSpeed = 0.9
    controls.rotateSpeed = 0.6
    controls.panSpeed = 1
    const onStart = () => {
      anim.current = null
      userMoved.current = true
      // the player touched this view: it leads its sync group until another view is touched
      if (groupRef.current) claimGroupLeader(groupRef.current, self)
      pending.current = null
      driven.current = false
    }
    const onChange = () => {
      if (!applying.current) userMoved.current = true
    }
    controls.addEventListener('start', onStart)
    controls.addEventListener('change', onChange)
    const shared = groupRef.current ? getGroupCamera(groupRef.current) : null
    const init = cameraState ?? shared ?? defaultCameraState(dims.width, dims.height, groundRef.current(0, dims.height * 0.06))
    applyRef.current(init)
    lastEmitted.current = init
    userMoved.current = false
    driven.current = !!cameraState
    // published as the root's controls (useThree().controls), like drei's makeDefault
    setThree({ controls })
    return () => {
      setThree({ controls: null })
      controls.removeEventListener('start', onStart)
      controls.removeEventListener('change', onChange)
      controls.disconnect()
    }
    // cameraState is applied by the effect below; init only reads its first value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls, gl, dims.width, dims.height, self, setThree])

  // sync group: received cameras go into a ref and are applied in useFrame (no React state)
  useEffect(() => {
    if (!syncGroup) return
    const off = subscribeGroupCamera(syncGroup, (s, from) => {
      if (from !== self) pending.current = s
    })
    return () => {
      off()
      releaseGroupLeader(syncGroup, self)
    }
  }, [syncGroup, self])

  // externally driven camera (compare views)
  useEffect(() => {
    if (!cameraState || sameCameraState(cameraState, lastEmitted.current)) return
    applyRef.current(cameraState)
    lastEmitted.current = cameraState
    userMoved.current = false
    driven.current = true
  }, [cameraState])

  // UI commands + keyboard + focus requests (game view only)
  useEffect(() => {
    if (!interactive) return
    const offCmd = onCameraCommand((cmd) => {
      const cur = readRef.current()
      if (cmd.type === 'reset') {
        animateRef.current(defaultCameraState(dims.width, dims.height, groundRef.current(0, dims.height * 0.06)))
        return
      }
      const off = [cur.position[0] - cur.target[0], cur.position[1] - cur.target[1], cur.position[2] - cur.target[2]]
      if (cmd.type === 'zoom') {
        const len = Math.hypot(off[0], off[1], off[2])
        const next = Math.min(CAMERA_LIMITS.maxDistance, Math.max(CAMERA_LIMITS.minDistance, len * (cmd.direction > 0 ? 0.75 : 1.33)))
        const k = next / len
        animateRef.current({ target: cur.target, position: [cur.target[0] + off[0] * k, cur.target[1] + off[1] * k, cur.target[2] + off[2] * k] })
      } else {
        // orbit about the target: distance and height stay fixed while the azimuth turns
        const a = (cmd.direction * Math.PI) / 4
        animateRef.current(orbitAt(cur, a, 1), undefined, FOCUS_DURATION_S, a)
      }
    })
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const g = useGame.getState()
      if (g.reportOpen || g.screen !== 'game' || keyBlocksCamera(e)) return
      if (e.code === 'Space') {
        // Space is the pan modifier only while the pointer is over the world; preventing the
        // default stops it from also pressing whichever button last had focus
        if (input && input.pointerOver) {
          input.spaceHeld = true
          e.preventDefault()
        }
        return
      }
      // Shift+arrows belong to the UI's parcel cursor, and with the canvas focused plain arrows
      // move the cursor too (see Interaction); W A S D always pan
      if (e.code.startsWith('Arrow') && (e.shiftKey || input?.canvasFocused)) return
      if (e.code === 'Home') {
        animateRef.current(defaultCameraState(dims.width, dims.height, groundRef.current(0, dims.height * 0.06)))
        e.preventDefault()
        return
      }
      if (PAN_KEYS[e.code] || e.code === 'KeyQ' || e.code === 'KeyE' || e.code === 'Equal' || e.code === 'Minus' || e.code === 'NumpadAdd' || e.code === 'NumpadSubtract') {
        keys.current.add(e.code)
        anim.current = null
        driven.current = false
        if (e.code.startsWith('Arrow')) e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && input) {
        if (input.spaceHeld) e.preventDefault()
        input.spaceHeld = false
      }
      keys.current.delete(e.code)
    }
    const blur = () => {
      keys.current.clear()
      if (input) input.spaceHeld = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    // The keyboard cursor sets focusCell to the cursor cell on every move: follow it gently
    // (no zoom, no move while it is well inside the view). Other requests centre and come in.
    const focus = (cell: number) => {
      const { x, z } = cellToWorld(cell, dims)
      const y = groundRef.current(x, z)
      const g = useGame.getState()
      const mode = g.cursorCell === cell ? 'follow' : 'focus'
      camera.updateMatrixWorld()
      _ndc.set(x, y, z).project(camera)
      const plan = planFocus(readRef.current(), [x, y, z], { x: _ndc.x, y: _ndc.y, z: _ndc.z }, mode)
      if (!plan) {
        g.clearFocus()
        return
      }
      animateRef.current(plan, () => useGame.getState().clearFocus(), mode === 'follow' ? FOLLOW_DURATION_S : FOCUS_DURATION_S)
    }
    const unsubFocus = useGame.subscribe((s, p) => {
      if (s.focusCell !== null && s.focusCell !== p.focusCell) focus(s.focusCell)
    })
    // a focus request may already be pending when the view mounts
    const pendingFocus = useGame.getState().focusCell
    if (pendingFocus !== null) focus(pendingFocus)
    return () => {
      offCmd()
      unsubFocus()
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [interactive, dims, input, camera])

  useFrame((_, dtRaw) => {
    const dt = Math.min(0.1, dtRaw)
    controls.enableDamping = !reduced.current
    // mouse mapping follows the active tool
    const buildTool = interactive && !readOnlyRef.current && tool.current !== 'inspect'
    const leftPans = !buildTool || !!input?.spaceHeld
    controls.mouseButtons.LEFT = input?.painting ? null : leftPans ? MOUSE.PAN : null
    controls.mouseButtons.MIDDLE = buildTool ? MOUSE.PAN : MOUSE.DOLLY
    controls.mouseButtons.RIGHT = MOUSE.ROTATE
    controls.touches.ONE = buildTool ? null : TOUCH.PAN
    controls.touches.TWO = TOUCH.DOLLY_ROTATE

    // following another view of the sync group: take its camera as is, with no damping,
    // ground-follow or limits of our own, and never publish it back
    const group = groupRef.current
    if (group && isGroupFollower(group, self)) {
      const next = pending.current
      pending.current = null
      if (next && !sameCameraState(next, readRef.current())) applyRef.current(next)
      if (next) lastEmitted.current = next
      userMoved.current = false
      return
    }
    if (pending.current) {
      // no leader yet (or it left): adopt the latest shared camera once
      applyRef.current(pending.current)
      lastEmitted.current = pending.current
      pending.current = null
    }

    // keyboard
    if (keys.current.size) {
      _offset.copy(camera.position).sub(controls.target)
      const dist = _offset.length()
      const az = Math.atan2(_offset.x, _offset.z)
      let px = 0
      let pz = 0
      let rot = 0
      let zoom = 0
      for (const k of keys.current) {
        const p = PAN_KEYS[k]
        if (p) {
          px += p[0]
          pz += p[1]
        }
        if (k === 'KeyQ') rot -= 1
        if (k === 'KeyE') rot += 1
        if (k === 'Equal' || k === 'NumpadAdd') zoom -= 1
        if (k === 'Minus' || k === 'NumpadSubtract') zoom += 1
      }
      const speed = dist * 0.9 * dt
      const dx = (px * Math.cos(az) + pz * Math.sin(az)) * speed
      const dz = (-px * Math.sin(az) + pz * Math.cos(az)) * speed
      controls.target.x += dx
      controls.target.z += dz
      camera.position.x += dx
      camera.position.z += dz
      if (rot) {
        const a = rot * dt * 1.4
        const ox = _offset.x * Math.cos(a) - _offset.z * Math.sin(a)
        const oz = _offset.x * Math.sin(a) + _offset.z * Math.cos(a)
        camera.position.set(controls.target.x + ox, camera.position.y, controls.target.z + oz)
      }
      if (zoom) {
        _offset.copy(camera.position).sub(controls.target)
        const next = Math.min(CAMERA_LIMITS.maxDistance, Math.max(CAMERA_LIMITS.minDistance, _offset.length() * (1 + zoom * dt * 1.5)))
        _offset.setLength(next)
        camera.position.copy(controls.target).add(_offset)
      }
      userMoved.current = true
    }

    // animations (focus, reset, zoom/rotate commands)
    const a = anim.current
    if (a) {
      a.t = Math.min(1, a.t + dt / a.dur)
      const e = easeInOut(a.t)
      if (a.orbit !== undefined) {
        const o = orbitAt(a.from, a.orbit, e)
        camera.position.set(...o.position)
        controls.target.set(...o.target)
      } else {
        camera.position.set(...lerp3(a.from.position, a.to.position, e))
        controls.target.set(...lerp3(a.from.target, a.to.target, e))
      }
      userMoved.current = true
      if (a.t >= 1) {
        anim.current = null
        a.onDone?.()
      }
    }

    controls.update(dt)

    // keep the target on the map and on the ground, and the camera above the terrain
    const [cx, cz] = clampTarget(controls.target.x, controls.target.z, dims.width, dims.height)
    const shiftX = cx - controls.target.x
    const shiftZ = cz - controls.target.z
    if (shiftX || shiftZ) {
      controls.target.x = cx
      controls.target.z = cz
      camera.position.x += shiftX
      camera.position.z += shiftZ
    }
    if (!a && !driven.current) {
      const gy = groundRef.current(controls.target.x, controls.target.z)
      const dy = (gy - controls.target.y) * Math.min(1, dt * 3)
      if (Math.abs(dy) > 1e-4) {
        controls.target.y += dy
        camera.position.y += dy
      }
    }
    const floor = groundRef.current(camera.position.x, camera.position.z) + CAMERA_LIMITS.clearance
    if (camera.position.y < floor) camera.position.y = floor

    // a group leader publishes every change (including damping and ground-follow after a
    // move); a standalone view reports only movement the player caused
    if (userMoved.current || (group && isGroupLeader(group, self))) {
      const s = readRef.current()
      if (!sameCameraState(s, lastEmitted.current)) {
        lastEmitted.current = s
        if (group) publishGroupCamera(group, s, self)
        emit.current?.(s)
      }
    }
    userMoved.current = false
  })

  return null
}
