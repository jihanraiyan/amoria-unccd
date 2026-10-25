// Flat land-cover map drawn from a snapshot. Used when the 3D SnapshotView is not available
// (for example without WebGL). It only paints categories already in the snapshot.
import { useEffect, useRef } from 'react'
import type { Snapshot, Terrain } from '../../simulation/types'

// Okabe-Ito palette in LAND_COVERS order (forest, grassland, cropland, agroforestry, urban, wetland, water, bare)
export const COVER_COLORS = ['#009E73', '#F0E442', '#E69F00', '#56B4E9', '#7a7a7a', '#CC79A7', '#0072B2', '#D55E00']
const STRUCTURE_COLOR = '#f7eedc'

export function MiniMap({ snapshot, terrain, label }: { snapshot: Snapshot; terrain: Terrain; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    const ctx = c?.getContext?.('2d')
    if (!c || !ctx) return
    const { width, height } = terrain
    const img = ctx.createImageData(width, height)
    let lo = Infinity
    let hi = -Infinity
    for (const e of terrain.elevationM) {
      lo = Math.min(lo, e)
      hi = Math.max(hi, e)
    }
    const span = Math.max(1e-6, hi - lo)
    for (let i = 0; i < width * height; i++) {
      const hex = snapshot.layers.structure[i] > 0 ? STRUCTURE_COLOR : (COVER_COLORS[snapshot.layers.cover[i]] ?? '#000000')
      const v = parseInt(hex.slice(1), 16)
      // shade by elevation so hills read
      const k = 0.75 + 0.25 * ((terrain.elevationM[i] - lo) / span)
      img.data[i * 4] = ((v >> 16) & 255) * k
      img.data[i * 4 + 1] = ((v >> 8) & 255) * k
      img.data[i * 4 + 2] = (v & 255) * k
      img.data[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  }, [snapshot, terrain])
  return (
    <canvas
      ref={ref}
      width={terrain.width}
      height={terrain.height}
      role="img"
      aria-label={`${label}: flat land-cover map`}
      className="h-full w-full object-contain [image-rendering:pixelated]"
    />
  )
}
