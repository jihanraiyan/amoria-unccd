// Scripted strategy bots: fixed land-management strategies played through the public engine
// API for the full guided horizon from the same seed. Used by strategy tests to check that
// tradeoffs emerge from the simulation (no strategy is special-cased anywhere in the engine).
// The bots are written against map features (homes, roads, channels, slopes, the land that
// drains to the village), not coordinates, so the same bots play the fictional valley and the
// real-data Kaani map.
import { erosionSusceptibility } from '../../derived/overlays'
import { applyAction, createInitialState, step, validateAction } from '../../engine'
import { C, S, villageContributingArea } from '../../models/cells'
import { MAIN_RIVER_CELLS } from '../../models/hydrology'
import { irrigationReachable } from '../../models/landUse'
import { contouringP } from '../../models/soil'
import { AGRI, ECON, HYDRO } from '../../params'
import type { PlayerAction, SimulationState, WorldInput } from '../../types'
import { generateProceduralWorld } from '../../world/procedural'

export type Bot = (s: SimulationState) => PlayerAction[]

export interface PlayResult {
  name: string
  final: SimulationState
  /** Number of actions that validated and were applied. */
  applied: number
  rejected: number
}

export const VALLEY_WORLD = generateProceduralWorld(1)

const xOf = (s: SimulationState, i: number) => i % s.terrain.width
const zOf = (s: SimulationState, i: number) => Math.floor(i / s.terrain.width)

/** All cells matching pred. */
export function cellsWhere(s: SimulationState, pred: (i: number) => boolean): number[] {
  const out: number[] = []
  for (let i = 0; i < s.layers.cover.length; i++) if (pred(i)) out.push(i)
  return out
}

/** Village centre: mean position of the homes that existed at the start. */
export function villageCentre(s: SimulationState): { x: number; z: number } {
  let x = 0
  let z = 0
  let k = 0
  for (let i = 0; i < s.layers.structure.length; i++) {
    if (s.layers.structure[i] === S.housing && s.layers.baselineCover[i] === C.urban) {
      x += xOf(s, i)
      z += zOf(s, i)
      k++
    }
  }
  return k ? { x: x / k, z: z / k } : { x: s.terrain.width / 2, z: s.terrain.height / 2 }
}

const dist = (s: SimulationState, i: number, c: { x: number; z: number }) => Math.hypot(xOf(s, i) - c.x, zOf(s, i) - c.z)
const byDistance = (s: SimulationState, c: { x: number; z: number }) => (a: number, b: number) => dist(s, a, c) - dist(s, b, c)

/** Land that drains through the starting village (cached per terrain object). */
const upstreamCache = new WeakMap<object, Uint8Array>()
export function villageUpstream(s: SimulationState): Uint8Array {
  let m = upstreamCache.get(s.terrain)
  if (!m) {
    m = villageContributingArea(s.terrain, s.reference.layers.structure, HYDRO.flood.value.maxDistanceCells)
    upstreamCache.set(s.terrain, m)
  }
  return m
}

/**
 * Apply an action, trimming cells until it is affordable. Returns the new state.
 * Only the valid subset is applied (the engine does this itself).
 */
export function tryAction(s: SimulationState, a: PlayerAction, counter?: { applied: number; rejected: number }): SimulationState {
  let action = a
  if ('cells' in action && action.cells.length === 0) return s
  for (let attempt = 0; attempt < 8; attempt++) {
    const v = validateAction(s, action)
    if (v.ok) {
      const r = applyAction(s, action)
      if (counter) counter.applied++
      return r.state
    }
    if (!('cells' in action)) break
    const valid = action.cells.filter((_, k) => v.cellOk[k])
    if (valid.length === 0) break
    const keep = v.cost > s.economy.budget ? Math.floor((valid.length * s.economy.budget) / Math.max(1, v.cost)) : valid.length
    if (keep <= 0) break
    action = { ...action, cells: valid.slice(0, keep) } as PlayerAction
  }
  if (counter) counter.rejected++
  return s
}

export function play(name: string, bot: Bot, opts: { seed?: number; years?: number; world?: WorldInput; from?: SimulationState } = {}): PlayResult {
  const seed = opts.seed ?? 42
  const years = opts.years ?? 20
  let s = opts.from ?? createInitialState(opts.world ?? VALLEY_WORLD, seed)
  const counter = { applied: 0, rejected: 0 }
  const end = s.step + years * 2
  while (s.step < end) {
    for (const a of bot(s)) s = tryAction(s, a, counter)
    s = step(s).state
  }
  return { name, final: s, ...counter }
}

// ------------------------------------------------------------------ shared building blocks

const once = (s: SimulationState, atStep: number) => s.step === atStep

/** The first k candidate cells that are individually valid for a cell action. */
function pickValid(s: SimulationState, make: (cells: number[]) => PlayerAction, candidates: number[], k: number): PlayerAction {
  const v = validateAction(s, make(candidates))
  return make(candidates.filter((_, j) => v.cellOk[j]).slice(0, k))
}

/** Keep housing adequate: densify existing homes first, then build on high, flat ground near roads. */
function plannedHousing(s: SimulationState, budgetShare = 0.5): PlayerAction[] {
  const c = s.community
  if (c.housingDemand <= c.housingCapacity * 0.97 || s.economy.budget < 20_000) return []
  const per = s.calibration.residentsPerHome
  const needPeople = c.housingDemand * 1.08 - c.housingCapacity
  const out: PlayerAction[] = []
  const upgrades = cellsWhere(s, (i) => s.layers.structure[i] === S.housing && s.layers.structureLevel[i] < 3 && s.terrain.heightAboveChannelM[i] > 3.5)
  const gain = per[2] - per[1]
  const nUp = Math.min(upgrades.length, Math.ceil(needPeople / gain), Math.floor((s.economy.budget * budgetShare) / 12_000))
  if (nUp > 0) out.push({ type: 'housing', cells: upgrades.slice(0, nUp) })
  const remaining = needPeople - nUp * gain
  if (remaining > 0) {
    const centre = villageCentre(s)
    const sites = cellsWhere(
      s,
      (i) =>
        s.layers.structure[i] === S.none &&
        s.terrain.heightAboveChannelM[i] > 4 &&
        s.terrain.slope[i] < 0.12 &&
        s.layers.cover[i] !== C.cropland &&
        s.layers.cover[i] !== C.wetland &&
        s.layers.cover[i] !== C.water,
    ).sort(byDistance(s, centre))
    out.push(pickValid(s, (cells) => ({ type: 'housing', cells }), sites.slice(0, 400), Math.ceil(remaining / per[1]) + 4))
  }
  return out
}

/** Sprawl housing: cheapest closest land, floodplain and farmland included, low density, plus roads. */
function sprawlHousing(s: SimulationState): PlayerAction[] {
  const c = s.community
  if (c.housingDemand <= c.housingCapacity * 0.97 || s.economy.budget < 15_000) return []
  const centre = villageCentre(s)
  const need = Math.ceil((c.housingDemand * 1.1 - c.housingCapacity) / s.calibration.residentsPerHome[1]) + 3
  // flat, cheap land next to town: in a valley that means the floodplain and its farms
  const sites = cellsWhere(s, (i) => s.layers.structure[i] === S.none && s.terrain.slope[i] < 0.05 && s.layers.cover[i] !== C.water && s.layers.cover[i] !== C.wetland).sort(
    (a, b) => dist(s, a, centre) + 200 * s.terrain.slope[a] + 2 * s.terrain.heightAboveChannelM[a] - (dist(s, b, centre) + 200 * s.terrain.slope[b] + 2 * s.terrain.heightAboveChannelM[b]),
  )
  const roads = cellsWhere(s, (i) => s.layers.structure[i] === S.none && s.terrain.slope[i] < 0.12 && s.layers.cover[i] !== C.water && s.layers.cover[i] !== C.wetland)
    .filter((i) => dist(s, i, centre) < 12 && (xOf(s, i) + zOf(s, i)) % 4 === 0)
    .sort(byDistance(s, centre))
  return [
    { type: 'road', cells: roads.slice(0, 10) },
    pickValid(s, (cells) => ({ type: 'housing', cells }), sites.slice(0, 400), need),
  ]
}

/** Repay debt when the budget is comfortable. */
function manageDebt(s: SimulationState, reserve = 60_000): PlayerAction[] {
  if (s.economy.debt > 0 && s.economy.budget > reserve + 10_000) return [{ type: 'repay', amount: Math.min(s.economy.debt, s.economy.budget - reserve) }]
  return []
}

/** Build a waterworks by the main river near the village if the map has none (basic infrastructure). */
function ensureWaterworks(s: SimulationState): PlayerAction[] {
  if (s.step !== 0 || cellsWhere(s, (i) => s.layers.structure[i] === S.waterworks).length > 0) return []
  const centre = villageCentre(s)
  const mainNear = (i: number) => {
    let best = 0
    const w = s.terrain.width
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const j = i + dz * w + dx
        if (j >= 0 && j < s.terrain.channel.length && s.terrain.channel[j]) best = Math.max(best, s.terrain.flowAccumulation[j])
      }
    return best
  }
  const sites = cellsWhere(s, (i) => s.terrain.channelDistance[i] === 1 && s.layers.structure[i] === S.none && mainNear(i) >= MAIN_RIVER_CELLS).sort(byDistance(s, centre))
  return [pickValid(s, (cells) => ({ type: 'waterworks', cells }), sites.slice(0, 300), 1)]
}

/** Another waterworks when the town's piped water demand nears the capacity it has (planned infrastructure). */
function growWaterworks(s: SimulationState): PlayerAction[] {
  if (s.step === 0 || s.step % 2 !== 0 || s.economy.budget < 60_000) return []
  const works = cellsWhere(s, (i) => s.layers.structure[i] === S.waterworks).length
  if (works === 0) return []
  const demand = s.community.housingDemand * HYDRO.townUseM3PerPersonSeason.value
  if (demand < 0.9 * works * HYDRO.waterworksCapacityM3.value) return []
  const centre = villageCentre(s)
  const sites = cellsWhere(s, (i) => s.terrain.channelDistance[i] === 1 && s.layers.structure[i] === S.none && s.terrain.flowAccumulation[s.terrain.nearestChannel[i]] >= MAIN_RIVER_CELLS).sort(byDistance(s, centre))
  return [pickValid(s, (cells) => ({ type: 'waterworks', cells }), sites.slice(0, 300), 1)]
}

/** A reservoir on the main river close to the village. */
function reservoirNearVillage(s: SimulationState): PlayerAction {
  const centre = villageCentre(s)
  const res = cellsWhere(s, (i) => s.terrain.channel[i] === 1 && s.terrain.flowAccumulation[i] > MAIN_RIVER_CELLS && s.layers.structure[i] === S.none).sort(byDistance(s, centre))
  return pickValid(s, (cells) => ({ type: 'reservoir', cells }), res.slice(0, 200), 1)
}

/** Grow food on flat grassland when the harvest falls short of a margin over need. */
function expandFarmsForFood(s: SimulationState, margin = 1.25, cells = 12): PlayerAction[] {
  const need = 2 * s.community.population * AGRI.foodPerPersonT.value
  const yearly = s.totals.foodProducedT + s.totals.foodProducedPrevT
  if (s.step % 2 !== 0 || yearly >= margin * need || s.economy.budget < 30_000) return []
  const centre = villageCentre(s)
  const flat = cellsWhere(s, (i) => s.layers.cover[i] === C.grassland && s.layers.structure[i] === S.none && s.terrain.slope[i] < 0.06 && s.terrain.heightAboveChannelM[i] > 3).sort(byDistance(s, centre))
  return [{ type: 'cropland', cells: flat.slice(0, cells), intensity: 'medium', irrigated: false }]
}

/**
 * Spend about `spend` on the erosion hotspots of the land, best saving per unit of money first:
 * terraces on gently sloping farms, agroforestry on steep farms, trees on steep grass or bare
 * land. Savings are judged from the erosion susceptibility overlay (a normal wet season).
 */
function restoreHotspots(s: SimulationState, spend: number): PlayerAction[] {
  if (spend < 5_000) return []
  const sus = erosionSusceptibility(s)
  const cap = ECON.capex.value
  const options: { i: number; type: 'conservation' | 'agroforestry' | 'reforest'; score: number; cost: number }[] = []
  for (let i = 0; i < sus.length; i++) {
    if (s.layers.structure[i] !== S.none || s.terrain.protected[i] || s.terrain.channel[i]) continue
    const c = s.layers.cover[i]
    const sl = s.terrain.slope[i]
    if (c === C.cropland && sl > 0.12) options.push({ i, type: 'agroforestry', score: (0.75 * sus[i]) / cap.agroforestry, cost: cap.agroforestry })
    else if (c === C.cropland && sl > 0.03 && !s.layers.conservation[i]) {
      const cost = cap.conservation * (1 + cap.conservationSlopeMult * sl)
      options.push({ i, type: 'conservation', score: ((1 - contouringP(sl)) * sus[i]) / cost, cost })
    } else if ((c === C.grassland || c === C.bare) && sl > 0.12) options.push({ i, type: 'reforest', score: (0.75 * sus[i]) / cap.reforest, cost: cap.reforest })
  }
  options.sort((a, b) => b.score - a.score)
  const chosen: Record<'conservation' | 'agroforestry' | 'reforest', number[]> = { conservation: [], agroforestry: [], reforest: [] }
  let left = spend
  for (const o of options) {
    if (o.cost > left) continue
    chosen[o.type].push(o.i)
    left -= o.cost
  }
  return (Object.keys(chosen) as (keyof typeof chosen)[]).filter((t) => chosen[t].length).map((t) => ({ type: t, cells: chosen[t] }))
}

/** Levy multiple a planned strategy uses: a richer fund, paid for in household livelihoods. */
export const FUNDED_LEVY_MULT = 2.5

/** Raise the cooperative levy (and local tax) to FUNDED_LEVY_MULT times the map's starting rate. */
function fundedLevy(s: SimulationState): PlayerAction {
  const rp = ECON.ratePolicy.value
  return { type: 'set-levy', rate: Math.min(rp.max, Math.max(rp.min, s.calibration.levy * FUNDED_LEVY_MULT)) }
}

/** The valid candidate cells of a cell action, trimmed to what `money` can pay for. */
function affordable(s: SimulationState, make: (cells: number[]) => PlayerAction, candidates: number[], money: number): PlayerAction {
  const v = validateAction(s, make(candidates))
  const ok = candidates.filter((_, j) => v.cellOk[j])
  if (!ok.length || v.cost <= money) return make(ok)
  return make(ok.slice(0, Math.max(0, Math.floor((ok.length * money) / v.cost))))
}

/** Borrow to keep building homes when people are being turned away. */
function financeHousing(s: SimulationState): PlayerAction[] {
  const c = s.community
  if (c.housingAdequacy < 0.95 && s.economy.budget < 40_000 && s.economy.debt < 200_000) return [{ type: 'loan', amount: 60_000 }]
  return []
}

// ------------------------------------------------------------------ strategies

/** Do nothing at all (reference). */
export const idleBot: Bot = () => []

/** Expansion: clear the forest on the land that drains to the village for farms. */
export const clearAndFarmBot: Bot = (s) => {
  const out: PlayerAction[] = [...ensureWaterworks(s)]
  const centre = villageCentre(s)
  const up = villageUpstream(s)
  if (s.step % 2 === 0 && s.step <= 12) {
    const targets = cellsWhere(s, (i) => s.layers.cover[i] === C.forest && up[i] === 1 && !s.terrain.protected[i] && s.terrain.slope[i] < 0.34).sort(byDistance(s, centre))
    out.push({ type: 'cropland', cells: targets.slice(0, 30), intensity: 'medium', irrigated: false })
  }
  out.push(...growWaterworks(s))
  out.push(...plannedHousing(s))
  out.push(...manageDebt(s))
  return out
}

/** Clear-cut: sell the timber of every unprotected forest cell in the first 3 years, then do nothing. */
export const clearCutBot: Bot = (s) => {
  if (s.step > 5) return []
  const forest = cellsWhere(s, (i) => s.layers.cover[i] === C.forest && !s.terrain.protected[i])
  return [{ type: 'clear', cells: forest }]
}

/** Intensification: same land, high inputs, irrigation from a new reservoir. */
export const intensifyBot: Bot = (s) => {
  const out: PlayerAction[] = [...ensureWaterworks(s)]
  if (once(s, 0)) {
    const crops = cellsWhere(s, (i) => s.layers.cover[i] === C.cropland)
    out.push({ type: 'set-intensity', cells: crops, intensity: 'high' })
    out.push(reservoirNearVillage(s))
  }
  if (once(s, 2)) {
    const crops = cellsWhere(s, (i) => s.layers.cover[i] === C.cropland && !s.layers.irrigated[i] && irrigationReachable(s, i)).slice(0, 25)
    out.push({ type: 'toggle-irrigation', cells: crops })
  }
  out.push(...growWaterworks(s))
  out.push(...plannedHousing(s))
  out.push(...manageDebt(s))
  return out
}

/** Agroforestry and terraces on hillside farms, trees on steep and bare land. */
export const agroforestryBot: Bot = (s) => {
  const out: PlayerAction[] = [...ensureWaterworks(s)]
  const centre = villageCentre(s)
  if (once(s, 0)) {
    const hill = cellsWhere(s, (i) => s.layers.cover[i] === C.cropland && s.terrain.slope[i] > 0.1)
    out.push({ type: 'agroforestry', cells: hill })
    const flatCrops = cellsWhere(s, (i) => s.layers.cover[i] === C.cropland && s.terrain.slope[i] > 0.04)
    out.push({ type: 'conservation', cells: flatCrops })
  }
  if (once(s, 2)) {
    const bare = cellsWhere(s, (i) => s.layers.cover[i] === C.bare && !s.terrain.protected[i])
    out.push({ type: 'reforest', cells: bare })
    const grass = cellsWhere(s, (i) => s.layers.cover[i] === C.grassland && s.terrain.slope[i] > 0.05 && s.terrain.slope[i] < 0.3 && dist(s, i, centre) < 16).sort(byDistance(s, centre))
    out.push({ type: 'agroforestry', cells: grass.slice(0, 30) })
  }
  if (once(s, 6)) {
    const flat = cellsWhere(s, (i) => s.layers.cover[i] === C.grassland && s.terrain.slope[i] < 0.06 && dist(s, i, centre) < 18).sort(byDistance(s, centre))
    out.push({ type: 'cropland', cells: flat.slice(0, 25), intensity: 'medium', irrigated: false })
  }
  out.push(...growWaterworks(s))
  out.push(...plannedHousing(s))
  out.push(...manageDebt(s))
  return out
}

/** Sprawl: fast low-density growth on the nearest flat land (floodplain and farms included), timber sales. */
export const sprawlBot: Bot = (s) => {
  const out: PlayerAction[] = [...ensureWaterworks(s)]
  const centre = villageCentre(s)
  if (s.step % 4 === 0 && s.step <= 16) {
    const forest = cellsWhere(s, (i) => s.layers.cover[i] === C.forest && !s.terrain.protected[i] && dist(s, i, centre) < 20).sort(byDistance(s, centre))
    out.push({ type: 'clear', cells: forest.slice(0, 20) })
  }
  if (once(s, 1)) {
    const near = cellsWhere(s, (i) => s.layers.structure[i] === S.none).sort(byDistance(s, centre))
    out.push(pickValid(s, (cells) => ({ type: 'market', cells }), near.slice(0, 200), 1))
  }
  out.push(...sprawlHousing(s))
  if (s.economy.budget < 5_000 && s.economy.debt < 200_000) out.push({ type: 'loan', amount: 50_000 })
  return out
}

/** Balanced restoration: riparian wetlands on the land that drains to the village, terraces,
 *  agroforestry and trees on the worst-eroding land (best saving per unit of money first), a
 *  reservoir for dry seasons with a few irrigated fields, planned housing financed with modest
 *  loans, a market, modest expansion on flats. */
export const balancedBot: Bot = (s) => {
  const out: PlayerAction[] = [...ensureWaterworks(s)]
  const centre = villageCentre(s)
  const up = villageUpstream(s)
  if (once(s, 0)) {
    out.push({ type: 'loan', amount: 150_000 })
    const wet = cellsWhere(
      s,
      (i) =>
        (s.layers.cover[i] === C.grassland || s.layers.cover[i] === C.cropland || s.layers.cover[i] === C.bare) &&
        up[i] === 1 &&
        s.terrain.channelDistance[i] <= 2 &&
        dist(s, i, centre) < 18,
    ).sort(byDistance(s, centre))
    out.push(pickValid(s, (cells) => ({ type: 'wetland', cells }), wet, 18))
  }
  if (once(s, 1)) out.push(...restoreHotspots(s, s.economy.budget + 150_000 - 150_000 - 80_000))
  if (once(s, 2)) out.push(reservoirNearVillage(s))
  if (once(s, 4)) {
    const flat = cellsWhere(s, (i) => s.layers.cover[i] === C.grassland && s.terrain.slope[i] < 0.05 && s.terrain.heightAboveChannelM[i] > 3 && dist(s, i, centre) < 16).sort(byDistance(s, centre))
    out.push({ type: 'cropland', cells: flat.slice(0, 20), intensity: 'medium', irrigated: false })
    const irr = cellsWhere(s, (i) => s.layers.cover[i] === C.cropland && !s.layers.irrigated[i] && s.terrain.slope[i] < 0.06 && irrigationReachable(s, i)).slice(0, 12)
    out.push({ type: 'toggle-irrigation', cells: irr })
  }
  if (once(s, 6)) {
    const near = cellsWhere(s, (i) => s.layers.structure[i] === S.none && s.terrain.heightAboveChannelM[i] > 4).sort(byDistance(s, centre))
    out.push(pickValid(s, (cells) => ({ type: 'market', cells }), near.slice(0, 200), 1))
  }
  if (s.step >= 8 && s.step <= 32 && s.step % 8 === 0) out.push(...restoreHotspots(s, 0.5 * (s.economy.budget - 80_000)))
  out.push(...financeHousing(s))
  out.push(...growWaterworks(s))
  out.push(...plannedHousing(s))
  out.push(...manageDebt(s, 80_000))
  return out
}

/** Drought-ready: water and food security first. A waterworks and a reservoir before anything
 *  else, terraces on the steepest 40 sloping farms so more rain soaks in, canal irrigation on the reachable
 *  farms and new canal-fed farms on reachable grassland, so a dry-season crop can be grown from stored water, plain farms on flat grassland
 *  whenever food runs below 1.8 times need, and planned housing. */
export const droughtReadyBot: Bot = (s) => {
  const out: PlayerAction[] = [...ensureWaterworks(s)]
  if (once(s, 0)) {
    out.push(reservoirNearVillage(s))
    // terraces on the steepest sloping farms first, keeping money back for more farms
    const sloped = cellsWhere(s, (i) => s.layers.cover[i] === C.cropland && s.terrain.slope[i] > 0.03 && s.terrain.slope[i] < 0.25).sort((a, b) => s.terrain.slope[b] - s.terrain.slope[a])
    out.push({ type: 'conservation', cells: sloped.slice(0, 40) })
  }
  if (s.step >= 2 && s.step % 4 === 2) {
    const irr = cellsWhere(s, (i) => s.layers.cover[i] === C.cropland && !s.layers.irrigated[i] && irrigationReachable(s, i)).slice(0, 30)
    out.push({ type: 'toggle-irrigation', cells: irr })
  }
  // new canal-fed farms on open grassland the canals can reach, so a dry-season and drought crop
  // can be grown from stored water
  if (s.step === 2 || s.step === 6) {
    const reach = cellsWhere(s, (i) => s.layers.cover[i] === C.grassland && s.layers.structure[i] === S.none && s.terrain.slope[i] < 0.08 && irrigationReachable(s, i))
    out.push(pickValid(s, (cells) => ({ type: 'cropland', cells, intensity: 'medium', irrigated: true }), reach.slice(0, 200), 15))
  }
  out.push(...expandFarmsForFood(s, 1.8, 20))
  out.push(...growWaterworks(s))
  out.push(...plannedHousing(s))
  out.push(...manageDebt(s))
  return out
}

/** Recovery: play clear-and-farm for the first years, then switch to restoration: raise the levy
 *  to pay for it, borrow, build a reservoir for drought, replant the cleared forest (steepest
 *  first, the rest as money comes in), fodder trees on the hillside farms, then treat the
 *  worst-eroding land, with fodder trees on sloping pasture while the herds outgrow it. Canals from the reservoir water the farms they reach, and new farms go
 *  on flat grassland when food runs short. */
export function recoveryBot(switchStep: number): Bot {
  const exForestFarms = (s: SimulationState) =>
    cellsWhere(s, (i) => s.layers.cover[i] === C.cropland && s.layers.baselineCover[i] === C.forest).sort((a, b) => s.terrain.slope[b] - s.terrain.slope[a])
  return (s) => {
    if (s.step < switchStep) return clearAndFarmBot(s)
    const out: PlayerAction[] = []
    if (s.step === switchStep) {
      out.push(fundedLevy(s))
      const loan = Math.min(200_000, ECON.maxDebt.value - s.economy.debt)
      if (loan > 0) out.push({ type: 'loan', amount: loan })
      const money = s.economy.budget + Math.max(0, loan) - 40_000 - ECON.capex.value.reservoir
      out.push(reservoirNearVillage(s))
      // what the agroforestry strategy does at the start: fodder trees on the steep farms, terraces
      // on the sloping ones, trees on bare land, fodder trees on the sloping pasture near town
      const centre = villageCentre(s)
      const hill = cellsWhere(s, (i) => s.layers.cover[i] === C.cropland && s.terrain.slope[i] > 0.1)
      out.push(affordable(s, (cells) => ({ type: 'agroforestry', cells }), hill, 0.45 * money))
      const sloped = cellsWhere(s, (i) => s.layers.cover[i] === C.cropland && s.terrain.slope[i] > 0.04 && s.terrain.slope[i] <= 0.1)
      out.push(affordable(s, (cells) => ({ type: 'conservation', cells }), sloped, 0.2 * money))
      const grass = cellsWhere(s, (i) => s.layers.cover[i] === C.grassland && s.terrain.slope[i] > 0.05 && s.terrain.slope[i] < 0.3 && dist(s, i, centre) < 16).sort(byDistance(s, centre))
      out.push(affordable(s, (cells) => ({ type: 'agroforestry', cells }), grass.slice(0, 30), 0.15 * money))
      out.push(affordable(s, (cells) => ({ type: 'reforest', cells }), exForestFarms(s), 0.2 * money))
    } else if (s.step % 2 === 0 && s.step <= 32 && s.economy.budget > 40_000) {
      // the rest of the cleared forest first, then the worst-eroding land
      const money = s.economy.budget - 30_000
      const left = exForestFarms(s)
      if (left.length) out.push(affordable(s, (cells) => ({ type: 'reforest', cells }), left, money))
      else if ((s.diagnostics.grazingPressure ?? 1) > 1.05) {
        // a bigger town runs bigger herds: fodder trees on sloping pasture feed them without
        // stripping the grass
        const centre = villageCentre(s)
        const pasture = cellsWhere(s, (i) => s.layers.cover[i] === C.grassland && s.layers.structure[i] === S.none && s.terrain.slope[i] > 0.04).sort((a, b) => s.terrain.slope[b] - s.terrain.slope[a] || dist(s, a, centre) - dist(s, b, centre))
        const v = validateAction(s, { type: 'agroforestry', cells: pasture })
        out.push(affordable(s, (cells) => ({ type: 'agroforestry', cells }), pasture.filter((_, j) => v.cellOk[j]).slice(0, 40), 0.5 * money))
      } else out.push(...restoreHotspots(s, 0.5 * money))
    }
    // get ready for the next drought, before more homes: canals from the reservoir to the farms
    // they reach, then canal-fed farms on reachable grassland
    if (s.step === switchStep + 1 || s.step === switchStep + 5) {
      const money = Math.max(0, s.economy.budget - 15_000)
      const irr = cellsWhere(s, (i) => s.layers.cover[i] === C.cropland && !s.layers.irrigated[i] && irrigationReachable(s, i)).slice(0, 30)
      const toggle = affordable(s, (cells) => ({ type: 'toggle-irrigation', cells }), irr, 0.5 * money)
      out.push(toggle)
      const spent = validateAction(s, toggle).cost
      const reach = cellsWhere(s, (i) => s.layers.cover[i] === C.grassland && s.layers.structure[i] === S.none && s.terrain.slope[i] < 0.08 && irrigationReachable(s, i))
      out.push(affordable(s, (cells) => ({ type: 'cropland', cells, intensity: 'medium', irrigated: true }), reach.slice(0, 15), money - spent))
    }
    out.push(...expandFarmsForFood(s, 1.25, 8))
    out.push(...growWaterworks(s))
    out.push(...plannedHousing(s))
    out.push(...manageDebt(s, 80_000))
    return out
  }
}

/** Planned restoration with a richer fund: the balanced strategy with the levy raised to
 *  FUNDED_LEVY_MULT times the starting rate from the first season. */
export const fundedBalancedBot: Bot = (s) => (s.step === 0 ? [fundedLevy(s), ...balancedBot(s)] : balancedBot(s))

/** Naive growth: homes (and a waterworks if the map has none), nothing for the land. */
export const housingOnlyBot: Bot = (s) => [...ensureWaterworks(s), ...plannedHousing(s), ...manageDebt(s)]

/** Naive growth with expansion: homes plus plain medium-input farms on flat grassland whenever
 *  food runs below 1.25 times need. No terraces, restoration, reservoir or wetlands. */
export const housingFarmsBot: Bot = (s) => [...ensureWaterworks(s), ...plannedHousing(s), ...expandFarmsForFood(s), ...manageDebt(s)]

export const STRATEGIES: Record<string, Bot> = {
  idle: idleBot,
  clearAndFarm: clearAndFarmBot,
  intensify: intensifyBot,
  agroforestry: agroforestryBot,
  sprawl: sprawlBot,
  balanced: balancedBot,
  clearCut: clearCutBot,
  droughtReady: droughtReadyBot,
}

/** Strategies that set the levy (kept apart so the seed-42 relations above stay at the starting rate). */
export const FUNDED: Record<string, Bot> = {
  fundedBalanced: fundedBalancedBot,
}

export const NAIVE: Record<string, Bot> = {
  housingOnly: housingOnlyBot,
  housingFarms: housingFarmsBot,
}
