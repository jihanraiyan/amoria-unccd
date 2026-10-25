// Land use: placement validity, costs and the conversions each player action makes to the
// authoritative layers. Pure: validate returns a report; apply returns new layer arrays.
//
// Rules (all checked per cell; brushes apply to the valid subset):
// - protected cells (reserve, map edge) and river channels cannot be changed (reservoirs may
//   dam a channel cell);
// - each structure has a slope limit; housing needs a road within 2 cells; markets need road
//   frontage and homes nearby; waterworks must sit beside the river with road access;
// - new roads must connect to the existing road network;
// - wetlands need a stream, drainage line or existing wetland next to them, low ground and
//   gentle slope; reservoirs need a channel cell or a valley cell with a large catchment;
// - irrigation needs a source that can feed a canal to the field: a waterworks (its river
//   intake) or a reservoir within canal reach, with the field no more than a small pump lift
//   above the source's water level.
// Costs: building on land with standing cover (forest, agroforestry, grassland, wetland) pays
// the clear cost for that cover plus the open-ground building cost, and sells the timber, so a
// conversion costs the same whether made directly or by clearing first (removalCost).
// Values for the limits live in params.PLACEMENT.
import { ECON, HYDRO, PLACEMENT } from '../params'
import { INTENSITIES, type ActionValidation, type PlayerAction, type SimulationState, type WorldLayers } from '../types'
import { C, S, anyWithin, cellHa, forNeighbors } from './cells'
import { waterworksIntakes } from './hydrology'

/** Placement limits (values from params.PLACEMENT, where each is tagged and explained). */
export const LIMITS = {
  roadSlope: PLACEMENT.roadSlope.value,
  housingSlope: PLACEMENT.housingSlope.value,
  roadAccessCells: PLACEMENT.roadAccessCells.value,
  croplandSlope: PLACEMENT.croplandSlope.value,
  agroforestrySlope: PLACEMENT.agroforestrySlope.value,
  wetlandSlope: PLACEMENT.wetlandSlope.value,
  wetlandMaxHandM: PLACEMENT.wetlandMaxHandM.value,
  wetlandMinAccumulation: PLACEMENT.wetlandMinAccumulation.value,
  reservoirMinAccumulation: PLACEMENT.reservoirMinAccumulation.value,
  reservoirSlope: PLACEMENT.reservoirSlope.value,
  reservoirMaxHandM: PLACEMENT.reservoirMaxHandM.value,
  waterworksSlope: PLACEMENT.waterworksSlope.value,
  waterworksRoadCells: PLACEMENT.waterworksRoadCells.value,
  marketSlope: PLACEMENT.marketSlope.value,
  marketHousingCells: PLACEMENT.marketHousingCells.value,
}
const VEG_AFTER = PLACEMENT.vegetationAfter.value
const pctLimit = (v: number) => `${Math.round(v * 100)}%`

const cap = ECON.capex.value

interface CellCheck {
  ok: boolean
  cost: number
  revenue: number
  reason: string
}

/** Covers the clear action removes (to bare land). */
export const CLEARABLE: readonly number[] = [C.forest, C.agroforestry, C.grassland, C.wetland]

/**
 * Cost of removing a cell's cover so it becomes open ground: exactly what the clear action
 * charges. Forest adds the felling surcharge and wetland the drainage surcharge. Open ground
 * (bare land, a harvested field) costs nothing to clear. Building actions that replace the
 * cover charge this plus the cost of building on open ground, so building directly and
 * clearing first cost the same.
 */
export function removalCost(cover: number): number {
  if (cover === C.forest) return cap.clear + cap.clearForestExtra
  if (cover === C.wetland) return cap.clear + cap.drainWetlandExtra
  if (cover === C.agroforestry || cover === C.grassland) return cap.clear
  return 0
}

const fail = (reason: string): CellCheck => ({ ok: false, cost: 0, revenue: 0, reason })
const pass = (cost: number, revenue = 0): CellCheck => ({ ok: true, cost, revenue, reason: '' })

export interface IrrigationSource {
  /** Source cell (waterworks or reservoir). */
  cell: number
  /** Cell whose water level feeds the canal (the waterworks intake, or the reservoir itself). */
  waterCell: number
  kind: 'waterworks' | 'reservoir'
}

/** Irrigation sources on the map: each waterworks (through its river intake) and each reservoir cell. */
export function irrigationSources(state: Pick<SimulationState, 'terrain' | 'layers'>): IrrigationSource[] {
  const { terrain, layers } = state
  const out: IrrigationSource[] = []
  for (const w of waterworksIntakes(terrain, layers.structure)) out.push({ cell: w.cell, waterCell: w.intake, kind: 'waterworks' })
  for (let j = 0; j < layers.structure.length; j++) if (layers.structure[j] === S.reservoir) out.push({ cell: j, waterCell: j, kind: 'reservoir' })
  return out
}

/** Why a cell cannot be irrigated ('' when it can): canal reach and pump lift from the nearest usable source. */
export function irrigationReason(state: Pick<SimulationState, 'terrain' | 'layers'>, i: number): string {
  const { terrain } = state
  const reach = HYDRO.irrigationReachCells.value
  const lift = HYDRO.irrigationMaxLiftM.value
  const w = terrain.width
  const sources = irrigationSources(state)
  if (sources.length === 0) return 'No irrigation source: build a waterworks by the river or a reservoir first'
  let inReach = false
  for (const src of sources) {
    const d = Math.max(Math.abs((src.cell % w) - (i % w)), Math.abs(Math.floor(src.cell / w) - Math.floor(i / w)))
    if (d > reach) continue
    inReach = true
    if (terrain.filledElevationM[i] - terrain.filledElevationM[src.waterCell] <= lift) return ''
  }
  if (!inReach) return `Too far from an irrigation source: canals reach ${reach} cells from a waterworks or reservoir`
  return `Too high above the water source: fields can sit at most ${lift} m above it`
}

/** True when a canal from a waterworks intake or reservoir can reach the cell. */
export function irrigationReachable(state: Pick<SimulationState, 'terrain' | 'layers'>, i: number): boolean {
  return irrigationReason(state, i) === ''
}

/**
 * Revenue for selling `ha` hectares of timber worth `fullValue` at the full price, when
 * `soldHa` have already been sold this season. The price per hectare is
 * full / (1 + sold / halfPriceHa), integrated over the hectares in this sale.
 */
export function timberSale(fullValue: number, soldHa: number, ha: number): number {
  if (fullValue <= 0 || ha <= 0) return 0
  const h = ECON.timberMarket.value.halfPriceHa
  return ((fullValue / ha) * h * Math.log((1 + (soldHa + ha) / h) / (1 + soldHa / h)))
}

/** Timber value of a cell at the full (first-hectare) price. */
const timber = (layers: WorldLayers, i: number): number => {
  if (layers.cover[i] === C.forest) return ECON.timberPerCell.value.forest * layers.vegetation[i]
  if (layers.cover[i] === C.agroforestry) return ECON.timberPerCell.value.agroforestry * layers.vegetation[i]
  return 0
}

function baseChecks(state: SimulationState, i: number, allowChannel = false): string {
  const { terrain } = state
  if (!Number.isInteger(i) || i < 0 || i >= terrain.width * terrain.height) return 'Outside the map'
  if (terrain.protected[i]) return 'Protected land (forest reserve or map edge)'
  if (terrain.channel[i] && !allowChannel) return 'River channel'
  return ''
}

function checkCell(state: SimulationState, action: Exclude<PlayerAction, { type: 'loan' } | { type: 'repay' } | { type: 'set-levy' }>, i: number): CellCheck {
  const { terrain, layers } = state
  const { width, height } = terrain
  const allowChannel = action.type === 'reservoir' || action.type === 'demolish'
  const base = baseChecks(state, i, allowChannel)
  if (base) return fail(base)
  const cover = layers.cover[i]
  const st = layers.structure[i]
  const slope = terrain.slope[i]
  const free = st === S.none
  const openWater = cover === C.water
  // building on land with standing cover first removes it (same cost and timber as 'clear')
  const removal = removalCost(cover)
  const felled = timber(layers, i)
  const nearRoad = (r: number) => anyWithin(width, height, i, r, (j) => layers.structure[j] === S.road) || layers.structure[i] === S.road

  switch (action.type) {
    case 'road': {
      if (st === S.road) return fail('Already a road')
      if (!free) return fail('Occupied by a structure')
      if (openWater) return fail('Cannot build a road on open water')
      if (slope > LIMITS.roadSlope) return fail(`Too steep for a road (over ${pctLimit(LIMITS.roadSlope)})`)
      return pass(removal + cap.road * (1 + cap.roadSlopeMult * slope), felled)
    }
    case 'housing': {
      if (st === S.housing) {
        if (layers.structureLevel[i] >= 3) return fail('Already at maximum density')
        return pass(cap.housingUpgrade)
      }
      if (!free) return fail('Occupied by a structure')
      if (openWater) return fail('Cannot build homes on open water')
      if (slope > LIMITS.housingSlope) return fail(`Too steep for housing (over ${pctLimit(LIMITS.housingSlope)})`)
      if (!nearRoad(LIMITS.roadAccessCells)) return fail(`Needs a road within ${LIMITS.roadAccessCells} cells`)
      return pass(removal + cap.housing, felled)
    }
    case 'cropland': {
      if (cover === C.cropland) return fail('Already cropland')
      if (!free) return fail('Occupied by a structure')
      if (cover === C.water || cover === C.urban) return fail('Cannot farm here')
      if (slope > LIMITS.croplandSlope) return fail(`Too steep to farm (over ${pctLimit(LIMITS.croplandSlope)})`)
      if (action.irrigated) {
        const why = irrigationReason(state, i)
        if (why) return fail(why)
      }
      return pass(removal + cap.cropland + (action.irrigated ? cap.irrigation : 0), felled)
    }
    case 'set-intensity': {
      if (cover !== C.cropland) return fail('Not cropland')
      if (INTENSITIES[layers.intensity[i]] === action.intensity) return fail('Already at this intensity')
      return pass(cap.setIntensity)
    }
    case 'toggle-irrigation': {
      if (cover !== C.cropland) return fail('Not cropland')
      if (layers.irrigated[i]) return pass(0)
      const why = irrigationReason(state, i)
      if (why) return fail(why)
      return pass(cap.irrigation)
    }
    case 'agroforestry': {
      if (cover === C.agroforestry) return fail('Already agroforestry')
      if (!free) return fail('Occupied by a structure')
      if (cover !== C.cropland && cover !== C.grassland && cover !== C.bare) return fail('Agroforestry goes on cropland, grassland or bare land')
      if (slope > LIMITS.agroforestrySlope) return fail(`Too steep for agroforestry (over ${pctLimit(LIMITS.agroforestrySlope)})`)
      return pass(cap.agroforestry)
    }
    case 'clear': {
      if (!free) return fail('Occupied by a structure')
      if (!CLEARABLE.includes(cover)) return fail('Nothing to clear')
      return pass(removal, felled)
    }
    case 'reforest': {
      if (cover === C.forest) return fail('Already forest')
      if (!free) return fail('Occupied by a structure')
      if (cover !== C.bare && cover !== C.grassland && cover !== C.cropland && cover !== C.agroforestry) return fail('Cannot plant forest here')
      return pass(cap.reforest)
    }
    case 'wetland': {
      if (cover === C.wetland) return fail('Already wetland')
      if (!free) return fail('Occupied by a structure')
      if (cover !== C.grassland && cover !== C.cropland && cover !== C.bare) return fail('Wetlands are restored on grassland, cropland or bare land')
      if (slope > LIMITS.wetlandSlope) return fail(`Too steep for a wetland (over ${pctLimit(LIMITS.wetlandSlope)})`)
      if (terrain.heightAboveChannelM[i] > LIMITS.wetlandMaxHandM) return fail('Too high above the stream for a wetland')
      let adjacent = terrain.channelDistance[i] <= 1 || terrain.flowAccumulation[i] >= LIMITS.wetlandMinAccumulation
      if (!adjacent) forNeighbors(width, height, i, (j) => (adjacent ||= layers.cover[j] === C.wetland))
      if (!adjacent) return fail('Needs a stream, drainage line or existing wetland next to it')
      return pass(cap.wetland)
    }
    case 'conservation': {
      if (cover !== C.cropland) return fail('Conservation practices apply to cropland')
      if (layers.conservation[i]) return fail('Already has conservation practices')
      return pass(cap.conservation * (1 + cap.conservationSlopeMult * slope))
    }
    case 'reservoir': {
      if (st === S.reservoir) return fail('Already a reservoir')
      if (!free) return fail('Occupied by a structure')
      const onChannel = terrain.channel[i] === 1
      const valley =
        terrain.flowAccumulation[i] >= LIMITS.reservoirMinAccumulation &&
        slope <= LIMITS.reservoirSlope &&
        terrain.heightAboveChannelM[i] <= LIMITS.reservoirMaxHandM
      if (!onChannel && !valley) return fail('Reservoirs need a stream channel or a valley floor with a large catchment')
      return pass(cap.reservoir)
    }
    case 'waterworks': {
      if (!free) return fail('Occupied by a structure')
      if (openWater) return fail('Cannot build on open water')
      if (terrain.channelDistance[i] !== 1) return fail('Must be right next to the river')
      if (slope > LIMITS.waterworksSlope) return fail(`Too steep (over ${pctLimit(LIMITS.waterworksSlope)})`)
      if (!nearRoad(LIMITS.waterworksRoadCells)) return fail(`Needs a road within ${LIMITS.waterworksRoadCells} cells`)
      return pass(removal + cap.waterworks, felled)
    }
    case 'market': {
      if (!free) return fail('Occupied by a structure')
      if (openWater) return fail('Cannot build on open water')
      if (slope > LIMITS.marketSlope) return fail(`Too steep (over ${pctLimit(LIMITS.marketSlope)})`)
      if (!nearRoad(1)) return fail('Needs road frontage')
      if (!anyWithin(width, height, i, LIMITS.marketHousingCells, (j) => layers.structure[j] === S.housing)) return fail(`Needs homes within ${LIMITS.marketHousingCells} cells`)
      return pass(removal + cap.market, felled)
    }
    case 'demolish': {
      if (free) return fail('Nothing to demolish')
      return pass(cap.demolish)
    }
  }
}

/** Roads in one action must link to the existing network through other cells of the action. */
function enforceRoadConnectivity(state: SimulationState, cells: number[], checks: CellCheck[]): void {
  const { width, height } = state.terrain
  const candidate = new Set<number>()
  cells.forEach((c, k) => checks[k].ok && candidate.add(c))
  const connected = new Set<number>()
  const queue: number[] = []
  for (const c of candidate) {
    let touches = false
    forNeighbors(width, height, c, (j) => (touches ||= state.layers.structure[j] === S.road))
    if (touches) {
      connected.add(c)
      queue.push(c)
    }
  }
  while (queue.length) {
    const c = queue.shift()!
    forNeighbors(width, height, c, (j) => {
      if (candidate.has(j) && !connected.has(j)) {
        connected.add(j)
        queue.push(j)
      }
    })
  }
  cells.forEach((c, k) => {
    if (checks[k].ok && !connected.has(c)) checks[k] = fail('Roads must connect to the existing road network')
  })
}

export function validateLandUse(state: SimulationState, action: PlayerAction): ActionValidation {
  if (action.type === 'set-levy') {
    const rp = ECON.ratePolicy.value
    const reasons: string[] = []
    if (!Number.isFinite(action.rate)) reasons.push('Rate must be a number')
    else if (action.rate < rp.min - 1e-9 || action.rate > rp.max + 1e-9) reasons.push(`The levy must be between ${Math.round(rp.min * 100)}% and ${Math.round(rp.max * 100)}%`)
    return { ok: reasons.length === 0, cost: 0, cellOk: [], reasons, revenue: 0, cellReasons: [] }
  }
  if (action.type === 'loan' || action.type === 'repay') {
    const reasons: string[] = []
    const amount = action.amount
    if (!Number.isFinite(amount) || amount <= 0) reasons.push('Amount must be a positive number')
    else if (action.type === 'loan' && state.economy.debt + amount > ECON.maxDebt.value)
      reasons.push(`Borrowing limit is ${ECON.maxDebt.value.toLocaleString('en-US')} (current debt ${Math.round(state.economy.debt).toLocaleString('en-US')})`)
    else if (action.type === 'repay' && amount > state.economy.debt + 1e-6) reasons.push('Cannot repay more than the debt')
    else if (action.type === 'repay' && amount > state.economy.budget + 1e-6) reasons.push('Not enough budget to repay that much')
    return { ok: reasons.length === 0, cost: 0, cellOk: [], reasons, revenue: 0, cellReasons: [] }
  }
  const cells = action.cells
  const seen = new Set<number>()
  const checks = cells.map((i) => {
    if (seen.has(i)) return fail('Duplicate cell')
    seen.add(i)
    return checkCell(state, action, i)
  })
  if (action.type === 'road') enforceRoadConnectivity(state, cells, checks)
  // timber is sold into a small local market: each hectare fetches less than the one before
  const ha = cellHa(state.terrain)
  let sold = state.economy.timberSoldHa ?? 0
  let timberHa = 0
  checks.forEach((c, k) => {
    if (!c.ok || c.revenue <= 0) return
    checks[k] = { ...c, revenue: timberSale(c.revenue, sold, ha) }
    sold += ha
    timberHa += ha
  })
  const cost = Math.round(checks.reduce((a, c) => a + (c.ok ? c.cost : 0), 0))
  const revenue = Math.round(checks.reduce((a, c) => a + (c.ok ? c.revenue : 0), 0))
  const valid = checks.filter((c) => c.ok).length
  const reasons = [...new Set(checks.filter((c) => !c.ok).map((c) => c.reason))]
  if (cells.length === 0) reasons.push('No cells selected')
  else if (valid === 0 && reasons.length === 0) reasons.push('No valid cells')
  const affordable = cost <= state.economy.budget + 1e-6
  if (valid > 0 && !affordable)
    reasons.unshift(`Not enough budget: needs ${cost.toLocaleString('en-US')}, you have ${Math.floor(state.economy.budget).toLocaleString('en-US')}`)
  return {
    ok: valid > 0 && affordable,
    cost,
    revenue,
    cellOk: checks.map((c) => c.ok),
    reasons,
    cellReasons: checks.map((c) => c.reason),
    timberHa,
  }
}

export interface LandUseApplied {
  layers: WorldLayers
  reservoirSiltM3: number
}

/** Apply a validated cell action to copies of the layers. Only cells with cellOk are changed. */
export function applyLandUse(state: SimulationState, action: PlayerAction, validation: ActionValidation): LandUseApplied {
  const src = state.layers
  if (action.type === 'loan' || action.type === 'repay' || action.type === 'set-levy') return { layers: src, reservoirSiltM3: state.reservoirSiltM3 }
  const L: WorldLayers = {
    ...src,
    cover: src.cover.slice(),
    structure: src.structure.slice(),
    structureLevel: src.structureLevel.slice(),
    intensity: src.intensity.slice(),
    conservation: src.conservation.slice(),
    irrigated: src.irrigated.slice(),
    coverAge: src.coverAge.slice(),
    vegetation: src.vegetation.slice(),
    wetlandStoreMm: src.wetlandStoreMm,
  }
  let reservoirCells = 0
  for (let j = 0; j < src.structure.length; j++) if (src.structure[j] === S.reservoir) reservoirCells++
  let silt = state.reservoirSiltM3
  const setCover = (i: number, c: number) => {
    if (L.cover[i] !== c) L.coverAge[i] = 0
    L.cover[i] = c
    if (c !== C.cropland) {
      L.intensity[i] = 1
      L.irrigated[i] = 0
      L.conservation[i] = 0
    }
  }
  action.cells.forEach((i, k) => {
    if (!validation.cellOk[k]) return
    switch (action.type) {
      case 'road':
        setCover(i, C.urban)
        L.structure[i] = S.road
        L.structureLevel[i] = 0
        L.vegetation[i] = Math.min(L.vegetation[i], VEG_AFTER.built)
        break
      case 'housing':
        if (L.structure[i] === S.housing) L.structureLevel[i] = Math.min(3, L.structureLevel[i] + 1)
        else {
          setCover(i, C.urban)
          L.structure[i] = S.housing
          L.structureLevel[i] = 1
          L.vegetation[i] = Math.min(L.vegetation[i], VEG_AFTER.housing)
        }
        break
      case 'cropland':
        setCover(i, C.cropland)
        L.intensity[i] = INTENSITIES.indexOf(action.intensity)
        L.irrigated[i] = action.irrigated ? 1 : 0
        L.conservation[i] = 0
        L.vegetation[i] = Math.min(L.vegetation[i], VEG_AFTER.tilled) // freshly cleared and tilled
        break
      case 'set-intensity':
        L.intensity[i] = INTENSITIES.indexOf(action.intensity)
        break
      case 'toggle-irrigation':
        L.irrigated[i] = L.irrigated[i] ? 0 : 1
        break
      case 'agroforestry':
        setCover(i, C.agroforestry)
        break
      case 'clear':
        setCover(i, C.bare)
        L.vegetation[i] = Math.min(L.vegetation[i], VEG_AFTER.cleared)
        break
      case 'reforest':
        setCover(i, C.forest)
        break
      case 'wetland':
        setCover(i, C.wetland)
        break
      case 'conservation':
        L.conservation[i] = 1
        break
      case 'reservoir':
        setCover(i, C.water)
        L.structure[i] = S.reservoir
        L.vegetation[i] = 0
        break
      case 'waterworks':
        setCover(i, C.urban)
        L.structure[i] = S.waterworks
        L.vegetation[i] = Math.min(L.vegetation[i], VEG_AFTER.built)
        break
      case 'market':
        setCover(i, C.urban)
        L.structure[i] = S.market
        L.vegetation[i] = Math.min(L.vegetation[i], VEG_AFTER.built)
        break
      case 'demolish': {
        const wasReservoir = L.structure[i] === S.reservoir
        if (wasReservoir && reservoirCells > 0) {
          silt *= (reservoirCells - 1) / reservoirCells
          reservoirCells--
        }
        L.structure[i] = S.none
        L.structureLevel[i] = 0
        setCover(i, state.terrain.channel[i] ? C.water : C.bare)
        L.vegetation[i] = 0
        break
      }
    }
  })
  return { layers: L, reservoirSiltM3: silt }
}
