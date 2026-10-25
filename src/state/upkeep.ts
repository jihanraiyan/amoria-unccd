// Running costs an action adds to (or removes from) the budget every season, so the
// placement preview and the toolbar can show "then about $X a season" next to the one-off
// price. Read-only: the action is applied to copies of the layers with the engine's own
// land-use rules, and the recurring bills are recounted with the engine's own rates.
import { AGRI, ECON } from '../simulation/params'
import { C, S, INTENSITY_KEYS, cellHa } from '../simulation/models/cells'
import { applyLandUse } from '../simulation/models/landUse'
import type { ActionValidation, Intensity, PlayerAction, SimulationState, WorldLayers } from '../simulation/types'
import type { ToolId, ToolOptions } from './toolActions'

export interface Upkeep {
  /** Change in recurring bills per season that lasts (maintenance plus farm inputs). */
  perSeason: number
  /** Extra protection for young plantings, paid only for their first few seasons. */
  youngPerSeason: number
  /** Number of seasons the young-planting cost lasts. */
  youngSeasons: number
  /** True when irrigation changes, so pumping (billed per m3 drawn) changes too. */
  pumping: boolean
}

/** Lasting recurring bill of one parcel, as economy.ts and agriculture.ts count it. */
function cellBill(L: WorldLayers, i: number, ha: number, serviceLevel: number): number {
  const mt = ECON.maintenance.value
  let bill = 0
  const st = L.structure[i]
  const c = L.cover[i]
  if (st === S.road) bill += mt.road
  else if (st === S.housing) bill += L.structureLevel[i] * mt.housingPerLevel
  else if (st === S.reservoir) bill += mt.reservoir
  else if (st === S.waterworks) bill += mt.waterworks
  else if (st === S.market) bill += mt.market
  if (c === C.wetland && L.baselineCover[i] !== C.wetland) bill += mt.wetland
  if (c === C.cropland) {
    if (L.conservation[i]) bill += mt.conservation
    if (L.irrigated[i]) bill += mt.irrigatedCell
    const key = INTENSITY_KEYS[L.intensity[i]] ?? 'medium'
    bill += AGRI.inputCost.value[key] * ha * Math.min(1, Math.max(0, serviceLevel))
  }
  return bill
}

function isYoung(L: WorldLayers, i: number): boolean {
  const c = L.cover[i]
  return (c === C.forest || c === C.agroforestry || c === C.wetland) && L.baselineCover[i] !== c && L.coverAge[i] < ECON.youngPlantingSeasons.value
}

/**
 * Recurring cost change of an action over the parcels it would actually change. Uses the
 * simulation's own `upkeepPerSeason` when the validation carries one.
 */
export function actionUpkeep(sim: SimulationState, action: PlayerAction, validation: ActionValidation): Upkeep | null {
  if (action.type === 'loan' || action.type === 'repay' || action.type === 'set-levy') return null
  if (!validation.cellOk.some(Boolean)) return null
  const after = applyLandUse(sim, action, validation).layers
  const before = sim.layers
  const ha = cellHa(sim.terrain)
  const level = sim.economy.serviceLevel ?? 1
  let perSeason = 0
  let young = 0
  let pumping = false
  action.cells.forEach((i, k) => {
    if (!validation.cellOk[k]) return
    perSeason += cellBill(after, i, ha, level) - cellBill(before, i, ha, level)
    if (isYoung(after, i) && !isYoung(before, i)) young += ECON.maintenance.value.youngPlanting
    if (isYoung(before, i) && !isYoung(after, i)) young -= ECON.maintenance.value.youngPlanting
    const irrBefore = before.cover[i] === C.cropland && before.irrigated[i] === 1
    const irrAfter = after.cover[i] === C.cropland && after.irrigated[i] === 1
    if (irrBefore !== irrAfter) pumping = true
  })
  const fromSim = (validation as ActionValidation & { upkeepPerSeason?: number }).upkeepPerSeason
  return {
    perSeason: typeof fromSim === 'number' && Number.isFinite(fromSim) ? fromSim : perSeason,
    youngPerSeason: young,
    youngSeasons: ECON.youngPlantingSeasons.value,
    pumping,
  }
}

const money = (v: number) => `$${Math.round(Math.abs(v)).toLocaleString('en-US')}`

/** "then about $55 a season" style phrase for the preview line; '' when nothing changes. */
export function upkeepPhrase(u: Upkeep | null): string {
  if (!u) return ''
  const parts: string[] = []
  if (Math.round(u.perSeason) > 0) parts.push(`then about ${money(u.perSeason)} a season`)
  else if (Math.round(u.perSeason) < 0) parts.push(`saves about ${money(u.perSeason)} a season`)
  if (Math.round(u.youngPerSeason) > 0) parts.push(`${parts.length ? 'plus' : 'then'} ${money(u.youngPerSeason)} a season for the first ${u.youngSeasons} seasons`)
  if (u.pumping) parts.push('plus pumping for the water drawn')
  return parts.join(', ')
}

/**
 * Running cost of one parcel of a tool with the given options, for the toolbar tooltip. Uses
 * the engine's rates on a typical parcel (the preview gives the exact figure for a place).
 */
export function toolUpkeepText(tool: ToolId, options: ToolOptions, cellSizeM: number): string | null {
  const mt = ECON.maintenance.value
  const ha = (cellSizeM * cellSizeM) / 10_000
  const inputs = (lvl: Intensity) => AGRI.inputCost.value[lvl] * ha
  const pump = `$${AGRI.irrigationOpexPerM3.value} per m3 of water drawn`
  const young = `${money(mt.youngPlanting)} a season for the first ${ECON.youngPlantingSeasons.value} seasons`
  switch (tool) {
    case 'road':
      return `${money(mt.road)} a season in upkeep`
    case 'housing':
      return `${money(mt.housingPerLevel)} a season in upkeep per level (residents also use services and pay tax)`
    case 'cropland': {
      const base = `${money(inputs(options.intensity))} a season in farm inputs at ${options.intensity} intensity`
      return options.irrigated ? `${base}, plus ${money(mt.irrigatedCell)} for canals and ${pump}` : base
    }
    case 'set-intensity':
      return `Farm inputs per field each season: low ${money(inputs('low'))}, medium ${money(inputs('medium'))}, high ${money(inputs('high'))}`
    case 'toggle-irrigation':
      return `Irrigated fields cost ${money(mt.irrigatedCell)} a season for canals, plus ${pump}`
    case 'agroforestry':
    case 'reforest':
      return young
    case 'wetland':
      return `${money(mt.wetland)} a season in upkeep, plus ${young}`
    case 'conservation':
      return `${money(mt.conservation)} a season in upkeep`
    case 'reservoir':
      return `${money(mt.reservoir)} a season in upkeep per parcel`
    case 'waterworks':
      return `${money(mt.waterworks)} a season, plus treatment for every m3 supplied`
    case 'market':
      return `${money(mt.market)} a season in upkeep`
    case 'demolish':
      return 'Ends the upkeep of what stood here'
    default:
      return null
  }
}
