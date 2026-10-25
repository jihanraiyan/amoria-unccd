// The heightfield terrain. Geometry is rebuilt only when the terrain changes; ground colors are
// recomputed when layers/fields change and blended toward the new colors over ~1 s; the overlay
// is a per-cell texture faded in and out in the shader.
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector2, type Mesh } from 'three'
import { TERRAIN_SUB, terrainHeights } from '../core/coords'
import type { WorldFrame } from '../core/frame'
import { CUE_CODE, OVERLAYS, buildOverlayTextures, overlayDomain, overlayValues, type OverlayId } from '../core/overlays'
import { easeOverlayMix } from '../core/overlayFade'
import { useStoreRef } from '../scene/storeHooks'
import { buildTerrainGeometry, computeCellColors, writeVertexColors } from './terrainData'
import { createTerrainMaterial, makeCellTexture, overlayFilterFor, setCellTextureFilter, type TerrainUniforms } from './terrainMaterial'

export interface TerrainMeshProps {
  frame: WorldFrame
  /** Changes when the view switches source (live vs snapshot); colors snap instead of blending. */
  sourceKey: string
  /** Overlay to show; defaults to the store's overlay. */
  overlay?: OverlayId
  /** Fixed overlay domain (e.g. shared between two compare views). */
  overlayDomain?: [number, number] | null
  /** Colorblind-friendly state tints (store.colorblind). */
  colorblind?: boolean
}

const COLOR_BLEND_RATE = 3.5

export function TerrainMesh({ frame, sourceKey, overlay: overlayProp, overlayDomain: domainProp, colorblind = false }: TerrainMeshProps) {
  const meshRef = useRef<Mesh>(null)
  // same subdivision on every quality so props and highlights sit on the drawn surface
  const sub = TERRAIN_SUB
  const heights = terrainHeights(frame.terrain)
  const { geometry, grid } = useMemo(() => buildTerrainGeometry(frame.terrain, heights, sub), [frame.terrain, heights, sub])
  useEffect(() => () => geometry.dispose(), [geometry])

  const { width, height } = frame.terrain
  const uniforms = useMemo<TerrainUniforms>(
    () => ({
      uOverlayTex: { value: makeCellTexture(width, height, true, 'linear') },
      uCueTex: { value: makeCellTexture(width, height, false, 'nearest') },
      uOverlayMix: { value: 0 },
      uCueKind: { value: 0 },
      uGridSize: { value: new Vector2(width, height) },
      uContourStep: { value: 0.5 },
    }),
    [width, height],
  )
  const material = useMemo(() => createTerrainMaterial(uniforms), [uniforms])
  useEffect(
    () => () => {
      material.dispose()
      uniforms.uOverlayTex.value.dispose()
      uniforms.uCueTex.value.dispose()
    },
    [material, uniforms],
  )

  // ---- ground colors with blending
  const colors = useRef<{ cur: Float32Array; target: Float32Array; busy: boolean; key: string; geometry: unknown }>({ cur: new Float32Array(0), target: new Float32Array(0), busy: false, key: '', geometry: null })
  const reduced = useStoreRef((s) => s.reducedMotion)
  useEffect(() => {
    const c = colors.current
    const target = computeCellColors(frame, undefined, colorblind)
    const instant = c.cur.length !== target.length || c.key !== sourceKey || reduced.current || c.geometry !== geometry
    c.target = target
    c.key = sourceKey
    if (instant) {
      c.cur = target.slice()
      c.geometry = geometry
      writeVertexColors(geometry, grid, frame.terrain, c.cur)
      c.busy = false
    } else c.busy = true
  }, [frame, sourceKey, geometry, grid, reduced, colorblind])

  // ---- overlay
  const overlayState = useRef({ id: 'none' as OverlayId, target: 0 })
  const frameRef = useRef(frame)
  const domainRef = useRef(domainProp)
  useEffect(() => {
    frameRef.current = frame
    domainRef.current = domainProp
  })
  const applyOverlay = useMemo(
    () => (id: OverlayId) => {
      const f = frameRef.current
      const st = overlayState.current
      if (id === 'none') {
        st.target = 0
        return
      }
      const values = overlayValues(id, f)
      const domain = domainRef.current ?? overlayDomain(id, values)
      buildOverlayTextures(id, values, domain, {
        color: uniforms.uOverlayTex.value.image.data as Uint8Array,
        cue: uniforms.uCueTex.value.image.data as Uint8Array,
        domain,
      })
      setCellTextureFilter(uniforms.uOverlayTex.value, overlayFilterFor(OVERLAYS[id].valueKind))
      uniforms.uOverlayTex.value.needsUpdate = true
      uniforms.uCueTex.value.needsUpdate = true
      uniforms.uCueKind.value = CUE_CODE[OVERLAYS[id].cue.pattern]
      // contour spacing: about 14 lines over the relief of the map
      const h = terrainHeights(f.terrain)
      let hi = 0
      for (let i = 0; i < h.length; i++) hi = Math.max(hi, h[i])
      uniforms.uContourStep.value = Math.max(0.15, hi / 14)
      if (st.id !== id) uniforms.uOverlayMix.value = Math.min(uniforms.uOverlayMix.value, 0.35)
      st.id = id
      st.target = 1
    },
    [uniforms],
  )
  const storeOverlay = useStoreRef(
    (s) => s.overlay,
    (id) => {
      if (overlayProp === undefined) applyOverlay(id)
    },
  )
  // depend on the domain's values, not its array identity: the compare view passes a fresh
  // [lo, hi] on every render (for example while its reveal slider moves), and rebuilding the
  // overlay textures for an unchanged domain is wasted work
  const domainLo = domainProp ? domainProp[0] : null
  const domainHi = domainProp ? domainProp[1] : null
  useEffect(() => {
    applyOverlay(overlayProp ?? storeOverlay.current)
  }, [applyOverlay, frame, overlayProp, domainLo, domainHi, storeOverlay])

  useFrame((_, dt) => {
    const st = overlayState.current
    const mixU = uniforms.uOverlayMix
    if (mixU.value !== st.target) mixU.value = easeOverlayMix(mixU.value, st.target, dt, reduced.current)
    const c = colors.current
    if (!c.busy) return
    if (reduced.current) {
      c.cur = c.target.slice()
      c.busy = false
    } else {
      const k = 1 - Math.exp(-COLOR_BLEND_RATE * Math.min(0.1, dt))
      let busy = false
      for (let i = 0; i < c.cur.length; i++) {
        const d = c.target[i] - c.cur[i]
        if (Math.abs(d) > 0.002) {
          c.cur[i] += d * k
          busy = true
        } else c.cur[i] = c.target[i]
      }
      c.busy = busy
    }
    writeVertexColors(geometry, grid, frame.terrain, c.cur)
  })

  return <mesh ref={meshRef} geometry={geometry} material={material} castShadow receiveShadow name="terrain" />
}
