// Runoff overlay, flow part: chevrons along each cell's D8 flow direction (terrain.flowTo), sized
// by the water passing through the cell last season (fields.flowMm), drifting downhill. Static
// when reduced motion is on. The overlay colors and the terrain's wavy-line cue show the local
// runoff (fields.runoffMm); these arrows show where it goes.
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, DoubleSide, Euler, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, ShaderMaterial, Vector3 } from 'three'
import { cellToWorld, heightAt, terrainHeights } from '../core/coords'
import type { WorldFrame } from '../core/frame'
import { quantile } from '../core/overlays'
import { arrowGeometry } from '../props/geometries'
import { useStoreRef } from '../scene/storeHooks'
import { ARROW_SIZE_BASE, ARROW_SIZE_GAIN, ARROW_SPEED_BASE, ARROW_SPEED_GAIN, ARROW_TRAVEL, arrowSize } from './runoffArrowData'

const f = (v: number) => v.toFixed(4)

const VERT = /* glsl */ `
uniform float uTime;
uniform float uMotion;
varying float vFade;
varying float vStrength;
attribute float aPhase;
attribute float aStrength;
void main() {
  // speed grows with flow; the slide is a fixed world distance (divided by the instance scale)
  float t = fract(uTime * (${f(ARROW_SPEED_BASE)} + ${f(ARROW_SPEED_GAIN)} * aStrength) + aPhase);
  float size = ${f(ARROW_SIZE_BASE)} + ${f(ARROW_SIZE_GAIN)} * aStrength;
  float slide = (t - 0.5) * ${f(ARROW_TRAVEL)} * uMotion;
  vec3 p = position;
  p.x += slide / size;
  vFade = mix(1.0, sin(t * 3.14159), uMotion);
  vStrength = aStrength;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0);
}
`
const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uEdge;
varying float vFade;
varying float vStrength;
void main() {
  vec3 col = mix(uEdge, uColor, 0.4 + 0.6 * vStrength);
  gl_FragColor = vec4(col, (0.55 + 0.4 * vStrength) * vFade);
  #include <colorspace_fragment>
}
`

export interface RunoffArrowsProps {
  frame: WorldFrame
  visible: boolean
  quality: 'high' | 'low'
}

const _m = new Matrix4()
const _q = new Quaternion()
const _e = new Euler(0, 0, 0, 'YZX')
const _p = new Vector3()
const _s = new Vector3()

export function RunoffArrows({ frame, visible, quality }: RunoffArrowsProps) {
  const { terrain, fields, fieldsReady } = frame
  const n = terrain.width * terrain.height
  const geometry = useMemo(() => arrowGeometry(), [])
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        uniforms: { uTime: { value: 0 }, uMotion: { value: 1 }, uColor: { value: new Color('#ffffff') }, uEdge: { value: new Color('#1d3a5c') } },
      }),
    [],
  )
  // per-instance attributes sized for every cell once, then written in place
  const attrs = useMemo(() => {
    const phase = new InstancedBufferAttribute(new Float32Array(n), 1)
    const strength = new InstancedBufferAttribute(new Float32Array(n), 1)
    geometry.setAttribute('aPhase', phase)
    geometry.setAttribute('aStrength', strength)
    return { phase, strength }
  }, [geometry, n])
  const mesh = useMemo(() => {
    const m = new InstancedMesh(geometry, material, n)
    m.frustumCulled = false
    m.renderOrder = 4
    m.count = 0
    m.name = 'runoff-arrows'
    return m
  }, [geometry, material, n])
  // a new mesh (map size changed) keeps the shared geometry and material; those go on unmount
  useEffect(() => () => mesh.dispose(), [mesh])
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  useEffect(() => {
    if (!visible || !fieldsReady) {
      mesh.count = 0
      return
    }
    const heights = terrainHeights(terrain)
    const logs = new Float32Array(n)
    for (let i = 0; i < n; i++) logs[i] = Math.log1p(Math.max(0, fields.flowMm[i]))
    const hi = Math.max(1e-6, quantile(logs, 0.99))
    const lo = quantile(logs, 0.35)
    const phase = attrs.phase.array as Float32Array
    const strength = attrs.strength.array as Float32Array
    let k = 0
    const stride = quality === 'low' ? 2 : 1
    for (let i = 0; i < n; i++) {
      const to = terrain.flowTo[i]
      if (to < 0) continue
      const x = i % terrain.width
      const z = Math.floor(i / terrain.width)
      if (stride > 1 && (x + z) % stride) continue
      const s = (logs[i] - lo) / Math.max(1e-6, hi - lo)
      if (s <= 0.02) continue
      const st = Math.min(1, s)
      const a = cellToWorld(i, terrain)
      const b = cellToWorld(to, terrain)
      const ya = heightAt(heights, terrain, a.x, a.z)
      const yb = heightAt(heights, terrain, b.x, b.z)
      const dx = b.x - a.x
      const dz = b.z - a.z
      const horiz = Math.hypot(dx, dz)
      _e.set(0, Math.atan2(-dz, dx), Math.atan2(yb - ya, horiz))
      _q.setFromEuler(_e)
      const size = arrowSize(st)
      _p.set(a.x + dx * 0.25, Math.max(ya, (ya + yb) / 2) + 0.12, a.z + dz * 0.25)
      _s.set(size, 1, size)
      _m.compose(_p, _q, _s)
      mesh.setMatrixAt(k, _m)
      phase[k] = ((x * 7 + z * 13) % 17) / 17
      strength[k] = st
      k++
    }
    for (const a of [attrs.phase, attrs.strength, mesh.instanceMatrix]) {
      a.clearUpdateRanges()
      a.addUpdateRange(0, k * a.itemSize)
      a.needsUpdate = true
    }
    mesh.count = k
  }, [visible, fieldsReady, fields.flowMm, terrain, n, mesh, attrs, quality])

  const reduced = useStoreRef((s) => s.reducedMotion)
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime
    material.uniforms.uMotion.value = reduced.current ? 0 : 1
  })

  return <primitive object={mesh} visible={visible} />
}
