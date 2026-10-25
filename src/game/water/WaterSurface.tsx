// Stylised animated water: depth-tinted, flowing ripples along the river's D8 directions,
// shoreline foam where the surface meets the ground, murky wetland pools, muddy flood water.
// The river's level follows last season's flow and its color the sediment it carries.
// While an overlay is on, flood water and wetland pools thin out so the overlay colors and cue
// patterns on those land parcels stay readable (rivers and reservoirs have no overlay data).
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from 'three'
import { TERRAIN_SUB, terrainHeights } from '../core/coords'
import { easeOverlayMix } from '../core/overlayFade'
import type { WorldFrame } from '../core/frame'
import { useStoreRef } from '../scene/storeHooks'
import { blendWaterField, buildWaterMesh, computeWaterCells, waterGeometry, type WaterLevelField } from './waterData'

const VERT = /* glsl */ `
attribute float aGround;
attribute float aLevelFrom;
attribute float aTurbidity;
attribute float aTurbidityFrom;
uniform float uBlend;
attribute vec2 aFlow;
attribute float aKind;
uniform float uTime;
uniform float uMotion;
varying float vDepth;
varying vec2 vFlow;
varying float vKind;
varying float vTurb;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec3 p = position;
  // tween from the previous level (floods rise, pools fill and drain, reservoirs move)
  float blend = smoothstep(0.0, 1.0, uBlend);
  p.y = mix(aLevelFrom, position.y, blend);
  vTurb = mix(aTurbidityFrom, aTurbidity, blend);
  float wave = sin(p.x * 2.1 + uTime * 1.3) * cos(p.z * 1.7 - uTime * 1.1);
  p.y += wave * 0.012 * uMotion * step(aKind, 1.5);
  vDepth = p.y - aGround;
  vFlow = aFlow;
  vKind = aKind;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uMotion;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform vec3 uWetland;
uniform vec3 uFlood;
uniform vec3 uReservoir;
uniform vec3 uMud;
uniform vec3 uSky;
uniform vec3 uSunDir;
uniform float uGlint;
uniform float uOverlayMix;
varying float vDepth;
varying vec2 vFlow;
varying float vKind;
varying float vTurb;
varying vec3 vWorld;
#include <common>
#include <fog_pars_fragment>

float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  if (vDepth < -0.002) discard;
  float t = uTime * uMotion;
  vec2 p = vWorld.xz;
  vec2 drift = vFlow * t * 0.45;
  float n1 = vnoise((p - drift) * 2.6 + t * 0.04);
  float n2 = vnoise((p - drift * 1.4) * 6.5 - t * 0.07);
  float ripple = n1 * 0.6 + n2 * 0.4;
  float depthT = smoothstep(0.0, 0.22, vDepth);
  vec3 col = mix(uShallow, uDeep, depthT);
  float isWet = 1.0 - step(0.5, abs(vKind - 2.0));
  float isRes = 1.0 - step(0.5, abs(vKind - 3.0));
  float isFlood = 1.0 - step(0.5, abs(vKind - 4.0));
  col = mix(col, uWetland, isWet * 0.6);
  col = mix(col, uReservoir, isRes * 0.5);
  col = mix(col, uFlood, isFlood * 0.7);
  // sediment-laden water turns brown and loses its depth tint
  float mud = clamp(vTurb, 0.0, 1.0) * (1.0 - isFlood);
  col = mix(col, uMud * mix(1.0, 0.82, depthT), mud * 0.85);
  // stylised light bands
  col += smoothstep(0.64, 0.72, ripple) * 0.12 * (1.0 - isFlood);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
  col = mix(col, uSky, fres * 0.45);
  vec3 H = normalize(uSunDir + V);
  vec3 N = normalize(vec3((n1 - 0.5) * 0.35, 1.0, (n2 - 0.5) * 0.35));
  col += pow(max(dot(N, H), 0.0), 90.0) * 0.6 * uGlint;
  float foamEdge = 0.035 + 0.035 * n2;
  float foam = (1.0 - smoothstep(0.0, foamEdge, vDepth)) * (1.0 - isWet * 0.6);
  col = mix(col, uFoam, foam * 0.8);
  float alpha = mix(mix(0.62, 0.9, depthT), 0.92, mud);
  alpha = mix(alpha, 0.55, isWet);
  alpha = max(alpha, foam * 0.85);
  alpha *= 1.0 - 0.8 * uOverlayMix * max(isWet, isFlood);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

export interface WaterSurfaceProps {
  frame: WorldFrame
  /** Changes when the view switches source (live vs snapshot); levels snap instead of tweening. */
  sourceKey: string
  /** An overlay is shown: flood water and wetland pools fade so the overlay reads through. */
  overlayActive?: boolean
}

/** Seconds a water level change takes. */
const LEVEL_TWEEN_S = 1

/** Mood-driven inputs to the water shader, written by Atmosphere into scene.userData. */
export interface WaterAtmosphere {
  sky: Color
  sunDir: Vector3
  glint: number
}
export const WATER_ATMOSPHERE_KEY = 'amoriaWaterAtmosphere'

export function WaterSurface({ frame, sourceKey, overlayActive = false }: WaterSurfaceProps) {
  const heights = terrainHeights(frame.terrain)
  const { layers, terrain, fields, fieldsReady, reservoirFill } = frame
  const reduced = useStoreRef((s) => s.reducedMotion)
  const overlayRef = useRef(overlayActive)
  useEffect(() => {
    overlayRef.current = overlayActive
  })
  // Tween bookkeeping. `committed` is the field of the build that is on screen, written only
  // after commit, so the build below stays a pure function of its inputs: a repeated or
  // discarded render (StrictMode) blends from the same on-screen field and gets the same mesh.
  const committed = useRef<{ field: WaterLevelField | null; key: string }>({ field: null, key: '' })
  const tween = useRef({ t: 1 })
  const data = useMemo(() => {
    const cells = computeWaterCells(frame, heights)
    const last = committed.current
    const canTween = last.field !== null && last.key === sourceKey && !reduced.current
    const prev = canTween ? blendWaterField(last.field!, smooth(tween.current.t)) : null
    return { mesh: buildWaterMesh(frame, heights, cells, TERRAIN_SUB, prev), tweened: prev !== null, key: sourceKey }
    // rebuild only when water-relevant inputs change, not on every new frame object
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain, layers.cover, layers.structure, layers.wetlandStoreMm, fields.flooded, fields.floodDepthM, fields.flowMm, fields.sedimentFlux, fieldsReady, reservoirFill, heights, sourceKey])
  const geometry = useMemo(() => waterGeometry(data.mesh), [data])
  useLayoutEffect(() => {
    committed.current = { field: data.mesh.field, key: data.key }
    tween.current.t = data.tweened ? 0 : 1
  }, [data])
  useEffect(() => () => geometry.dispose(), [geometry])

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        fog: true,
        uniforms: UniformsUtils.merge([
          UniformsLib.fog,
          {
            uTime: { value: 0 },
            uMotion: { value: 1 },
            uBlend: { value: 1 },
            uShallow: { value: new Color('#7fc0b4') },
            uDeep: { value: new Color('#2f7088') },
            uFoam: { value: new Color('#f4f1e4') },
            uWetland: { value: new Color('#5d7f5a') },
            uFlood: { value: new Color('#8a7350') },
            uReservoir: { value: new Color('#2d6a8e') },
            uMud: { value: new Color('#9a7a4e') },
            uSky: { value: new Color('#cfe3ea') },
            uSunDir: { value: new Vector3(0.45, 0.8, 0.35).normalize() },
            uGlint: { value: 1 },
            uOverlayMix: { value: 0 },
          },
        ]),
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])

  useFrame((state, dt) => {
    const u = material.uniforms
    u.uTime.value = state.clock.elapsedTime
    u.uMotion.value = reduced.current ? 0 : 1
    const tw = tween.current
    if (tw.t < 1) tw.t = reduced.current ? 1 : Math.min(1, tw.t + Math.min(0.1, dt) / LEVEL_TWEEN_S)
    u.uBlend.value = tw.t
    u.uOverlayMix.value = easeOverlayMix(u.uOverlayMix.value, overlayRef.current ? 1 : 0, dt, reduced.current)
    const atmo = state.scene.userData[WATER_ATMOSPHERE_KEY] as WaterAtmosphere | undefined
    if (atmo) {
      u.uSky.value.copy(atmo.sky)
      u.uSunDir.value.copy(atmo.sunDir)
      u.uGlint.value = atmo.glint
    }
  })

  return <mesh geometry={geometry} material={material} renderOrder={2} name="water" />
}

const smooth = (t: number) => t * t * (3 - 2 * t)
