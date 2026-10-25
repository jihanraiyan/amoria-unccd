// Procedural fallback world: the fictional "Amoria Valley" educational scenario.
// A semi-arid river valley draining south. Steep forested headwaters to the north and
// an east ridge, a tributary stream joining above the village, a small farming village
// on the east terrace (its lowest houses sit on the floodplain), hillside farms, open
// grassland plateaus to the west that are good for development, and a floodplain
// wetland near the southern outlet. Deterministic for a given seed.
import { mulberry32 } from '../rng'
import { coverCode, structureCode, type LandCover, type WorldInput } from '../types'

export const PROCEDURAL_SIZE = 64
const SIZE = PROCEDURAL_SIZE
const CELL_M = 100

function valueNoise(seed: number, size: number, scale: number): Float32Array {
  const rnd = mulberry32(seed)
  const g = Math.ceil(size / scale) + 2
  const lattice = Array.from({ length: g * g }, () => rnd())
  const out = new Float32Array(size * size)
  const smooth = (t: number) => t * t * (3 - 2 * t)
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const fx = x / scale
      const fz = z / scale
      const x0 = Math.floor(fx)
      const z0 = Math.floor(fz)
      const tx = smooth(fx - x0)
      const tz = smooth(fz - z0)
      const v = (i: number, j: number) => lattice[(j % g) * g + (i % g)]
      const a = v(x0, z0) * (1 - tx) + v(x0 + 1, z0) * tx
      const b = v(x0, z0 + 1) * (1 - tx) + v(x0 + 1, z0 + 1) * tx
      out[z * size + x] = a * (1 - tz) + b * tz
    }
  }
  return out
}

/** River centreline x-position for a row z (meanders down the valley). */
export function riverX(z: number, size = SIZE): number {
  return size * 0.47 + Math.sin(z * 0.11) * 5 + Math.sin(z * 0.043 + 1.3) * 4
}

/** Main channel bed elevation for row z: falls about 45 m over the valley (about 0.7%), gentler
 *  than the floodplain cross-slope so floodplain cells drain to the river, not along it. */
function channelBed(z: number): number {
  return 1150 + 45 * (1 - z / (SIZE - 1))
}

/** Tributary polyline from the north-east headwaters to its junction with the main river. */
const TRIB_JUNCTION_Z = 27
function tributaryPath(): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = []
  const x0 = 57
  const z0 = 5
  const x1 = Math.round(riverX(TRIB_JUNCTION_Z)) + 1
  const z1 = TRIB_JUNCTION_Z
  const steps = 60
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    const x = x0 + (x1 - x0) * t + Math.sin(t * Math.PI * 2) * 2.2
    const z = z0 + (z1 - z0) * Math.pow(t, 0.9)
    pts.push({ x, z })
  }
  return pts
}

export function generateProceduralWorld(seed = 1): WorldInput {
  const n = SIZE * SIZE
  const n1 = valueNoise(seed * 7 + 1, SIZE, 16)
  const n2 = valueNoise(seed * 7 + 2, SIZE, 7)
  const n3 = valueNoise(seed * 7 + 3, SIZE, 3)
  const elevationM = new Float32Array(n)
  const cover = new Uint8Array(n)
  const structure = new Uint8Array(n)
  const structureLevel = new Uint8Array(n)
  const channel = new Uint8Array(n)
  const prot = new Uint8Array(n)
  const irrigated = new Uint8Array(n)
  const intensity = new Uint8Array(n).fill(1)

  // 1. Main valley: channel, floodplain, terraces and valley sides.
  for (let z = 0; z < SIZE; z++) {
    const rx = riverX(z)
    const ch = channelBed(z)
    const northness = Math.max(0, 1 - z / 28)
    for (let x = 0; x < SIZE; x++) {
      const i = z * SIZE + x
      const d = Math.abs(x - rx)
      const east = x > rx
      let e: number
      if (d < 1.1) {
        e = ch
        channel[i] = 1
      } else if (d <= 6) {
        // floodplain: 0.6 to about 4.5 m above the bed, gently tilted toward the river
        e = ch + 0.6 + 0.8 * (d - 1.1) + (n3[i] - 0.5) * 0.4
      } else {
        const t = d - 6
        let sideMult = 1 + 1.8 * northness
        if (!east && z > 30) sideMult *= 0.62 // gentle western plateau: developable flats
        e = ch + 4.5 + 1.6 * Math.pow(t, 1.45) * sideMult
        e += ((n1[i] - 0.5) * 22 + (n2[i] - 0.5) * 7) * Math.min(1, t / 8)
      }
      // east ridge, strongest in the north-east
      if (x > 44) e += Math.pow(x - 44, 1.5) * 1.7 * Math.sqrt(Math.max(0, 1 - z / SIZE))
      elevationM[i] = e
    }
  }

  // 2. Carve the tributary into the east slopes. The bed follows the natural surface a few
  //    metres down and is forced to fall monotonically to the junction with the river.
  const trib = tributaryPath()
  const junctionBed = channelBed(TRIB_JUNCTION_Z) + 0.4
  const bedAt = new Float64Array(trib.length)
  for (let s = 0; s < trib.length; s++) {
    const px = Math.min(SIZE - 1, Math.max(0, Math.round(trib[s].x)))
    const pz = Math.min(SIZE - 1, Math.max(0, Math.round(trib[s].z)))
    const natural = elevationM[pz * SIZE + px] - 5
    bedAt[s] = s === 0 ? natural : Math.min(bedAt[s - 1] - 0.4, natural)
  }
  for (let s = 0; s < trib.length; s++) bedAt[s] = Math.max(bedAt[s], junctionBed + 0.2 * (trib.length - 1 - s))
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      const i = z * SIZE + x
      if (channel[i]) continue
      let best = Infinity
      let bestS = 0
      for (let s = 0; s < trib.length; s++) {
        const dd = Math.hypot(x - trib[s].x, z - trib[s].z)
        if (dd < best) {
          best = dd
          bestS = s
        }
      }
      if (best > 9) continue
      const onStream = best < 0.72
      const carved = bedAt[bestS] + (onStream ? 0 : 0.9 + 2.6 * Math.pow(best, 1.35))
      if (onStream || carved < elevationM[i]) {
        elevationM[i] = Math.min(elevationM[i], carved)
        if (onStream) channel[i] = 1
      }
    }
  }

  // 3. Local slope (central differences) for cover assignment.
  const slopeAt = (x: number, z: number) => {
    const xl = Math.max(0, x - 1)
    const xr = Math.min(SIZE - 1, x + 1)
    const zu = Math.max(0, z - 1)
    const zd = Math.min(SIZE - 1, z + 1)
    const dzdx = (elevationM[z * SIZE + xr] - elevationM[z * SIZE + xl]) / ((xr - xl) * CELL_M)
    const dzdz = (elevationM[zd * SIZE + x] - elevationM[zu * SIZE + x]) / ((zd - zu) * CELL_M)
    return Math.hypot(dzdx, dzdz)
  }

  const villageZ = 33
  const villageX = Math.round(riverX(villageZ)) + 7
  const set = (i: number, c: LandCover) => (cover[i] = coverCode(c))

  for (let z = 0; z < SIZE; z++) {
    const rx = riverX(z)
    for (let x = 0; x < SIZE; x++) {
      const i = z * SIZE + x
      if (x === 0 || z === 0 || x === SIZE - 1 || z === SIZE - 1) prot[i] = 1
      if (channel[i]) {
        set(i, 'water')
        continue
      }
      const s = slopeAt(x, z)
      const d = Math.abs(x - rx)
      const dv = Math.hypot(x - villageX, z - villageZ)
      let c: LandCover
      if (z >= 50 && d <= 5.5 && n2[i] > 0.22) c = 'wetland'
      else if (dv < 3.6) c = 'urban'
      else if (z < 17 && n2[i] > 0.18) c = 'forest'
      else if (s > 0.13 && n2[i] > 0.3) c = 'forest'
      else if (dv < 11 && s < 0.1 && n3[i] > 0.22) c = 'cropland'
      else if (dv < 15 && x > rx && s >= 0.1 && s < 0.22 && n3[i] > 0.4) c = 'cropland' // hillside farms
      else if (n1[i] > 0.66) c = 'forest'
      else if (s > 0.06 && n3[i] < 0.16) c = 'bare' // overgrazed patches
      else c = 'grassland'
      set(i, c)
    }
  }

  // Community forest reserve in the north-west headwaters (protected, cannot be developed).
  for (let z = 3; z <= 10; z++) {
    for (let x = 12; x <= 19; x++) {
      const i = z * SIZE + x
      if (channel[i]) continue
      if (Math.hypot(x - 15.5, z - 6.5) < 4.2) {
        set(i, 'forest')
        prot[i] = 1
      }
    }
  }

  // Village houses: denser core, lower houses on the floodplain edge.
  for (let i = 0; i < n; i++) {
    if (cover[i] !== coverCode('urban')) continue
    const x = i % SIZE
    const z = Math.floor(i / SIZE)
    structure[i] = structureCode('housing')
    structureLevel[i] = Math.hypot(x - villageX, z - villageZ) < 1.6 ? 2 : 1
  }

  // Access road: along the east terrace from the village to the southern map edge (the
  // regional road), plus a spur north to the tributary farms.
  const placeRoad = (x: number, z: number) => {
    const i = z * SIZE + x
    if (x < 0 || x >= SIZE || channel[i]) return
    structure[i] = structureCode('road')
    structureLevel[i] = 0
    set(i, 'urban')
  }
  for (let z = 22; z < SIZE; z++) placeRoad(Math.round(riverX(z)) + 7, z)
  for (let x = Math.round(riverX(villageZ)) + 7; x <= villageX + 4; x++) placeRoad(x, villageZ + 4)

  // Village water intake (waterworks) beside the river.
  const wwZ = villageZ - 1
  const wwX = Math.round(riverX(wwZ) + 1.6)
  const wwI = wwZ * SIZE + wwX
  if (!channel[wwI]) {
    structure[wwI] = structureCode('waterworks')
    set(wwI, 'urban')
  }

  // A few irrigated plots on the floodplain near the intake (historic river gardens).
  for (let i = 0; i < n; i++) {
    if (cover[i] !== coverCode('cropland')) continue
    const x = i % SIZE
    const z = Math.floor(i / SIZE)
    if (Math.abs(x - riverX(z)) < 2.8 && Math.abs(z - villageZ) < 3) irrigated[i] = 1
  }

  return {
    meta: {
      id: 'amoria-valley',
      name: 'Amoria Valley',
      kind: 'procedural',
      description:
        'A fictional semi-arid river valley built for learning. Steep forested headwaters and a tributary drain south past a small farming village to a floodplain wetland.',
      provenance: 'Procedurally generated fictional landscape. Not based on any real place or measured data.',
    },
    width: SIZE,
    height: SIZE,
    cellSizeM: CELL_M,
    elevationM,
    cover,
    structure,
    structureLevel,
    channel,
    protected: prot,
    irrigated,
    intensity,
  }
}
