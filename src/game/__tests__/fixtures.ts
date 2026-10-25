// Small synthetic worlds for renderer unit tests (independent of the simulation engine).
import type { StepFields, Terrain, WorldLayers } from '../../simulation/types'
import { coverCode } from '../../simulation/types'
import type { WorldFrame } from '../core/frame'

export function makeTerrain(width: number, height: number, elev: (x: number, z: number) => number = () => 1000): Terrain {
  const n = width * height
  const elevationM = new Float32Array(n)
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) elevationM[z * width + x] = elev(x, z)
  const flowTo = new Int32Array(n).fill(-1)
  for (let z = 0; z < height - 1; z++) for (let x = 0; x < width; x++) flowTo[z * width + x] = (z + 1) * width + x
  return {
    width,
    height,
    cellSizeM: 100,
    elevationM,
    slope: new Float32Array(n).fill(0.05),
    flowTo,
    flowOrder: Int32Array.from({ length: n }, (_, i) => i),
    flowAccumulation: new Float32Array(n).fill(1),
    channel: new Uint8Array(n),
    protected: new Uint8Array(n),
    filledElevationM: Float64Array.from(elevationM),
    nearestChannel: new Int32Array(n).fill(-1),
    channelDistance: new Float32Array(n).fill(10),
    heightAboveChannelM: new Float32Array(n).fill(10),
    bankfullMm: new Float32Array(n),
  }
}

export function makeLayers(n: number, cover = 'grassland' as Parameters<typeof coverCode>[0]): WorldLayers {
  return {
    baselineCover: new Uint8Array(n).fill(coverCode(cover)),
    cover: new Uint8Array(n).fill(coverCode(cover)),
    structure: new Uint8Array(n),
    structureLevel: new Uint8Array(n),
    intensity: new Uint8Array(n).fill(1),
    conservation: new Uint8Array(n),
    irrigated: new Uint8Array(n),
    coverAge: new Uint16Array(n).fill(40),
    soilHealth: new Float32Array(n).fill(0.7),
    soilMoistureMm: new Float32Array(n).fill(60),
    vegetation: new Float32Array(n).fill(0.6),
    groundwaterMm: new Float32Array(n).fill(50),
    wetlandStoreMm: new Float32Array(n),
  }
}

export function makeFields(n: number): StepFields {
  const f = () => new Float32Array(n)
  return {
    infiltrationMm: f(),
    runoffMm: f(),
    flowMm: f(),
    erosion: f(),
    sedimentIn: f(),
    yieldT: f(),
    waterFactor: f(),
    etMm: f(),
    irrigationMm: f(),
    sedimentFlux: f(),
    flooded: new Uint8Array(n),
    floodDepthM: f(),
  }
}

export function makeFrame(width = 8, height = 8, patch: Partial<WorldFrame> = {}): WorldFrame {
  const terrain = patch.terrain ?? makeTerrain(width, height, (x, z) => 1000 + x * 3 + z * 5)
  const n = terrain.width * terrain.height
  return {
    terrain,
    layers: makeLayers(n),
    fields: makeFields(n),
    fieldsReady: false,
    season: 'wet',
    weather: 'normal',
    stormIntensity: 1,
    reservoirFill: null,
    ...patch,
  }
}

export function withLayers(frame: WorldFrame, edit: (l: WorldLayers) => void): WorldFrame {
  const l = frame.layers
  const copy: WorldLayers = {
    baselineCover: l.baselineCover.slice(),
    cover: l.cover.slice(),
    structure: l.structure.slice(),
    structureLevel: l.structureLevel.slice(),
    intensity: l.intensity.slice(),
    conservation: l.conservation.slice(),
    irrigated: l.irrigated.slice(),
    coverAge: l.coverAge.slice(),
    soilHealth: l.soilHealth.slice(),
    soilMoistureMm: l.soilMoistureMm.slice(),
    vegetation: l.vegetation.slice(),
    groundwaterMm: l.groundwaterMm.slice(),
    wetlandStoreMm: l.wetlandStoreMm.slice(),
  }
  edit(copy)
  return { ...frame, layers: copy }
}
