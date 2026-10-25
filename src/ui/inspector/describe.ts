// Plain-language descriptions of a parcel. Pure functions over state; no models here,
// only lookups, unit conversions and rank statistics of values the engine produced.
import {
  INTENSITIES,
  coverName,
  structureName,
  type LandCover,
  type Structure,
  type Terrain,
  type WorldLayers,
} from '../../simulation/types'

export const COVER_LABEL: Record<LandCover, string> = {
  forest: 'Forest',
  grassland: 'Grassland',
  cropland: 'Cropland',
  agroforestry: 'Agroforestry',
  urban: 'Built-up',
  wetland: 'Wetland',
  water: 'Open water',
  bare: 'Bare ground',
}

export const STRUCTURE_LABEL: Record<Structure, string> = {
  none: '',
  road: 'Road',
  housing: 'Housing',
  reservoir: 'Reservoir',
  waterworks: 'Waterworks',
  market: 'Market',
}

/** What the parcel does for the valley's economy, from its cover and structure. */
export function economicRole(cover: LandCover, structure: Structure, irrigated: boolean): string {
  switch (structure) {
    case 'housing':
      return 'Homes for residents. Brings tax income and workers, and adds water and food demand.'
    case 'road':
      if (cover === 'water') return 'Bridge. Carries the road across the water and links the land on both banks. The river flows on underneath. Costs upkeep.'
      return 'Transport link. Gives nearby land access for development and trade. Costs upkeep.'
    case 'market':
      return 'Jobs and trade income for the town.'
    case 'reservoir':
      return 'Stores water for dry seasons. Costs upkeep; silt from upstream erosion fills it over time.'
    case 'waterworks':
      return 'Supplies treated water to homes. Muddier river water makes treatment cost more.'
    case 'none':
      break
  }
  switch (cover) {
    case 'cropland':
      return irrigated ? 'Irrigated farm field: food and farm income, drawing on shared water.' : 'Rain-fed farm field: food and farm income, at the mercy of rainfall.'
    case 'agroforestry':
      return 'Trees with crops or pasture: some food plus tree products once mature.'
    case 'forest':
      return 'No direct income. Shelters the soil and lets more rain soak in instead of running off.'
    case 'grassland':
      return 'Open land. Little income, moderate protection for the soil.'
    case 'wetland':
      return 'No direct income. Holds water back and traps sediment.'
    case 'water':
      return 'River or lake. Source of water for the town and fields.'
    case 'urban':
      return 'Built-up ground without a building.'
    case 'bare':
      return 'Unused, exposed ground. Erodes easily until something grows.'
  }
}

/** Share of values strictly below v, 0..1. */
export function rankOf(values: ArrayLike<number>, v: number): number {
  let below = 0
  for (let i = 0; i < values.length; i++) if (values[i] < v) below++
  return values.length ? below / values.length : 0
}

export interface SensitivityFact {
  label: string
  detail: string
  /** True when this factor makes the parcel more sensitive than most of the valley. */
  notable: boolean
}

/** Descriptive sensitivity factors, each a rank within this valley rather than a judgment. */
export function sensitivityFacts(t: Terrain, layers: WorldLayers, i: number): SensitivityFact[] {
  const slopeRank = rankOf(t.slope, t.slope[i])
  const upRank = rankOf(t.flowAccumulation, t.flowAccumulation[i])
  const facts: SensitivityFact[] = [
    {
      label: 'Steepness',
      detail: `Steeper than ${Math.round(slopeRank * 100)}% of the valley.`,
      notable: slopeRank >= 0.75,
    },
    {
      label: 'Water arriving from uphill',
      detail: `Drains more land than ${Math.round(upRank * 100)}% of parcels.`,
      notable: upRank >= 0.9,
    },
  ]
  if (t.channelDistance && Number.isFinite(t.channelDistance[i])) {
    const d = t.channelDistance[i]
    const h = t.heightAboveChannelM?.[i]
    facts.push({
      label: 'Closeness to the river',
      detail:
        d === 0
          ? 'This is part of the river channel.'
          : `${d} parcel${d === 1 ? '' : 's'} from the river${Number.isFinite(h) ? `, ${h.toFixed(1)} m above it` : ''}.`,
      notable: d > 0 && d <= 2,
    })
  }
  const veg = layers.vegetation[i]
  facts.push({
    label: 'Protective plant cover',
    detail: `${Math.round(veg * 100)}% of the ground is covered by plants.`,
    notable: veg < 0.3,
  })
  return facts
}

export const intensityLabel = (code: number): string => INTENSITIES[code] ?? 'medium'

export function cellSummary(layers: WorldLayers, i: number): { cover: LandCover; structure: Structure; title: string } {
  const cover = coverName(layers.cover[i])
  const structure = structureName(layers.structure[i])
  // a road over a river or open water is a bridge (channel cells are always water cover)
  if (structure === 'road' && cover === 'water') return { cover, structure, title: 'Bridge over open water' }
  const s = STRUCTURE_LABEL[structure]
  return { cover, structure, title: s ? `${s} on ${COVER_LABEL[cover].toLowerCase()}` : COVER_LABEL[cover] }
}

/** Upstream contributing area in hectares. */
export const upstreamHa = (t: Terrain, i: number): number => (t.flowAccumulation[i] * t.cellSizeM * t.cellSizeM) / 10_000

/** "2021" or "2010 to 2013" from a source's `acquired` period (ISO dates or a range), or null. */
export function acquiredYears(acquired: string | undefined): string | null {
  const years = [...new Set((acquired ?? '').match(/\b(19|20)\d{2}\b/g) ?? [])].sort()
  if (!years.length) return null
  return years.length === 1 ? years[0] : `${years[0]} to ${years[years.length - 1]}`
}

/** Tooltip for observed terrain, sized from the map's own grid and pit-filling counts rather than fixed numbers. */
export function observedTerrainHint(demSource: string, cellSizeM: number | undefined, fill?: { filledCells: number; maxRaiseM: number } | null): string {
  const grid = Number.isFinite(cellSizeM) && (cellSizeM ?? 0) > 0 ? `averaged to ${Math.round(cellSizeM as number)} m cells` : 'averaged onto the game grid'
  const pits =
    fill && fill.filledCells > 0
      ? `${fill.filledCells.toLocaleString('en-US')} cells were raised${fill.maxRaiseM > 0 ? ` (by up to ${Math.round(fill.maxRaiseM)} m)` : ''} to fill pits so water can drain`
      : 'some cells were raised to fill pits so water can drain'
  return `Elevation from ${demSource}, ${grid} and depression-filled: ${pits}. Slope and upstream area are worked out by the game from these heights, so they are derived from observed elevation, not observed themselves. It is a record of the land, not a prediction.`
}

/** Hint for the observed land-cover row, built from the map's own cell size and source dates. */
export function observedCoverHint(cellSizeM: number | undefined, source: { acquired?: string; version?: string } | undefined): string {
  const cell = Number.isFinite(cellSizeM) && (cellSizeM ?? 0) > 0 ? `this ${Math.round(cellSizeM as number)} m cell` : 'this cell'
  const years = acquiredYears(source?.acquired) ?? acquiredYears(source?.version)
  const when = years ? `conditions seen in ${years}` : 'conditions when the source imagery was taken'
  return `The game class that won in ${cell} after the WorldCover pixels were mapped to game classes (shrubland counts as grassland, so their pixels are pooled). It is not the satellite class itself, which the WorldCover row shows. It describes ${when} and is never changed by your choices.`
}

const SAME_CLASS: Record<string, string> = { 'tree cover': 'forest', 'built-up': 'urban', shrubland: 'grassland', 'herbaceous wetland': 'wetland' }

/**
 * Why the pooled vote (observed game class) differs from the native WorldCover class, or null
 * when they agree.
 */
export function pooledVoteNote(nativeName: string, nativeSharePct: number | null, observedLabel: string): string | null {
  const n = nativeName.toLowerCase()
  const o = observedLabel.toLowerCase()
  if (n === o || SAME_CLASS[n] === o || (n.includes('water') && o === 'water') || (n.startsWith('bare') && o === 'bare')) return null
  const share = nativeSharePct !== null ? ` is the most common class here, but covers only ${nativeSharePct}% of the pixels` : ' is the most common class here, but not a majority'
  return `${nativeName}${share}. Shrubland and grassland pixels count together as grassland in the game, and together they outnumber it, so the cell plays as ${o}.`
}
