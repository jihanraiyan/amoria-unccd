// All instanced props: vegetation (Kenney Nature Kit + procedural reeds), ground marks (crop
// rows, terraces, irrigation ditches, erosion gullies), roads, buildings and infrastructure.
// Each layer recomputes its targets only when the layers/fields it depends on change.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type { BufferGeometry, Material } from 'three'
import { terrainHeights } from '../core/coords'
import type { WorldFrame } from '../core/frame'
import {
  BUILD_KIND,
  BUILD_KIND_COUNT,
  VEG_KIND,
  VEG_KIND_COUNT,
  computeBuildings,
  computeGroundMarks,
  computeRoads,
  computeVegetation,
  type SlotTargets,
} from '../core/placement'
import { useStoreRef } from '../scene/storeHooks'
import {
  blockGeometry,
  cropRowGeometry,
  embankmentGeometry,
  house1Geometry,
  house2Geometry,
  plazaGeometry,
  roadGeometry,
  stallGeometry,
  stripGeometry,
  tankGeometry,
  worksHallGeometry,
} from './geometries'
import { currentVegetationGeometries, loadVegetationModels, onVegetationModelsLoaded } from './kenneyModels'
import { createPropMaterials } from './materials'
import { easeOverlayMix } from '../core/overlayFade'
import { SlotAnimator, type KindSpec } from './SlotAnimator'

interface PropLayerProps {
  name: string
  targets: SlotTargets
  kinds: KindSpec[]
  material: Material
  sourceKey: string
  shadows: boolean
  geometries?: BufferGeometry[]
}

function PropLayer({ name, targets, kinds, material, sourceKey, shadows, geometries }: PropLayerProps) {
  const animator = useMemo(() => new SlotAnimator(kinds, material, name), [kinds, material, name])
  useEffect(() => () => animator.dispose(), [animator])
  const lastKey = useRef<string | null>(null)
  const reduced = useStoreRef((s) => s.reducedMotion)
  useEffect(() => {
    const instant = lastKey.current !== sourceKey || reduced.current
    lastKey.current = sourceKey
    animator.setTargets(targets, instant)
  }, [animator, targets, sourceKey, reduced])
  useEffect(() => animator.setShadows(shadows), [animator, shadows])
  useEffect(() => {
    if (geometries) animator.setGeometries(geometries)
  }, [animator, geometries])
  useFrame((_, dt) => animator.tick(dt, reduced.current))
  return <primitive object={animator.group} />
}

// Shared kind specs (geometry is shared by every view)
let buildingKinds: KindSpec[] | null = null
function getBuildingKinds(): KindSpec[] {
  if (buildingKinds) return buildingKinds
  const g: BufferGeometry[] = []
  g[BUILD_KIND.house1] = house1Geometry()
  g[BUILD_KIND.house2] = house2Geometry()
  g[BUILD_KIND.block] = blockGeometry()
  g[BUILD_KIND.worksHall] = worksHallGeometry()
  g[BUILD_KIND.tank] = tankGeometry()
  g[BUILD_KIND.stall] = stallGeometry()
  g[BUILD_KIND.plaza] = plazaGeometry()
  g[BUILD_KIND.embankment] = embankmentGeometry()
  buildingKinds = Array.from({ length: BUILD_KIND_COUNT }, (_, k) => ({
    geometry: g[k],
    grow: 'y' as const,
    castShadow: k !== BUILD_KIND.plaza,
    receiveShadow: true,
  }))
  return buildingKinds
}

let markKinds: KindSpec[] | null = null
function getMarkKinds(): KindSpec[] {
  markKinds ??= [
    { geometry: cropRowGeometry(), grow: 'y', castShadow: false, receiveShadow: true },
    { geometry: stripGeometry(), grow: 'y', castShadow: false, receiveShadow: true },
  ]
  return markKinds
}

let roadKinds: KindSpec[] | null = null
function getRoadKinds(): KindSpec[] {
  roadKinds ??= [{ geometry: roadGeometry(), grow: 'uniform', castShadow: false, receiveShadow: true }]
  return roadKinds
}

const SMALL_VEG = new Set<number>([VEG_KIND.lily, VEG_KIND.rock, VEG_KIND.stump, VEG_KIND.reed])
function vegKinds(geoms: BufferGeometry[]): KindSpec[] {
  return Array.from({ length: VEG_KIND_COUNT }, (_, k) => ({ geometry: geoms[k], grow: 'uniform' as const, castShadow: !SMALL_VEG.has(k), receiveShadow: false }))
}

/** Kenney models load once; until then procedural trees stand in. */
function useVegetationGeometries(): BufferGeometry[] {
  const [geoms, setGeoms] = useState(currentVegetationGeometries)
  useEffect(() => {
    const off = onVegetationModelsLoaded(setGeoms)
    void loadVegetationModels().then(setGeoms)
    return off
  }, [])
  return geoms
}

export interface PropLayersProps {
  frame: WorldFrame
  sourceKey: string
  quality: 'high' | 'low'
  /** Colorblind-friendly stress tints (store.colorblind). */
  colorblind?: boolean
  /** An overlay is shown in this view: props shrink and fade so the map stays readable. */
  overlayActive?: boolean
}

export function PropLayers({ frame, sourceKey, quality, colorblind = false, overlayActive = false }: PropLayersProps) {
  const heights = terrainHeights(frame.terrain)
  const { layers, fields, fieldsReady, season, weather } = frame
  // ghosted props would still cast full-height shadows across the overlay
  const shadows = quality === 'high' && !overlayActive
  // per view, so a compare view's overlay does not ghost the props of another view
  const materials = useMemo(() => createPropMaterials(), [])
  useEffect(() => () => materials.dispose(), [materials])
  const reduced = useStoreRef((s) => s.reducedMotion)
  const overlayTarget = overlayActive ? 1 : 0
  useFrame((_, dt) => {
    const u = materials.overlayMix
    if (u.value !== overlayTarget) u.value = easeOverlayMix(u.value, overlayTarget, dt, reduced.current)
  })
  const vegGeoms = useVegetationGeometries()
  const [vegKindSpecs] = useState(() => vegKinds(currentVegetationGeometries()))

  /* eslint-disable react-hooks/exhaustive-deps -- targets depend on specific layers, not the frame object */
  const vegTargets = useMemo(
    () => computeVegetation(frame, heights, { forestSlots: quality === 'low' ? 2 : 4, colorblind }),
    [heights, layers.cover, layers.vegetation, layers.coverAge, layers.structure, layers.soilHealth, layers.baselineCover, fields.waterFactor, fieldsReady, season, weather, quality, colorblind],
  )
  const markTargets = useMemo(
    () => computeGroundMarks(frame, heights, { colorblind }),
    [heights, layers.cover, layers.intensity, layers.conservation, layers.irrigated, layers.soilHealth, fields.waterFactor, fields.yieldT, fields.erosion, fields.sedimentIn, fieldsReady, season, weather, colorblind],
  )
  const roadTargets = useMemo(() => computeRoads(frame, heights), [heights, layers.structure])
  const buildTargets = useMemo(() => computeBuildings(frame, heights), [heights, layers.structure, layers.structureLevel])
  /* eslint-enable react-hooks/exhaustive-deps */

  return (
    <group name="props">
      <PropLayer name="vegetation" targets={vegTargets} kinds={vegKindSpecs} geometries={vegGeoms} material={materials.vegetation} sourceKey={sourceKey} shadows={shadows} />
      <PropLayer name="marks" targets={markTargets} kinds={getMarkKinds()} material={materials.ground} sourceKey={sourceKey} shadows={false} />
      <PropLayer name="roads" targets={roadTargets} kinds={getRoadKinds()} material={materials.road} sourceKey={sourceKey} shadows={false} />
      <PropLayer name="buildings" targets={buildTargets} kinds={getBuildingKinds()} material={materials.solid} sourceKey={sourceKey} shadows={shadows} />
    </group>
  )
}
