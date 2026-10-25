// Legend for the flat land-cover maps (the in-game fallback map and the Compare fallback).
import { LAND_COVERS } from '../../simulation/types'
import { COVER_COLORS } from '../compare/MiniMap'
import { COVER_LABEL } from '../inspector/describe'

export const STRUCTURE_COLOR = '#f7eedc'
export const PREVIEW_VALID = 'rgba(72, 140, 230, 0.75)'
export const PREVIEW_INVALID = 'rgba(230, 97, 0, 0.8)'

const STRIPES = `repeating-linear-gradient(135deg, ${PREVIEW_INVALID} 0 3px, rgba(23, 18, 13, 0.85) 3px 4px)`

const Swatch = ({ background }: { background: string }) => (
  <span className="inline-block h-3 w-4 rounded-sm border border-white/20" style={{ background }} aria-hidden />
)

/** Land-cover colors, the building color and (optionally) the tool preview colors. */
export function LandCoverLegend({ preview = false, className = '' }: { preview?: boolean; className?: string }) {
  return (
    <ul className={`flex flex-wrap gap-x-3 gap-y-1 text-xs ${className}`} aria-label="Flat map legend">
      {LAND_COVERS.map((c, i) => (
        <li key={c} className="flex items-center gap-1.5">
          <Swatch background={COVER_COLORS[i]} />
          {COVER_LABEL[c]}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <Swatch background={STRUCTURE_COLOR} />
        Buildings and roads
      </li>
      {preview && (
        <>
          <li className="flex items-center gap-1.5">
            <Swatch background={PREVIEW_VALID} />
            Can build here
          </li>
          <li className="flex items-center gap-1.5">
            <Swatch background={STRIPES} />
            Cannot build here (striped)
          </li>
        </>
      )}
    </ul>
  )
}
