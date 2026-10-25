// Hover outline, selection outline (gently pulsing) and the tool preview: one draped tile per
// affected cell, blue where the action is valid and orange with diagonal stripes where it is not,
// so validity never depends on color alone. When the action as a whole is refused (say it is
// over budget) every tile is drawn blocked, matching the status line. Before the store has
// validated a preview the tiles are neutral white.
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, DoubleSide, MeshBasicMaterial, ShaderMaterial } from 'three'
import { useGame, type GameStore } from '../../state/store'
import { hoverCellsForTool } from '../core/brush'
import type { GridDims } from '../core/coords'
import { useStoreRef } from '../scene/storeHooks'
import { DynamicGeometry } from './dynamicGeometry'
import { TILE_INSET, TILE_STATE, buildOutline, buildTiles, previewTileStates } from './highlightData'

const TILE_VERT = /* glsl */ `
attribute float aState;
attribute vec2 aLocal;
varying float vState;
varying vec2 vLocal;
varying vec3 vWorld;
void main() {
  vState = aState;
  vLocal = aLocal;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
const TILE_FRAG = /* glsl */ `
uniform vec3 uValid;
uniform vec3 uInvalid;
uniform vec3 uPending;
uniform float uPulse;
varying float vState;
varying vec2 vLocal;
varying vec3 vWorld;
const float INSET = ${TILE_INSET.toFixed(3)};
void main() {
  // the tile covers the whole cell on the terrain's vertex grid; the inset is drawn here
  if (min(vLocal.x, vLocal.y) < INSET || max(vLocal.x, vLocal.y) > 1.0 - INSET) discard;
  vec2 lc = (vLocal - INSET) / (1.0 - 2.0 * INSET);
  float valid = step(0.75, vState);
  float invalid = step(vState, 0.25);
  float pending = 1.0 - valid - invalid;
  vec3 col = uValid * valid + uInvalid * invalid + uPending * pending;
  float edge = max(max(1.0 - smoothstep(0.0, 0.07, lc.x), smoothstep(0.93, 1.0, lc.x)), max(1.0 - smoothstep(0.0, 0.07, lc.y), smoothstep(0.93, 1.0, lc.y)));
  float d = (vWorld.x + vWorld.z) * 5.0;
  float stripes = invalid * (1.0 - smoothstep(0.18, 0.24, abs(fract(d) - 0.5)));
  float a = 0.32 + 0.18 * uPulse + edge * 0.45 + stripes * 0.45;
  col = mix(col, vec3(0.08, 0.05, 0.03), stripes * 0.55);
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.92));
  #include <colorspace_fragment>
}
`

export interface HighlightsProps {
  dims: GridDims
  heights: Float32Array
  readOnly: boolean
}

const TILE_LAYOUT = { position: 3, aState: 1, aLocal: 2 } as const
const OUTLINE_LAYOUT = { position: 3 } as const
const writeOutline = (g: DynamicGeometry, positions: Float32Array) => g.write({ position: positions }, positions.length / 3)

export function Highlights({ dims, heights, readOnly }: HighlightsProps) {
  // buffers are preallocated and written in place (hover changes many times a second)
  const tileGeo = useMemo(() => new DynamicGeometry(TILE_LAYOUT, true, 256), [])
  const hoverGeo = useMemo(() => new DynamicGeometry(OUTLINE_LAYOUT, false, 256), [])
  const selectGeo = useMemo(() => new DynamicGeometry(OUTLINE_LAYOUT, false, 256), [])
  const cursorGeo = useMemo(() => new DynamicGeometry(OUTLINE_LAYOUT, false, 256), [])
  const tileMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: TILE_VERT,
        fragmentShader: TILE_FRAG,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        uniforms: {
          uValid: { value: new Color('#56b4e9') },
          uInvalid: { value: new Color('#e66100') },
          uPending: { value: new Color('#f5f1e6') },
          uPulse: { value: 0 },
        },
      }),
    [],
  )
  const hoverMat = useMemo(() => new MeshBasicMaterial({ color: '#fff7e0', transparent: true, opacity: 0.9, depthWrite: false, side: DoubleSide, fog: false }), [])
  const selectMat = useMemo(() => new MeshBasicMaterial({ color: '#ffc94a', transparent: true, opacity: 1, depthWrite: false, side: DoubleSide, fog: false }), [])
  const cursorMat = useMemo(() => new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, depthWrite: false, side: DoubleSide, fog: false }), [])
  useEffect(
    () => () => {
      for (const o of [tileGeo, hoverGeo, selectGeo, cursorGeo, tileMat, hoverMat, selectMat, cursorMat]) o.dispose()
    },
    [tileGeo, hoverGeo, selectGeo, cursorGeo, tileMat, hoverMat, selectMat, cursorMat],
  )

  const reduced = useStoreRef((s) => s.reducedMotion)

  useEffect(() => {
    const rebuildTiles = (s: GameStore) => {
      let cells: number[] = []
      let states: number[] = []
      if (!readOnly && s.tool !== 'inspect') {
        if (s.preview && s.preview.cells.length) {
          cells = s.preview.cells
          states = previewTileStates(s.preview.validation, cells.length)
        } else if (s.hoverCell !== null) {
          cells = hoverCellsForTool(s.tool, s.hoverCell, s.brush, dims.width, dims.height)
          states = cells.map(() => TILE_STATE.pending)
        }
      }
      const t = buildTiles(cells, states, heights, dims)
      tileGeo.write({ position: t.positions, aState: t.state, aLocal: t.local }, t.state.length, t.indices)
    }
    const rebuildHover = (s: GameStore) => {
      const show = s.hoverCell !== null && (readOnly || s.tool === 'inspect')
      writeOutline(hoverGeo, buildOutline(show ? [s.hoverCell!] : [], heights, dims, 0.05, 0.06))
    }
    const rebuildSelect = (s: GameStore) => {
      writeOutline(selectGeo, buildOutline(s.selectedCell !== null ? [s.selectedCell] : [], heights, dims, 0.09, 0.08))
    }
    // the store's keyboard parcel cursor, when it has one: a wide white ring
    const rebuildCursor = (s: GameStore) => {
      const c = s.cursorCell
      writeOutline(cursorGeo, buildOutline(c !== null && c !== undefined ? [c] : [], heights, dims, 0.12, 0.09))
    }
    const s0 = useGame.getState()
    rebuildTiles(s0)
    rebuildHover(s0)
    rebuildSelect(s0)
    rebuildCursor(s0)
    return useGame.subscribe((s, p) => {
      if (s.preview !== p.preview || s.hoverCell !== p.hoverCell || s.tool !== p.tool || s.brush !== p.brush) rebuildTiles(s)
      if (s.hoverCell !== p.hoverCell || s.tool !== p.tool) rebuildHover(s)
      if (s.selectedCell !== p.selectedCell) rebuildSelect(s)
      if (s.cursorCell !== p.cursorCell) rebuildCursor(s)
    })
  }, [dims, heights, readOnly, tileGeo, hoverGeo, selectGeo, cursorGeo])

  useFrame((state) => {
    const pulse = reduced.current ? 0.5 : 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 3.2)
    tileMat.uniforms.uPulse.value = pulse
    selectMat.opacity = 0.75 + 0.25 * pulse
  })

  return (
    <group name="highlights">
      <mesh geometry={tileGeo.geometry} material={tileMat} renderOrder={6} frustumCulled={false} name="preview-tiles" />
      <mesh geometry={hoverGeo.geometry} material={hoverMat} renderOrder={7} frustumCulled={false} name="hover-outline" />
      <mesh geometry={selectGeo.geometry} material={selectMat} renderOrder={8} frustumCulled={false} name="selection-outline" />
      <mesh geometry={cursorGeo.geometry} material={cursorMat} renderOrder={9} frustumCulled={false} name="cursor-outline" />
    </group>
  )
}
