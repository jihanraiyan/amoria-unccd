// Cinematic landing view: the live world, or when no game is loaded the world the Start button
// will load (the default world, normally the real-data catchment), with a camera slowly
// orbiting the valley. Still when reduced motion is on.
// Building a starting state takes 100 to 200 ms (the engine spins the hydrology up), so it runs
// in an idle callback after the first paint; until it is ready the canvas shows the sky only.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGame } from '../../state/store'
import { createInitialState } from '../../simulation/engine'
import type { SimulationState, WorldInput } from '../../simulation/types'
import { DEFAULT_WORLD_ID, FALLBACK_WORLD_ID, getWorldListing } from '../../data/registry'
import { heightAt, terrainHeights, type GridDims } from '../core/coords'
import { frameFromSim } from '../core/frame'
import { Atmosphere } from '../effects/Atmosphere'
import { useStoreRef } from './storeHooks'
import { SceneCanvas } from './SceneCanvas'
import { WorldRenderer } from './WorldRenderer'

export interface LandingSceneProps {
  className?: string
  /** World to show when no game is loaded. Defaults to loading `worldId`. */
  world?: WorldInput | null
  /** Registry id of the world to show when no game is loaded (default: the default world). */
  worldId?: string
  /** Seed for the starting state shown when no game is loaded. */
  seed?: number
}

function OrbitCamera({ dims, heights }: { dims: GridDims; heights: Float32Array }) {
  const { camera } = useThree()
  const reduced = useStoreRef((s) => s.reducedMotion)
  const angle = useRef(Math.PI * 0.2)
  useFrame((_, dt) => {
    if (!reduced.current) angle.current += Math.min(0.1, dt) * 0.035
    const size = Math.max(dims.width, dims.height)
    const r = size * 0.78
    const a = angle.current
    const ty = heightAt(heights, dims, 0, 0)
    camera.position.set(Math.sin(a) * r, ty + size * 0.42 + Math.sin(a * 2) * 2, Math.cos(a) * r)
    camera.lookAt(0, ty - 2, 0)
  })
  return null
}

const stateCache = new WeakMap<WorldInput, Map<number, SimulationState>>()
const worldCache = new Map<string, Promise<WorldInput>>()

function cachedState(world: WorldInput, seed: number): SimulationState | null {
  return stateCache.get(world)?.get(seed) ?? null
}

function buildState(world: WorldInput, seed: number): SimulationState {
  let bySeed = stateCache.get(world)
  if (!bySeed) {
    bySeed = new Map()
    stateCache.set(world, bySeed)
  }
  let s = bySeed.get(seed)
  if (!s) {
    s = createInitialState(world, seed)
    bySeed.set(seed, s)
  }
  return s
}

/** Loads a registry world once; falls back to the procedural valley if it cannot be loaded. */
function loadWorld(id: string): Promise<WorldInput> {
  let p = worldCache.get(id)
  if (!p) {
    const listing = getWorldListing(id) ?? getWorldListing(FALLBACK_WORLD_ID)
    const fallback = () => getWorldListing(FALLBACK_WORLD_ID)!.load()
    p = (listing ? listing.load() : fallback()).catch(() => fallback())
    // a failed load is retried on the next mount
    p.catch(() => worldCache.delete(id))
    worldCache.set(id, p)
  }
  return p
}

type IdleHandle = { cancel: () => void }
function whenIdle(fn: () => void): IdleHandle {
  const w = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void }
  if (typeof w.requestIdleCallback === 'function') {
    const h = w.requestIdleCallback(fn, { timeout: 800 })
    return { cancel: () => w.cancelIdleCallback?.(h) }
  }
  const h = setTimeout(fn, 60)
  return { cancel: () => clearTimeout(h) }
}

/** The starting state to show, built off the critical path. Null until it is ready. */
function useLandingState(world: WorldInput | null | undefined, worldId: string, seed: number, enabled: boolean): SimulationState | null {
  const [built, setBuilt] = useState<{ world: WorldInput; seed: number; state: SimulationState } | null>(null)
  const [loaded, setLoaded] = useState<{ id: string; world: WorldInput } | null>(null)
  const source = world ?? (loaded && loaded.id === worldId ? loaded.world : null)

  useEffect(() => {
    if (!enabled || world) return
    let alive = true
    loadWorld(worldId).then(
      (w) => {
        if (alive) setLoaded({ id: worldId, world: w })
      },
      () => {
        /* nothing to show: the landing keeps its sky */
      },
    )
    return () => {
      alive = false
    }
  }, [enabled, world, worldId])

  useEffect(() => {
    if (!enabled || !source || cachedState(source, seed)) return
    const h = whenIdle(() => setBuilt({ world: source, seed, state: buildState(source, seed) }))
    return () => h.cancel()
  }, [enabled, source, seed])

  if (!enabled || !source) return null
  const cached = cachedState(source, seed)
  if (cached) return cached
  return built && built.world === source && built.seed === seed ? built.state : null
}

export function LandingScene({ className, world, worldId = DEFAULT_WORLD_ID, seed = 1 }: LandingSceneProps) {
  const live = useGame((s) => s.sim)
  const quality = useGame((s) => s.quality)
  const start = useLandingState(world, worldId, seed, !live)
  const sim = live ?? start
  const frame = useMemo(() => (sim ? frameFromSim(sim) : null), [sim])
  return (
    <SceneCanvas quality={quality} className={className} label={sim ? `A slowly turning view of ${sim.meta.name}` : 'The landscape is loading'}>
      {frame ? (
        <>
          <WorldRenderer frame={frame} sourceKey={live ? 'live' : 'landing'} quality={quality} overlay="none" />
          <OrbitCamera dims={frame.terrain} heights={terrainHeights(frame.terrain)} />
        </>
      ) : (
        <Atmosphere season="wet" weather="normal" quality={quality} extent={32} sourceKey="landing-sky" />
      )}
    </SceneCanvas>
  )
}
