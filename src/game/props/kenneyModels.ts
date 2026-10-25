// Loads the CC0 Kenney Nature Kit models (public/assets/kenney-nature-kit, see LICENSES.md) and
// converts each into one merged, flat-shaded geometry in Amoria's palette. Kenney material
// names tell us which faces are foliage (tinted per instance) and which are bark or stone.
// Until the models arrive (or if loading fails) procedural fallbacks are used, so the world
// always renders.
import { BufferAttribute, BufferGeometry, Mesh, type Material, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { VEG_KIND, VEG_KIND_COUNT } from '../core/placement'
import { PALETTE, type RGB } from '../core/palette'
import { fallbackBroadleaf, fallbackBush, fallbackConifer, fallbackLily, fallbackRock, fallbackStump, reedGeometry } from './geometries'

const MODEL_FILE: Partial<Record<number, string>> = {
  [VEG_KIND.conifer]: 'tree_cone',
  [VEG_KIND.pineTall]: 'tree_pineTallA',
  [VEG_KIND.pineRound]: 'tree_pineRoundA',
  [VEG_KIND.broadleaf]: 'tree_default',
  [VEG_KIND.oak]: 'tree_oak',
  [VEG_KIND.poplar]: 'tree_tall',
  [VEG_KIND.fruit]: 'tree_fat',
  [VEG_KIND.bush]: 'plant_bush',
  [VEG_KIND.shrub]: 'plant_bushSmall',
  [VEG_KIND.stump]: 'stump_old',
  [VEG_KIND.rock]: 'rock_smallC',
  [VEG_KIND.lily]: 'lily_small',
}

interface Role {
  color: RGB
  tint: 0 | 1
}

const MOSS: RGB = [0.22, 0.28, 0.12]

/** Maps a Kenney material name to Amoria's color role. */
export function roleForMaterial(name: string, kind: number): Role {
  const n = name.toLowerCase()
  if (kind === VEG_KIND.rock) return n.includes('grass') ? { color: MOSS, tint: 0 } : { color: PALETTE.stone, tint: 0 }
  if (n.includes('leafsdark')) return { color: [0.8, 0.8, 0.8], tint: 1 }
  if (n.includes('leaf') || n.includes('grass')) return { color: [1, 1, 1], tint: 1 }
  if (n.includes('barkdark')) return { color: PALETTE.barkDark, tint: 0 }
  if (n.includes('inner')) return { color: PALETTE.stumpInner, tint: 0 }
  if (n.includes('bark') || n.includes('wood')) return { color: PALETTE.bark, tint: 0 }
  if (n.includes('dirt') || n.includes('stone') || n.includes('rock')) return { color: PALETTE.stone, tint: 0 }
  return { color: [1, 1, 1], tint: 1 }
}

/** Merge a loaded glTF scene into one geometry with color + aTint attributes. */
export function convertScene(root: Object3D, kind: number): BufferGeometry | null {
  root.updateMatrixWorld(true)
  const parts: BufferGeometry[] = []
  root.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    const mats: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
    src.applyMatrix4(mesh.matrixWorld)
    const groups = src.groups.length ? src.groups : [{ start: 0, count: src.getAttribute('position').count, materialIndex: 0 }]
    for (const grp of groups) {
      const mat = mats[grp.materialIndex ?? 0] ?? mats[0]
      const role = roleForMaterial(mat?.name ?? '', kind)
      const pos = src.getAttribute('position')
      const nor = src.getAttribute('normal')
      const count = grp.count
      const p = new Float32Array(count * 3)
      const nn = new Float32Array(count * 3)
      const c = new Float32Array(count * 3)
      const t = new Float32Array(count)
      for (let v = 0; v < count; v++) {
        const s = grp.start + v
        p[v * 3] = pos.getX(s)
        p[v * 3 + 1] = pos.getY(s)
        p[v * 3 + 2] = pos.getZ(s)
        if (nor) {
          nn[v * 3] = nor.getX(s)
          nn[v * 3 + 1] = nor.getY(s)
          nn[v * 3 + 2] = nor.getZ(s)
        }
        c[v * 3] = role.color[0]
        c[v * 3 + 1] = role.color[1]
        c[v * 3 + 2] = role.color[2]
        t[v] = role.tint
      }
      const g = new BufferGeometry()
      g.setAttribute('position', new BufferAttribute(p, 3))
      g.setAttribute('normal', new BufferAttribute(nn, 3))
      g.setAttribute('color', new BufferAttribute(c, 3))
      g.setAttribute('aTint', new BufferAttribute(t, 1))
      if (!nor) g.computeVertexNormals()
      parts.push(g)
    }
    src.dispose()
  })
  if (!parts.length) return null
  const merged = mergeGeometries(parts, false)
  for (const p of parts) p.dispose()
  if (!merged) return null
  // Kenney models sit 0.05 below their origin; lift so the base meets the ground
  merged.translate(0, 0.05, 0)
  merged.computeBoundingSphere()
  return merged
}

function fallbackFor(kind: number): BufferGeometry {
  switch (kind) {
    case VEG_KIND.conifer:
    case VEG_KIND.pineTall:
    case VEG_KIND.pineRound:
      return fallbackConifer()
    case VEG_KIND.bush:
    case VEG_KIND.shrub:
      return fallbackBush()
    case VEG_KIND.stump:
      return fallbackStump()
    case VEG_KIND.rock:
      return fallbackRock()
    case VEG_KIND.lily:
      return fallbackLily()
    case VEG_KIND.reed:
      return reedGeometry()
    default:
      return fallbackBroadleaf()
  }
}

let fallbackSet: BufferGeometry[] | null = null
let loadedSet: BufferGeometry[] | null = null
let loading: Promise<BufferGeometry[]> | null = null
const listeners = new Set<(g: BufferGeometry[]) => void>()

/** Procedural geometry per vegetation kind (always available). */
export function fallbackVegetationGeometries(): BufferGeometry[] {
  fallbackSet ??= Array.from({ length: VEG_KIND_COUNT }, (_, k) => fallbackFor(k))
  return fallbackSet
}

/** Best currently available geometry per vegetation kind. */
export function currentVegetationGeometries(): BufferGeometry[] {
  return loadedSet ?? fallbackVegetationGeometries()
}

function assetUrl(file: string): string {
  const base = typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL ? import.meta.env.BASE_URL : '/'
  return `${base.replace(/\/?$/, '/')}assets/kenney-nature-kit/${file}.glb`
}

/** Start loading the Kenney models once; resolves to the full geometry set (with fallbacks for failures). */
export function loadVegetationModels(): Promise<BufferGeometry[]> {
  if (loadedSet) return Promise.resolve(loadedSet)
  if (loading) return loading
  if (typeof window === 'undefined') return Promise.resolve(fallbackVegetationGeometries())
  const loader = new GLTFLoader()
  const fallback = fallbackVegetationGeometries()
  loading = Promise.all(
    Array.from({ length: VEG_KIND_COUNT }, async (_, kind) => {
      const file = MODEL_FILE[kind]
      if (!file) return fallback[kind]
      try {
        const gltf = await loader.loadAsync(assetUrl(file))
        return convertScene(gltf.scene, kind) ?? fallback[kind]
      } catch (err) {
        console.warn(`[amoria] could not load ${file}.glb, using procedural fallback`, err)
        return fallback[kind]
      }
    }),
  ).then((set) => {
    loadedSet = set
    for (const l of listeners) l(set)
    return set
  })
  return loading
}

/** Subscribe to the moment the Kenney models finish loading. */
export function onVegetationModelsLoaded(cb: (g: BufferGeometry[]) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
