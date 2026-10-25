// Sky dome, fog, sun with tuned shadows and a hemisphere fill. Blends to the mood of the
// current season and weather. Also hosts rain and dust particles driven by the same mood.
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Fog,
  LineSegments,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type DirectionalLight,
  type HemisphereLight,
  type Mesh,
} from 'three'
import type { Season } from '../../simulation/types'
import type { WeatherKind } from '../core/frame'
import { hash01 } from '../core/hash'
import { sharedUniforms } from '../props/materials'
import { useStoreRef } from '../scene/storeHooks'
import { WATER_ATMOSPHERE_KEY, type WaterAtmosphere } from '../water/WaterSurface'
import { easeOverlayMix } from '../core/overlayFade'
import { heightAt, type GridDims } from '../core/coords'
import { RAIN_COLUMN, SUN_DIR_RAW, blendMood, easeBase, particleBases, cloneMood, moodFor, overlayFogRange, shadowHalfExtent, waterGlint, waterSkyColor } from './atmosphereData'

const SUN_DIR = new Vector3(...SUN_DIR_RAW).normalize()

const _dir = new Vector3()

export interface AtmosphereProps {
  season: Season
  weather: WeatherKind
  quality: 'high' | 'low'
  /** Half-size of the map in world units (shadow frustum). */
  extent: number
  /** Snap instead of blending (first frame / view switch). */
  sourceKey: string
  /** An overlay is shown: the fog is pushed out so overlay colors match their legend. */
  overlayActive?: boolean
  /** Terrain heights, so rain and dust start on the ground under the view instead of y = 0. */
  ground?: { heights: ArrayLike<number>; dims: GridDims }
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
}
`
const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
varying vec3 vDir;
void main() {
  float h = clamp(vDir.y, -0.2, 1.0);
  float t = pow(max(h, 0.0), 0.55);
  vec3 col = mix(uHorizon, uTop, t);
  col = mix(col, uHorizon * 0.92, smoothstep(0.0, -0.2, h));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

const RAIN_VERT = /* glsl */ `
attribute float aEnd;
uniform float uTime;
uniform vec3 uCenter;
uniform float uSize;
uniform float uHeight;
uniform float uStrength;
varying float vFade;
void main() {
  vec3 b = position;
  float fall = mod(b.y - uTime * 22.0, uHeight);
  float x = uCenter.x + mod(b.x - uCenter.x + uSize * 0.5, uSize) - uSize * 0.5;
  float z = uCenter.z + mod(b.z - uCenter.z + uSize * 0.5, uSize) - uSize * 0.5;
  vec3 p = vec3(x, uCenter.y + fall - aEnd * 0.9, z);
  p.x += aEnd * 0.18;
  vFade = (1.0 - aEnd * 0.8) * smoothstep(0.0, 3.0, fall) * smoothstep(uHeight, uHeight - 3.0, fall);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`
const RAIN_FRAG = /* glsl */ `
uniform float uStrength;
varying float vFade;
void main() {
  gl_FragColor = vec4(0.82, 0.87, 0.92, 0.42 * uStrength * vFade);
}
`

const DUST_VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uCenter;
uniform float uSize;
uniform float uPx;
varying float vA;
void main() {
  vec3 b = position;
  float x = uCenter.x + mod(b.x + uTime * 0.6 - uCenter.x + uSize * 0.5, uSize) - uSize * 0.5;
  float z = uCenter.z + mod(b.z + uTime * 0.25 - uCenter.z + uSize * 0.5, uSize) - uSize * 0.5;
  float y = uCenter.y + b.y + sin(uTime * 0.4 + b.x) * 0.6;
  vec4 mv = modelViewMatrix * vec4(x, y, z, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPx * (30.0 / -mv.z);
  vA = smoothstep(0.0, 4.0, b.y) * (0.6 + 0.4 * sin(b.x * 3.1 + b.z));
}
`
const DUST_FRAG = /* glsl */ `
uniform float uStrength;
uniform vec3 uColor;
varying float vA;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float d = length(q);
  if (d > 0.5) discard;
  gl_FragColor = vec4(uColor, (1.0 - d * 2.0) * 0.35 * uStrength * vA);
}
`

function makeRain(count: number): LineSegments {
  const pos = new Float32Array(count * 2 * 3)
  const end = new Float32Array(count * 2)
  for (let k = 0; k < count; k++) {
    const x = hash01(k, 1, 7) * 80
    const y = hash01(k, 2, 7) * 28
    const z = hash01(k, 3, 7) * 80
    for (let e = 0; e < 2; e++) {
      const v = k * 2 + e
      pos[v * 3] = x
      pos[v * 3 + 1] = y
      pos[v * 3 + 2] = z
      end[v] = e
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setAttribute('aEnd', new BufferAttribute(end, 1))
  const m = new ShaderMaterial({
    vertexShader: RAIN_VERT,
    fragmentShader: RAIN_FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uCenter: { value: new Vector3() },
      uSize: { value: 80 },
      uHeight: { value: RAIN_COLUMN },
      uStrength: { value: 0 },
    },
  })
  const l = new LineSegments(g, m)
  l.frustumCulled = false
  l.renderOrder = 5
  return l
}

function makeDust(count: number): Points {
  const pos = new Float32Array(count * 3)
  for (let k = 0; k < count; k++) {
    pos[k * 3] = hash01(k, 1, 9) * 90
    pos[k * 3 + 1] = hash01(k, 2, 9) * 14
    pos[k * 3 + 2] = hash01(k, 3, 9) * 90
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  const m = new ShaderMaterial({
    vertexShader: DUST_VERT,
    fragmentShader: DUST_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uCenter: { value: new Vector3() },
      uSize: { value: 90 },
      uPx: { value: 6 },
      uStrength: { value: 0 },
      uColor: { value: new Vector3(0.95, 0.82, 0.6) },
    },
  })
  const p = new Points(g, m)
  p.frustumCulled = false
  p.renderOrder = 5
  return p
}

export function Atmosphere({ season, weather, quality, extent, sourceKey, overlayActive = false, ground }: AtmosphereProps) {
  const { scene, camera, gl } = useThree()
  const sun = useRef<DirectionalLight>(null)
  const hemi = useRef<HemisphereLight>(null)
  const sky = useRef<Mesh>(null)
  const target = useMemo(() => moodFor(season, weather), [season, weather])
  const mood = useRef(cloneMood(target))
  const lastKey = useRef(sourceKey)
  const reduced = useStoreRef((s) => s.reducedMotion)
  const groundRef = useRef(ground)
  groundRef.current = ground
  const base = useRef({ rain: Number.NaN, dust: Number.NaN })
  const overlayMix = useRef(overlayActive ? 1 : 0)
  const high = quality === 'high'

  const skyMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { uTop: { value: target.skyTop.clone() }, uHorizon: { value: target.skyHorizon.clone() } },
      }),
    // created once; colors are blended every frame
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const skyGeo = useMemo(() => new SphereGeometry(400, 32, 16), [])
  const rain = useMemo(() => makeRain(high ? 3600 : 1200), [high])
  const dust = useMemo(() => makeDust(high ? 900 : 300), [high])

  useEffect(() => {
    const fog = new Fog(mood.current.fog.clone(), mood.current.fogNear, mood.current.fogFar)
    scene.fog = fog
    scene.background = mood.current.skyHorizon.clone()
    return () => {
      if (scene.fog === fog) scene.fog = null
    }
  }, [scene])

  useEffect(
    () => () => {
      skyMat.dispose()
      skyGeo.dispose()
    },
    [skyMat, skyGeo],
  )
  useEffect(
    () => () => {
      rain.geometry.dispose()
      ;(rain.material as ShaderMaterial).dispose()
      dust.geometry.dispose()
      ;(dust.material as ShaderMaterial).dispose()
    },
    [rain, dust],
  )

  useEffect(() => {
    if (!sun.current) return
    const s = sun.current
    s.castShadow = high
    s.shadow.mapSize.set(high ? 2048 : 512, high ? 2048 : 512)
    // the light looks across the map diagonally, so fit the frustum to the map's rotated
    // half-extent (up to extent * sqrt 2) with a small margin; no corner loses its shadows
    const e = shadowHalfExtent(extent)
    s.shadow.camera.left = -e
    s.shadow.camera.right = e
    s.shadow.camera.top = e
    s.shadow.camera.bottom = -e
    s.shadow.camera.near = 1
    s.shadow.camera.far = 220
    s.shadow.bias = -0.0004
    s.shadow.normalBias = 0.03
    s.shadow.radius = 3
    s.shadow.camera.updateProjectionMatrix()
    s.shadow.map?.dispose()
    s.shadow.map = null
    gl.shadowMap.needsUpdate = true
  }, [high, extent, gl])

  useFrame((state, dt) => {
    sharedUniforms.uTime.value = state.clock.elapsedTime
    sharedUniforms.uWind.value = reduced.current ? 0 : 1
    const m = mood.current
    const instant = lastKey.current !== sourceKey || reduced.current
    lastKey.current = sourceKey
    blendMood(m, target, instant ? 1 : 1 - Math.exp(-1.5 * Math.min(0.1, dt)))
    skyMat.uniforms.uTop.value.copy(m.skyTop)
    skyMat.uniforms.uHorizon.value.copy(m.skyHorizon)
    if (sky.current) sky.current.position.copy(camera.position)
    const ov = (overlayMix.current = easeOverlayMix(overlayMix.current, overlayActive ? 1 : 0, dt, instant))
    if (scene.fog instanceof Fog) {
      const [near, far] = overlayFogRange(m.fogNear, m.fogFar, extent, ov)
      scene.fog.color.copy(m.fog)
      scene.fog.near = near
      scene.fog.far = far
    }
    if (scene.background && 'copy' in scene.background) (scene.background as typeof m.fog).copy(m.skyHorizon)
    if (sun.current) {
      sun.current.color.copy(m.sun)
      sun.current.intensity = m.sunIntensity
    }
    // the water's sky reflection and sun glint follow the same mood
    let wa = scene.userData[WATER_ATMOSPHERE_KEY] as WaterAtmosphere | undefined
    if (!wa) {
      wa = { sky: new Color(), sunDir: new Vector3(), glint: 1 }
      scene.userData[WATER_ATMOSPHERE_KEY] = wa
    }
    waterSkyColor(m, wa.sky)
    wa.sunDir.copy(SUN_DIR)
    wa.glint = waterGlint(m)
    if (hemi.current) {
      hemi.current.color.copy(m.hemiSky)
      hemi.current.groundColor.copy(m.hemiGround)
      hemi.current.intensity = m.hemiIntensity
    }
    // particles follow the point the camera looks at
    camera.getWorldDirection(_dir)
    const cx = camera.position.x + _dir.x * 25
    const cz = camera.position.z + _dir.z * 25
    const motion = !reduced.current
    const rm = rain.material as ShaderMaterial
    rm.uniforms.uTime.value = state.clock.elapsedTime
    const g = groundRef.current
    const bases = particleBases(g ? heightAt(g.heights, g.dims, cx, cz) : null)
    const b = base.current
    b.rain = easeBase(b.rain, bases.rainY, dt, instant)
    b.dust = easeBase(b.dust, bases.dustY, dt, instant)
    rm.uniforms.uCenter.value.set(cx, b.rain, cz)
    // weather particles thin out over an overlay so they do not veil its colors
    const veil = 1 - 0.6 * ov
    rm.uniforms.uStrength.value = m.rain * veil
    rain.visible = motion && m.rain > 0.02
    const dm = dust.material as ShaderMaterial
    dm.uniforms.uTime.value = state.clock.elapsedTime
    dm.uniforms.uCenter.value.set(cx, b.dust, cz)
    dm.uniforms.uStrength.value = m.dust * veil
    dm.uniforms.uPx.value = 6 * Math.min(2, gl.getPixelRatio())
    dust.visible = motion && m.dust > 0.02
  })

  return (
    <>
      <mesh ref={sky} geometry={skyGeo} material={skyMat} renderOrder={-10} frustumCulled={false} name="sky" />
      <hemisphereLight ref={hemi} args={[target.hemiSky, target.hemiGround, target.hemiIntensity]} />
      <directionalLight ref={sun} position={[SUN_DIR_RAW[0] * extent, SUN_DIR_RAW[1] * extent, SUN_DIR_RAW[2] * extent]} intensity={target.sunIntensity} color={target.sun} />
      <primitive object={rain} />
      <primitive object={dust} />
    </>
  )
}
