// What a real-data world takes from data and what it does not (no heavy imports, so the
// metric definitions can use it).
import type { WorldMeta } from '../simulation/types'

/**
 * What a real-data world takes from data and what it does not. The climate, soils, yields and
 * prices are the game's generic values on every map (src/simulation/params.ts CLIMATE, AGRI,
 * ECON), whatever place the terrain comes from.
 */
export const REAL_DATA_GENERIC_NOTE =
  'Only the terrain, land cover, streams and roads come from real data. Rain and seasons (one wet and one dry, about 530 mm a year), soils, yields and prices are the same generic game values as the fictional valley.'

/** Extra caveat for a real place whose real rainfall pattern differs from the game's. */
export function genericClimateNote(meta: Pick<WorldMeta, 'kind' | 'name' | 'id'>): string | null {
  if (meta.kind !== 'real-data-derived') return null
  const machakos = /machakos/i.test(meta.name) || /machakos/i.test(meta.id)
  return machakos ? `${REAL_DATA_GENERIC_NOTE} Machakos really has two rainy seasons a year, so the droughts and rains in the game are not this place's own.` : REAL_DATA_GENERIC_NOTE
}
