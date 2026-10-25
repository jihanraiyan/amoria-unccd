// Mounts the real React Three Fiber scene graph (no component mocks below the canvas wrapper)
// on a detached canvas with a stub renderer and frameloop 'never', then drives frames with
// advance(). This runs the mount, effect, useFrame and dispose paths of the terrain, water,
// props, atmosphere, runoff arrows, highlights, interaction, camera rig and the three public
// scenes. Only SceneCanvas (the DOM wrapper around <Canvas>) is replaced, by a pass-through,
// because jsdom has no WebGL and no layout for <Canvas> to measure.
import './dom'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { StrictMode, act, type ReactNode } from 'react'
import * as THREE from 'three'
import { advance, createRoot, extend, useThree, type RootState } from '@react-three/fiber'
import type { BufferGeometry, InstancedMesh, Material, Mesh, Object3D, PerspectiveCamera } from 'three'
import { useGame } from '../../state/store'
import { createInitialState, generateProceduralWorld, makeSnapshot } from '../../simulation'
import { coverCode, type SimulationState } from '../../simulation/types'
import { terrainHeights } from '../core/coords'
import { frameFromSim, type WorldFrame } from '../core/frame'
import { countKind, computeBuildings, computeVegetation, VEG_KIND_COUNT, BUILD_KIND_COUNT } from '../core/placement'
import { TERRAIN_SUB } from '../core/coords'
import { CANVAS_LIVE_ATTR, CANVAS_WRAPPER_ATTR } from '../controls/cameraBus'
import { cursorAnnouncement } from '../controls/announce'
import { blendWaterField, buildWaterMesh, computeWaterCells } from '../water/waterData'
import { makeFrame } from './fixtures'

// <Canvas> registers the three namespace and the act environment; a bare root needs both
extend(THREE as never)
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../scene/SceneCanvas', () => ({
  SceneCanvas: ({ children }: { children: ReactNode }) => children,
  KEYBOARD_HELP: '',
}))

const { WorldRenderer } = await import('../scene/WorldRenderer')
const { GameScene } = await import('../scene/GameScene')
const { SnapshotView } = await import('../scene/SnapshotView')
const { LandingScene } = await import('../scene/LandingScene')
const { WaterSurface } = await import('../water/WaterSurface')
const { RunoffArrows } = await import('../effects/RunoffArrows')

/** The parts of WebGLRenderer that R3F and our components touch. */
function stubRenderer(canvas: HTMLCanvasElement) {
  return {
    domElement: canvas,
    render: vi.fn(),
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    getPixelRatio: () => 1,
    setClearColor: vi.fn(),
    setAnimationLoop: vi.fn(),
    dispose: vi.fn(),
    forceContextLoss: vi.fn(),
    shadowMap: { enabled: false, type: 1, needsUpdate: false, autoUpdate: true },
    info: { autoReset: true, reset: vi.fn(), render: { calls: 0, triangles: 0, points: 0, lines: 0, frame: 0 }, memory: { geometries: 0, textures: 0 }, programs: [] },
    capabilities: { isWebGL2: true, maxTextureSize: 4096, maxAnisotropy: 1, getMaxAnisotropy: () => 1, precision: 'highp' },
    outputColorSpace: 'srgb',
    toneMapping: 0,
    toneMappingExposure: 1,
  }
}

let state: RootState | null = null
function Grab() {
  state = useThree()
  return null
}

let clock = 0
/** Run n frames of dt seconds through every root (frameloop 'never'; timestamps in seconds). */
function frames(n: number, dt = 1 / 60) {
  for (let k = 0; k < n; k++) {
    clock += dt
    act(() => advance(clock))
  }
}

async function mount(node: ReactNode, canvas: HTMLCanvasElement = document.createElement('canvas')) {
  const root = createRoot(canvas)
  await root.configure({ gl: stubRenderer(canvas) as never, frameloop: 'never', size: { width: 800, height: 600, top: 0, left: 0 }, camera: { fov: 34, near: 0.5, far: 1200, position: [30, 45, 50] } })
  await act(async () => {
    root.render(
      <>
        {node}
        <Grab />
      </>,
    )
  })
  return {
    root,
    rerender: async (next: ReactNode) =>
      act(async () => {
        root.render(
          <>
            {next}
            <Grab />
          </>,
        )
      }),
    unmount: async () => act(async () => root.unmount()),
  }
}

const find = (name: string): Object3D | undefined => state!.scene.getObjectByName(name)
const visibleCount = (group: string, kind: number) => (find(`${group}-${kind}`) as InstancedMesh | undefined)?.count ?? 0

let sim: SimulationState
let warn: ReturnType<typeof vi.spyOn>
beforeAll(() => {
  // the Kenney GLBs cannot be fetched in jsdom; the renderer falls back to procedural trees
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  sim = createInitialState(generateProceduralWorld(7), 7)
})
afterAll(() => warn.mockRestore())

describe('WorldRenderer in a real R3F scene', () => {
  it('builds terrain, water, props, sky and arrows; overlays, reduced motion and dispose work', async () => {
    useGame.setState({ overlay: 'none', reducedMotion: false, quality: 'high', colorblind: false })
    const frame: WorldFrame = frameFromSim(sim)
    const view = await mount(<WorldRenderer frame={frame} sourceKey="live" quality="high" />)
    frames(3)
    for (const name of ['terrain', 'water', 'props', 'vegetation', 'marks', 'roads', 'buildings', 'sky', 'runoff-arrows']) expect(find(name), name).toBeDefined()
    expect(state!.gl.render).toHaveBeenCalled()

    // instance counts match the placement targets (first load is instant)
    const heights = terrainHeights(frame.terrain)
    const veg = computeVegetation(frame, heights, { forestSlots: 4 })
    const build = computeBuildings(frame, heights)
    for (let k = 0; k < VEG_KIND_COUNT; k++) expect(visibleCount('vegetation', k), `vegetation kind ${k}`).toBe(countKind(veg, k))
    for (let k = 0; k < BUILD_KIND_COUNT; k++) expect(visibleCount('buildings', k), `building kind ${k}`).toBe(countKind(build, k))
    expect(countKind(veg)).toBeGreaterThan(1000)

    // the store overlay fades the terrain overlay in, and out again
    const terrain = find('terrain') as Mesh
    const uniforms = (terrain.material as Material).userData.amoriaUniforms as { uOverlayMix: { value: number }; uCueKind: { value: number } }
    expect(uniforms.uOverlayMix.value).toBe(0)
    act(() => useGame.getState().setOverlay('slope'))
    frames(2)
    const partly = uniforms.uOverlayMix.value
    expect(partly).toBeGreaterThan(0)
    expect(partly).toBeLessThan(1)
    expect(uniforms.uCueKind.value).toBe(1)
    frames(90)
    expect(uniforms.uOverlayMix.value).toBe(1)
    act(() => useGame.getState().setOverlay('none'))
    frames(90)
    expect(uniforms.uOverlayMix.value).toBe(0)

    // clearing forest: without reduced motion the trees shrink away over several frames
    const forest = coverCode('forest')
    const cleared = (src: WorldFrame): WorldFrame => {
      const cover = src.layers.cover.slice()
      for (let i = 0; i < cover.length; i++) if (cover[i] === forest && i % 2 === 0) cover[i] = coverCode('bare')
      return { ...src, layers: { ...src.layers, cover } }
    }
    const f2 = cleared(frame)
    const after = computeVegetation(f2, heights, { forestSlots: 4 })
    const treesNow = () => Array.from({ length: VEG_KIND_COUNT }, (_, k) => visibleCount('vegetation', k)).reduce((a, b) => a + b, 0)
    await view.rerender(<WorldRenderer frame={f2} sourceKey="live" quality="high" />)
    frames(1)
    expect(treesNow()).toBeGreaterThan(countKind(after))
    frames(120)
    expect(treesNow()).toBe(countKind(after))

    // with reduced motion the next change snaps in one frame, overlays included
    act(() => useGame.setState({ reducedMotion: true }))
    await view.rerender(<WorldRenderer frame={frame} sourceKey="live" quality="high" />)
    frames(1)
    expect(treesNow()).toBe(countKind(veg))
    act(() => useGame.getState().setOverlay('elevation'))
    frames(1)
    expect(uniforms.uOverlayMix.value).toBe(1)
    act(() => useGame.setState({ reducedMotion: false, overlay: 'none' }))

    // unmount disposes terrain and water geometry and materials
    const water = find('water') as Mesh
    const spies = [terrain.geometry, terrain.material as Material, water.geometry, water.material as Material].map((o) => vi.spyOn(o as BufferGeometry | Material, 'dispose'))
    await view.unmount()
    for (const s of spies) expect(s).toHaveBeenCalled()
  }, 60000)
})

describe('public scenes mounted for real', () => {
  it('GameScene draws the live world with camera, picking and highlights, and switches to a snapshot', async () => {
    useGame.setState({ sim, viewSnapshot: null, viewStep: null, quality: 'low', overlay: 'none', reducedMotion: true, focusCell: null })
    const view = await mount(<GameScene />)
    frames(3)
    for (const name of ['terrain', 'water', 'props', 'sky', 'highlights', 'preview-tiles', 'selection-outline']) expect(find(name), name).toBeDefined()
    // low quality: 2 trees per forest cell
    const frame = frameFromSim(sim)
    const veg = computeVegetation(frame, terrainHeights(frame.terrain), { forestSlots: 2 })
    let shown = 0
    for (let k = 0; k < VEG_KIND_COUNT; k++) shown += visibleCount('vegetation', k)
    expect(shown).toBe(countKind(veg))
    // the camera rig placed an elevated strategic view
    const cam = state!.camera as PerspectiveCamera
    expect(cam.position.y).toBeGreaterThan(20)
    // selecting a parcel draws its outline
    act(() => useGame.getState().selectCell(sim.terrain.width * 32 + 32))
    frames(1)
    expect(((find('selection-outline') as Mesh).geometry as BufferGeometry).drawRange.count).toBeGreaterThan(0)
    // an explicit focus request moves the camera to the cell and is then cleared
    const before = cam.position.clone()
    act(() => useGame.setState({ focusCell: 5 }))
    frames(2)
    expect(cam.position.distanceTo(before)).toBeGreaterThan(1)
    expect(useGame.getState().focusCell).toBeNull()
    // the keyboard cursor moving next to the centred cell does not pull the camera around
    const settled = cam.position.clone()
    act(() => useGame.setState({ cursorCell: 6, focusCell: 6 }))
    frames(2)
    expect(cam.position.distanceTo(settled)).toBeLessThan(0.05)
    expect(useGame.getState().focusCell).toBeNull()
    act(() => useGame.setState({ cursorCell: null }))
    // viewing a past snapshot re-renders the world from it
    act(() => useGame.setState({ viewSnapshot: makeSnapshot(sim, 1, 'wet'), viewStep: 0 }))
    frames(2)
    expect(find('terrain')).toBeDefined()
    await view.unmount()
    act(() => useGame.setState({ viewSnapshot: null, viewStep: null, selectedCell: null }))
  }, 60000)

  it('SnapshotView renders a stored snapshot read-only', async () => {
    useGame.setState({ quality: 'high', reducedMotion: true })
    const snap = makeSnapshot(sim, 1, 'wet')
    const view = await mount(<SnapshotView snapshot={snap} terrain={sim.terrain} syncGroup="mount-test" overlay="soil" />)
    frames(3)
    for (const name of ['terrain', 'water', 'vegetation', 'sky']) expect(find(name), name).toBeDefined()
    expect(find('highlights')).toBeUndefined()
    const uniforms = ((find('terrain') as Mesh).material as Material).userData.amoriaUniforms as { uOverlayMix: { value: number } }
    expect(uniforms.uOverlayMix.value).toBe(1)
    await view.unmount()
  }, 60000)

  it('LandingScene shows the sky first and builds the world after the idle callback', async () => {
    useGame.setState({ sim: null, quality: 'low', reducedMotion: false })
    const world = generateProceduralWorld(11)
    const view = await mount(<LandingScene world={world} seed={3} />)
    frames(1)
    expect(find('sky')).toBeDefined()
    expect(find('terrain')).toBeUndefined()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400))
    })
    frames(2)
    expect(find('terrain')).toBeDefined()
    expect(find('vegetation')).toBeDefined()
    // the orbit camera moves between frames
    const cam = state!.camera
    const p0 = cam.position.clone()
    frames(30, 0.1)
    expect(cam.position.distanceTo(p0)).toBeGreaterThan(0.01)
    await view.unmount()
    act(() => useGame.setState({ sim }))
  }, 60000)
})

describe('round 4 fixes mounted for real', () => {
  it('props ghost, shadows stop and fog clears while an overlay is on', async () => {
    useGame.setState({ overlay: 'none', reducedMotion: false, quality: 'high', colorblind: false })
    const frame = frameFromSim(sim)
    // heavy rain pulls the fog in closest
    const rainy: WorldFrame = { ...frame, season: 'wet', weather: 'heavy-rain' }
    const view = await mount(<WorldRenderer frame={rainy} sourceKey="live" quality="high" />)
    frames(3)
    const veg = (find('vegetation') as Object3D).children[0] as InstancedMesh
    const mix = () => ((veg.material as Material).userData.amoriaUniforms as { uOverlayMix: { value: number } }).uOverlayMix.value
    const fog = () => state!.scene.fog as THREE.Fog
    frames(400, 0.05)
    const fogNear = fog().near
    expect(fogNear).toBeLessThan(40)
    expect(mix()).toBe(0)
    expect(veg.castShadow).toBe(true)
    await act(async () => useGame.getState().setOverlay('erosion'))
    frames(2)
    expect(mix()).toBeGreaterThan(0)
    expect(mix()).toBeLessThan(1)
    frames(90)
    expect(mix()).toBe(1)
    expect(veg.castShadow).toBe(false)
    expect(fog().near).toBeGreaterThan(105)
    // the buildings share the same per-view uniform
    const house = (find('buildings') as Object3D).children.find((c) => (c as InstancedMesh).count > 0) as InstancedMesh
    expect(((house.material as Material).userData.amoriaUniforms as { uOverlayMix: { value: number } }).uOverlayMix.value).toBe(1)
    await act(async () => useGame.getState().setOverlay('none'))
    frames(90)
    expect(mix()).toBe(0)
    expect(fog().near).toBeCloseTo(fogNear, 3)
    // a second view with its own overlay does not ghost this one
    const other = await mount(<WorldRenderer frame={frame} sourceKey="other" quality="low" overlay="soil" />)
    frames(90)
    const otherVeg = (find('vegetation') as Object3D).children[0] as InstancedMesh
    expect((otherVeg.material as Material).userData.amoriaUniforms.uOverlayMix.value).toBe(1)
    expect(mix()).toBe(0)
    await other.unmount()
    await view.unmount()
  }, 60000)

  it('water keeps draining cells for one build under StrictMode double rendering', async () => {
    useGame.setState({ reducedMotion: false })
    const dry: WorldFrame = { ...makeFrame(6, 6), fieldsReady: true }
    const flooded: WorldFrame = { ...dry, fields: { ...dry.fields, flooded: dry.fields.flooded.slice(), floodDepthM: dry.fields.floodDepthM.slice() } }
    flooded.fields.flooded[14] = 1
    flooded.fields.floodDepthM[14] = 1
    const h = terrainHeights(dry.terrain)
    const wet = buildWaterMesh(flooded, h, computeWaterCells(flooded, h), TERRAIN_SUB)
    const draining = buildWaterMesh(dry, h, computeWaterCells(dry, h), TERRAIN_SUB, blendWaterField(wet.field, 1))
    expect(wet.indices.length).toBeGreaterThan(0)
    expect(draining.indices.length).toBe(wet.indices.length)
    const tree = (f: WorldFrame) => (
      <StrictMode>
        <WaterSurface frame={f} sourceKey="live" />
      </StrictMode>
    )
    const view = await mount(tree(flooded))
    frames(2)
    const indexCount = () => ((find('water') as Mesh).geometry.getIndex()?.count ?? 0)
    expect(indexCount()).toBe(wet.indices.length)
    await view.rerender(tree(dry))
    frames(1)
    // the flood cell is still in the mesh, draining, even though React rendered twice
    expect(indexCount()).toBe(draining.indices.length)
    expect(((find('water') as Mesh).material as THREE.ShaderMaterial).uniforms.uBlend.value).toBeLessThan(1)
    frames(90)
    // the same inputs again: the mesh is kept, not rebuilt from a half-written state
    const geo = (find('water') as Mesh).geometry
    await view.rerender(tree(dry))
    frames(1)
    expect((find('water') as Mesh).geometry).toBe(geo)
    await view.unmount()
  }, 60000)

  it('runoff arrows keep their shared geometry and material when the map size changes', async () => {
    const a: WorldFrame = { ...makeFrame(8, 8), fieldsReady: true }
    const b: WorldFrame = { ...makeFrame(10, 10), fieldsReady: true }
    for (const f of [a, b]) f.fields.flowMm.forEach((_, i) => (f.fields.flowMm[i] = i * 10))
    const view = await mount(<RunoffArrows frame={a} visible quality="high" />)
    frames(1)
    const first = find('runoff-arrows') as InstancedMesh
    expect(first.count).toBeGreaterThan(0)
    const geoDispose = vi.spyOn(first.geometry, 'dispose')
    const matDispose = vi.spyOn(first.material as Material, 'dispose')
    const meshDispose = vi.spyOn(first, 'dispose')
    await view.rerender(<RunoffArrows frame={b} visible quality="high" />)
    frames(1)
    const second = find('runoff-arrows') as InstancedMesh
    expect(second).not.toBe(first)
    expect(meshDispose).toHaveBeenCalled()
    expect(geoDispose).not.toHaveBeenCalled()
    expect(matDispose).not.toHaveBeenCalled()
    expect(second.geometry).toBe(first.geometry)
    expect(second.count).toBeGreaterThan(0)
    await view.unmount()
    expect(geoDispose).toHaveBeenCalled()
    expect(matDispose).toHaveBeenCalled()
  }, 60000)

  it('the keyboard cursor announcement describes the snapshot on screen', async () => {
    const wrapper = document.createElement('div')
    wrapper.setAttribute(CANVAS_WRAPPER_ATTR, '')
    wrapper.tabIndex = 0
    const live = document.createElement('div')
    live.setAttribute(CANVAS_LIVE_ATTR, '')
    const canvas = document.createElement('canvas')
    wrapper.append(canvas, live)
    document.body.append(wrapper)
    const cell = sim.terrain.width * 20 + 20
    expect(sim.terrain.channel[cell]).toBe(0)
    const snap = makeSnapshot(sim, 1, 'wet')
    const past = { ...snap, layers: { ...snap.layers, cover: snap.layers.cover.slice(), structure: snap.layers.structure.slice() } }
    // every parcel around the cursor has a different cover in the past view than now
    const w = sim.terrain.width
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        const c = cell + dz * w + dx
        past.layers.cover[c] = sim.layers.cover[c] === coverCode('wetland') ? coverCode('forest') : coverCode('wetland')
        past.layers.structure[c] = 0
      }
    useGame.setState({ sim, screen: 'game', reportOpen: false, viewSnapshot: past, viewStep: 0, cursorCell: cell, selectedCell: null, quality: 'low', reducedMotion: true })
    const view = await mount(<GameScene />, canvas)
    frames(2)
    act(() => wrapper.focus())
    act(() => {
      wrapper.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight', bubbles: true, cancelable: true }))
    })
    const moved = useGame.getState().cursorCell!
    expect(moved).not.toBe(cell)
    expect(Math.abs((moved % w) - (cell % w)) + Math.abs(Math.floor(moved / w) - Math.floor(cell / w))).toBe(1)
    const shown = cursorAnnouncement(moved, sim.terrain, past.layers, 'inspect', true)
    const liveText = cursorAnnouncement(moved, sim.terrain, sim.layers, 'inspect', true)
    expect(shown).not.toBe(liveText)
    expect(live.textContent).toBe(shown)
    await view.unmount()
    wrapper.remove()
    act(() => useGame.setState({ viewSnapshot: null, viewStep: null, cursorCell: null }))
  }, 60000)
})

describe('fix round 5 in a real R3F scene', () => {
  /** aState of every vertex the preview tiles currently draw. */
  const tileStates = (): number[] => {
    const geo = (find('preview-tiles') as Mesh).geometry as BufferGeometry
    const ix = geo.getIndex()!
    let maxV = -1
    for (let k = 0; k < geo.drawRange.count; k++) maxV = Math.max(maxV, ix.getX(k))
    const st = geo.getAttribute('aState')
    return Array.from({ length: maxV + 1 }, (_, v) => st.getX(v))
  }

  it('preview tiles are never drawn valid when the whole action is refused (over budget)', async () => {
    useGame.setState({ sim, viewSnapshot: null, viewStep: null, quality: 'low', overlay: 'none', reducedMotion: true, focusCell: null, hoverCell: null, cursorCell: null, tool: 'cropland', preview: null })
    const view = await mount(<GameScene />)
    frames(1)
    const w = sim.terrain.width
    const cells = [w * 30 + 30, w * 30 + 31, w * 31 + 30]
    const reasons = ['Not enough budget']
    act(() => useGame.setState({ preview: { cells, validation: { ok: false, cost: 1e9, cellOk: [true, true, true], reasons } } }))
    frames(1)
    const refused = tileStates()
    expect(refused.length).toBeGreaterThan(0)
    expect(refused.every((v) => v <= 0.25)).toBe(true)
    // control: the same parcels with an affordable action draw valid
    act(() => useGame.setState({ preview: { cells, validation: { ok: true, cost: 10, cellOk: [true, true, true], reasons: [] } } }))
    frames(1)
    expect(tileStates().every((v) => v === 1)).toBe(true)
    await view.unmount()
    act(() => useGame.setState({ tool: 'inspect', preview: null }))
  }, 60000)

  it('camera drag inertia follows reduced motion, and flood and wetland water fade under overlays', async () => {
    useGame.setState({ sim, viewSnapshot: null, viewStep: null, quality: 'low', overlay: 'none', reducedMotion: true, focusCell: null, tool: 'inspect', preview: null })
    const view = await mount(<GameScene />)
    frames(1)
    const controls = state!.controls as unknown as { enableDamping: boolean }
    expect(controls).toBeTruthy()
    expect(controls.enableDamping).toBe(false)
    act(() => useGame.setState({ reducedMotion: false }))
    frames(1)
    expect(controls.enableDamping).toBe(true)
    act(() => useGame.setState({ reducedMotion: true }))
    frames(1)
    expect(controls.enableDamping).toBe(false)

    const water = (find('water') as Mesh).material as THREE.ShaderMaterial
    expect(water.uniforms.uOverlayMix.value).toBe(0)
    expect(water.fragmentShader).toContain('alpha *= 1.0 - 0.8 * uOverlayMix * max(isWet, isFlood);')
    act(() => useGame.getState().setOverlay('runoff'))
    frames(1)
    expect(water.uniforms.uOverlayMix.value).toBe(1)
    act(() => useGame.getState().setOverlay('none'))
    frames(1)
    expect(water.uniforms.uOverlayMix.value).toBe(0)
    await view.unmount()
  }, 60000)
})
