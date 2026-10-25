// Hydrology: per-cell seasonal water balance with D8 routing, run-on infiltration, wetland
// retention, reservoir storage, town and irrigation withdrawals, outlet outflow, floodplain
// flooding, household self-supply (roof tanks and shallow wells), and a water ledger that
// closes to ~0 every step.
//
// Units: water depths are mm over one cell ("cell-mm"). 1 mm over a 1 ha cell = 10 m3.
// A season is split into TIME.subSteps sub-periods; routing processes cells in flowOrder
// (upstream first), all sub-periods of a cell at once, passing surface (quick) and
// subsurface (baseflow) water to the receiver cell.
//
// Runoff uses the USDA NRCS curve-number method (TR-55) applied to a fixed (non-random)
// distribution of storm sizes within each sub-period, with antecedent-moisture and slope
// adjustments as described in the SWAT theoretical documentation (Neitsch et al. 2011;
// slope adjustment after Williams 1995). ET follows the FAO-56 idea ETa = Ks * Kc * ET0.
import { CLIMATE, COMMUNITY, HYDRO, TIME, VEG } from '../params'
import type { Terrain, WaterLedger, WeatherSeason, WorldLayers } from '../types'
import { C, COVER_KEYS, I_HIGH, S, clamp, m3PerMm } from './cells'

export interface HydrologyInput {
  terrain: Terrain
  layers: WorldLayers
  weather: WeatherSeason
  reservoirM3: number
  reservoirCapacityM3: number
  townDemandM3: number
  /** 0..1 share of waterworks capacity available (budget shortages reduce it). */
  serviceLevel: number
  /** Normal groundwater level per cell; wells yield in proportion to how full it is. Omitted in spin-up (wells at full reliability). */
  groundwaterRefMm?: Float32Array
}

export interface HydrologyOutput {
  soilMoistureMm: Float32Array
  groundwaterMm: Float32Array
  wetlandStoreMm: Float32Array
  reservoirM3: number
  infiltrationMm: Float32Array
  runoffMm: Float32Array
  flowMm: Float32Array
  /** Max sub-period quick (surface) outflow from each cell, mm. */
  quickPeakMm: Float32Array
  /** Max sub-period peak flow index (quick x intensity^0.5 + baseflow), mm. Used for flooding. */
  peakFlowMm: Float32Array
  etMm: Float32Array
  etPotMm: Float32Array
  irrigationMm: Float32Array
  waterFactor: Float32Array
  flooded: Uint8Array
  floodDepthM: Float32Array
  ledger: WaterLedger
  townDemandM3: number
  /** Piped (waterworks, treated) household water, m3. */
  townSuppliedM3: number
  /** Roof tank and shallow well household water, m3. */
  selfSuppliedM3: number
  tankSuppliedM3: number
  wellSuppliedM3: number
  /** All household water delivered (piped + self-supply), m3. */
  householdSuppliedM3: number
  /** Mean groundwater over land cells and around homes, mm (after wells). */
  meanGroundwaterMm: number
  homeGroundwaterMm: number
  /** Surface water arriving from upslope at each cell over the season, mm. */
  surfaceInMm: Float32Array
  irrigationDemandM3: number
  irrigationSuppliedM3: number
  outflowM3: number
  /** Total flow passing waterworks intakes (before abstraction), m3. */
  intakeFlowM3: number
  /** Water flowing into reservoir cells this season, m3 (sets how much sediment they trap). */
  reservoirInflowM3: number
  intakeCells: number[]
  peakFloodRatio: number
  /** Max flood ratio at the drainage channel cells of housing cells near the river. */
  settlementFloodRatio: number
  uplandRunoffMm: number
  /** Precipitation actually falling on each cell this season (orographic adjustment), mm. */
  rainMm: Float32Array
}

/** Channel cells with at least this many upstream cells count as the main river. */
export const MAIN_RIVER_CELLS = 150

const CLS_LAND = 0
const CLS_CHANNEL = 1
const CLS_RESERVOIR = 2

/**
 * Relative rooting depth of a cell. Young tree plantings root like the grass they were planted
 * into and deepen toward the tree value as they mature (VEG.matureSeasons), so planting does
 * not suddenly change how much water the root zone holds.
 */
export function rootFactor(cover: number, coverAge = Number.POSITIVE_INFINITY): number {
  const rd = HYDRO.rootDepthFactor.value
  const full = rd[COVER_KEYS[cover]] ?? 1
  if (cover !== C.forest && cover !== C.agroforestry) return full
  const m = VEG.matureSeasons.value
  const mat = clamp(coverAge / (cover === C.forest ? m.forest : m.agroforestry), 0, 1)
  return rd.grassland + (full - rd.grassland) * mat
}

/** Root-zone water capacity (mm) for a cover and soil health (and cover age for young plantings). */
export function soilCapacityMm(cover: number, soilHealth: number, coverAge?: number): number {
  const root = rootFactor(cover, coverAge)
  const floor = HYDRO.soilCapacityHealthFloor.value
  return HYDRO.soilCapacityMm.value * root * (floor + (1 - floor) * clamp(soilHealth, 0, 1))
}

/** True if a crop is grown on the cell this season (dry-season cropping needs irrigation). */
export function cropActive(cover: number, irrigated: number, season: WeatherSeason['season']): boolean {
  if (cover === C.cropland) return season === 'wet' || irrigated === 1
  if (cover === C.agroforestry) return season === 'wet'
  return false
}

type CnKey = keyof typeof HYDRO.curveNumber.value

function cnKeyFor(cover: number, structure: number, level: number, conservation: number): CnKey | null {
  if (structure === S.road) return 'road'
  if (structure === S.housing) return level >= 2 ? 'housingDense' : 'housing'
  if (structure === S.market || structure === S.waterworks) return 'housingDense'
  switch (cover) {
    case C.forest:
      return 'forest'
    case C.grassland:
      return 'grassland'
    case C.cropland:
      return conservation ? 'croplandConservation' : 'cropland'
    case C.agroforestry:
      return 'agroforestry'
    case C.wetland:
      return 'wetland'
    case C.bare:
      return 'bare'
    case C.urban:
      return 'housing'
    default:
      return null
  }
}

/** Reference vegetation for "full cover" of a land use (for hydrologic condition and Kc scaling). */
export function fullVegetation(cover: number): number {
  const t = VEG.target.value
  switch (cover) {
    case C.forest:
      return t.forest.wet
    case C.grassland:
      return t.grassland.wet
    case C.cropland:
      return t.cropland.wet
    case C.agroforestry:
      return t.agroforestry.wet
    case C.wetland:
      return t.wetland.wet
    default:
      return 0.6
  }
}

/** Surface compaction 0..1 of a land cell: bare land that has not regrown cover (HYDRO.compaction). */
export function compaction(cover: number, structure: number, vegetation: number): number {
  if (cover !== C.bare || structure !== S.none) return 0
  return 1 - clamp(vegetation / HYDRO.compaction.value.recoveredVegetation, 0, 1)
}

/** Curve number (AMC II, slope adjusted) for a cell's current condition. */
export function curveNumberII(
  cover: number,
  structure: number,
  level: number,
  conservation: number,
  vegetation: number,
  soilHealth: number,
  slope: number,
): number {
  const key = cnKeyFor(cover, structure, level, conservation)
  if (!key) return 100
  const { good, poor } = HYDRO.curveNumber.value[key]
  const w = HYDRO.conditionWeights.value
  // bare land has no vegetation condition in the usual sense: its condition is how uncompacted it is
  const condition =
    cover === C.bare && structure === S.none
      ? 1 - compaction(cover, structure, vegetation)
      : clamp(w.vegetation * (vegetation / fullVegetation(cover)) + w.soil * (soilHealth / HYDRO.conditionSoilRef.value), 0, 1)
  const cn2 = poor + (good - poor) * condition
  // Williams (1995) slope adjustment as given in the SWAT theoretical documentation
  const cn3 = cn2 * Math.exp(0.00673 * (100 - cn2))
  return clamp(((cn3 - cn2) / 3) * (1 - 2 * Math.exp(-13.86 * slope)) + cn2, 30, 99)
}

/** Antecedent-moisture adjusted CN: interpolates CN1 (dry) .. CN2 .. CN3 (wet) by relative soil water. */
export function curveNumberAmc(cn2: number, wetness: number): number {
  const cn1 = cn2 - (20 * (100 - cn2)) / (100 - cn2 + Math.exp(2.533 - 0.0636 * (100 - cn2)))
  const cn3 = cn2 * Math.exp(0.00673 * (100 - cn2))
  const w = clamp(wetness, 0, 1)
  const full = w < 0.5 ? cn1 + (cn2 - cn1) * (w / 0.5) : cn2 + (cn3 - cn2) * ((w - 0.5) / 0.5)
  return cn2 + (full - cn2) * HYDRO.amcWeight.value
}

/** Runoff (mm) from rain p falling as nEvents storms of the configured size classes. */
export function curveNumberRunoff(p: number, nEvents: number, intensity: number, cn: number): number {
  if (p <= 0) return 0
  const sMax = 25.4 * (1000 / cn - 10)
  const ia = HYDRO.initialAbstractionRatio.value * sMax
  const events = Math.max(1, nEvents / intensity)
  const mean = p / events
  let q = 0
  for (const c of CLIMATE.eventClasses.value) {
    const d = mean * c.depthMult
    if (d > ia) q += events * c.frac * ((d - ia) * (d - ia)) / (d - ia + sMax)
  }
  return Math.min(q, p)
}

/** Effective crop coefficient for a cell this season. */
export function cellKc(cover: number, structure: number, intensity: number, irrigated: number, vegetation: number, season: WeatherSeason['season']): number {
  if (cover === C.cropland) {
    if (!cropActive(cover, irrigated, season)) return HYDRO.kcFallow.value
    return HYDRO.kc.value.cropland * (intensity === I_HIGH ? HYDRO.kcHighIntensityMult.value : 1)
  }
  if (structure === S.road) return HYDRO.kc.value.urban * HYDRO.roadKcMult.value
  const kcFull = HYDRO.kc.value[COVER_KEYS[cover]] ?? HYDRO.kcSoil.value
  const soil = HYDRO.kcSoil.value
  if (cover === C.urban || cover === C.bare) return kcFull
  return soil + (kcFull - soil) * clamp(vegetation / fullVegetation(cover), 0, 1)
}

/** Share of the town's residents living in each housing cell (by density level). */
export function residentShares(structure: Uint8Array, structureLevel: Uint8Array): Float64Array {
  const per = COMMUNITY.housingCapacity.value
  const out = new Float64Array(structure.length)
  let total = 0
  for (let i = 0; i < structure.length; i++) {
    if (structure[i] !== S.housing) continue
    out[i] = per[structureLevel[i]] ?? 0
    total += out[i]
  }
  if (total > 0) for (let i = 0; i < out.length; i++) out[i] /= total
  return out
}

/** Mean of a per-cell array over the land cells within radius r of i (wells draw from this neighbourhood). */
function neighbourhood(width: number, height: number, i: number, r: number, land: Uint8Array): number[] {
  const x = i % width
  const z = (i - x) / width
  const out: number[] = []
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx
      const nz = z + dz
      if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue
      const j = nz * width + nx
      if (land[j]) out.push(j)
    }
  }
  return out
}

/** Waterworks intake cells: the adjacent channel cell with the largest contributing area. */
export function waterworksIntakes(terrain: Terrain, structure: Uint8Array): { cell: number; intake: number }[] {
  const { width, height } = terrain
  const out: { cell: number; intake: number }[] = []
  for (let i = 0; i < structure.length; i++) {
    if (structure[i] !== S.waterworks) continue
    const x = i % width
    const z = (i - x) / width
    let best = -1
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        const nz = z + dz
        if ((!dx && !dz) || nx < 0 || nz < 0 || nx >= width || nz >= height) continue
        const j = nz * width + nx
        if (terrain.channel[j] && (best < 0 || terrain.flowAccumulation[j] > terrain.flowAccumulation[best])) best = j
      }
    }
    if (best >= 0) out.push({ cell: i, intake: best })
  }
  return out
}

export function runHydrology(input: HydrologyInput): HydrologyOutput {
  const { terrain, layers, weather } = input
  const { flowTo, flowOrder, slope } = terrain
  const n = terrain.width * terrain.height
  const SS = TIME.subSteps.value
  const toM3 = m3PerMm(terrain)
  const season = weather.season
  const fracs = CLIMATE.subStepRainFrac.value[season]
  const nEvSeason = CLIMATE.eventsPerSeason.value[season]
  const pet = weather.petMm / SS
  const kbSub = 1 - Math.pow(1 - HYDRO.baseflowPerSeason.value, 1 / SS)
  const wl = HYDRO.wetland.value
  const wrSub = 1 - Math.pow(1 - wl.releasePerSeason, 1 / SS)
  const pDep = HYDRO.depletionFraction.value
  const rc = HYDRO.rechargeCoef.value
  const runOnCap = HYDRO.runOnCapMm.value
  const kw = HYDRO.openWaterKc.value
  const eff = HYDRO.irrigationEfficiency.value
  const comp = HYDRO.compaction.value
  const chEv = HYDRO.channelEvap.value

  const { cover, structure, structureLevel, intensity, conservation, irrigated, soilHealth, vegetation } = layers

  // orographic rainfall
  let meanElev = 0
  for (let i = 0; i < n; i++) meanElev += terrain.elevationM[i]
  meanElev /= n
  const rainMm = new Float32Array(n)
  const [oroLo, oroHi] = HYDRO.orographicBounds.value
  for (let i = 0; i < n; i++) {
    rainMm[i] = weather.rainfallMm * clamp(1 + CLIMATE.orographicPerM.value * (terrain.elevationM[i] - meanElev), oroLo, oroHi)
  }

  const cls = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (structure[i] === S.reservoir) cls[i] = CLS_RESERVOIR
    else if (terrain.channel[i] || cover[i] === C.water) cls[i] = CLS_CHANNEL
    else cls[i] = CLS_LAND
  }

  const sm = layers.soilMoistureMm.slice()
  const gw = layers.groundwaterMm.slice()
  const ws = layers.wetlandStoreMm.slice()
  const sm0 = layers.soilMoistureMm
  const gw0 = layers.groundwaterMm
  const ws0 = layers.wetlandStoreMm
  for (let i = 0; i < n; i++) if (cover[i] !== C.wetland) ws[i] = 0
  // wetland water left on a converted cell drains with this step's flow
  let wetlandLeftover = 0
  for (let i = 0; i < n; i++) if (cover[i] !== C.wetland && ws0[i] > 0) wetlandLeftover += ws0[i]

  const resCapMm = input.reservoirCapacityM3 / toM3
  let resStore = input.reservoirM3 / toM3
  const resStore0 = resStore
  // storage above capacity (after demolition or silting) is released downstream this step
  const resExcess = Math.max(0, resStore - resCapMm)
  resStore -= resExcess

  // --- pre-pass: irrigation demand estimate on irrigated, cropped cells
  const irrDemandMm = new Float32Array(n)
  let irrDemand = 0
  for (let i = 0; i < n; i++) {
    if (cls[i] !== CLS_LAND || !irrigated[i] || !cropActive(cover[i], irrigated[i], season)) continue
    const etm = cellKc(cover[i], structure[i], intensity[i], irrigated[i], vegetation[i], season) * weather.petMm
    const deficit = Math.max(0, etm - (sm0[i] + HYDRO.irrigationRainCredit.value * rainMm[i]))
    irrDemandMm[i] = deficit / eff
    irrDemand += irrDemandMm[i]
  }

  // --- household demand per home cell, and roof tanks (rain caught before it reaches the ground)
  const sup = HYDRO.selfSupply.value
  const perCapita = HYDRO.townUseM3PerPersonSeason.value
  const townDemand = input.townDemandM3 / toM3
  const shares = residentShares(structure, structureLevel)
  const homeDemand = new Float64Array(n)
  const tankMm = new Float64Array(n)
  let tankTotal = 0
  for (let i = 0; i < n; i++) {
    if (shares[i] <= 0 || cls[i] !== CLS_LAND) continue
    homeDemand[i] = townDemand * shares[i]
    const residents = (homeDemand[i] * toM3) / perCapita
    const caught = (rainMm[i] * sup.roofM2PerPerson * residents * sup.roofRunoffCoef) / 1000 // m3
    tankMm[i] = Math.min(caught, sup.tankM3PerPersonSeason * residents, homeDemand[i] * toM3) / toM3
    tankTotal += tankMm[i]
  }
  const pipedDemand = Math.max(0, townDemand - tankTotal)

  // --- intakes and capacity: treated household capacity and raw-water irrigation diversion
  const intakes = waterworksIntakes(terrain, structure)
  const service = clamp(input.serviceLevel, 0, 1)
  const capPerWorks = (HYDRO.waterworksCapacityM3.value * service) / toM3
  const irrCapPerWorks = (HYDRO.irrigationDiversionM3.value * service) / toM3
  const intakeCapSub = new Float64Array(n)
  for (const w of intakes) intakeCapSub[w.intake] += (capPerWorks + irrCapPerWorks) / SS
  const totalCap = capPerWorks * intakes.length
  const totalIrrCap = irrCapPerWorks * intakes.length
  const plannedRiver = Math.min(pipedDemand, totalCap) + Math.min(irrDemand, totalIrrCap)
  const remainingSub = new Float64Array(SS).fill(plannedRiver / SS)
  let riverTaken = 0
  let intakeFlow = 0
  let reservoirInflow = 0

  // --- routing arrays
  const qIn = new Float64Array(n * SS)
  const bIn = new Float64Array(n * SS)
  const infiltrationMm = new Float32Array(n)
  const runoffMm = new Float32Array(n)
  const flowMm = new Float32Array(n)
  const quickPeakMm = new Float32Array(n)
  const peakFlowMm = new Float32Array(n)
  const peakAdj = Math.pow(weather.stormIntensity, HYDRO.flood.value.intensityExponent)
  const etMm = new Float32Array(n)
  const etPotMm = new Float32Array(n)
  const surfaceInMm = new Float32Array(n)

  let sumRain = 0
  let sumEt = 0
  let outflow = wetlandLeftover + resExcess // released stores leave as outflow (keeps ledger closed)
  let sumInfil = 0
  // Leftover wetland water is treated as leaving the basin this step: we add it to outflow
  // and the wetland storage change records its loss.

  for (let o = 0; o < n; o++) {
    const i = flowOrder[o]
    const t = flowTo[i]
    const c = cls[i]
    const isWet = cover[i] === C.wetland
    // land parameters for this cell
    let cap = 0
    let cn2 = 100
    let kc = 0
    let ro = 0
    let compact = 0
    if (c === CLS_LAND) {
      compact = compaction(cover[i], structure[i], vegetation[i])
      cap = soilCapacityMm(cover[i], soilHealth[i], layers.coverAge[i])
      cn2 = curveNumberII(cover[i], structure[i], structureLevel[i], conservation[i], vegetation[i], soilHealth[i], slope[i])
      kc = cellKc(cover[i], structure[i], intensity[i], irrigated[i], vegetation[i], season)
      ro = HYDRO.runOnFrac.value[COVER_KEYS[cover[i]]] ?? 0
      if (structure[i] !== S.none) ro = HYDRO.runOnFrac.value.urban
      if (cover[i] === C.cropland && conservation[i]) ro = HYDRO.runOnConservationFrac.value
    }
    let smi = sm[i]
    let gwi = gw[i]
    let wsi = ws[i]
    if (c !== CLS_LAND && smi + gwi > 0) {
      // soil water stranded under a new reservoir or channel joins its flow
      bIn[i * SS] += smi + gwi
      smi = 0
      gwi = 0
    }
    for (let k = 0; k < SS; k++) {
      const idx = i * SS + k
      const qi = qIn[idx]
      const bi = bIn[idx]
      const pAll = rainMm[i] * fracs[k]
      sumRain += pAll
      // roof tanks catch part of the rain on home cells before it reaches the ground
      const p = pAll - tankMm[i] * fracs[k]
      surfaceInMm[i] += qi
      let outQ = 0
      let outB = 0
      if (c === CLS_CHANNEL) {
        // a river narrows as its flow drops (hydraulic geometry); lakes keep their full surface
        const wetted = terrain.channel[i]
          ? chEv.maxShare * Math.min(1, Math.pow((p + qi + bi) / (chEv.fullWidthFlowMmPerCell * Math.max(1, terrain.flowAccumulation[i])), chEv.widthExponent))
          : 1
        const e = Math.min(kw * pet * wetted, p + qi + bi)
        const eQ = Math.min(e, p + qi)
        outQ = p + qi - eQ
        outB = bi - (e - eQ)
        sumEt += e
        etMm[i] += e
        etPotMm[i] += kw * pet * wetted
      } else if (c === CLS_RESERVOIR) {
        const inflow = p + qi + bi
        reservoirInflow += inflow
        const release = HYDRO.reservoir.value.envReleaseFrac * inflow
        const capturable = inflow - release
        const capture = Math.min(capturable, Math.max(0, resCapMm - resStore))
        resStore += capture
        let spill = capturable - capture
        const e = Math.min(resStore, kw * pet)
        resStore -= e
        sumEt += e
        etMm[i] += e
        etPotMm[i] += kw * pet
        if (resStore > resCapMm) {
          spill += resStore - resCapMm
          resStore = resCapMm
        }
        const out = release + spill
        const qShare = inflow > 0 ? (p + qi) / inflow : 0
        outQ = out * qShare
        outB = out - outQ
      } else {
        // land cell
        if (smi > cap) {
          gwi += smi - cap
          smi = cap
        }
        const wetness = cap > 0 ? smi / cap : 1
        const cn = curveNumberAmc(cn2, wetness)
        let q = curveNumberRunoff(p, nEvSeason * fracs[k], weather.stormIntensity, cn)
        const runon = Math.min(qi * ro, runOnCap * Math.max(0, 1 - wetness))
        // a compacted surface sheds part of what the shallow root zone cannot hold (saturation excess)
        const room = Math.max(0, cap - smi)
        const excess = Math.max(0, p - q + runon - room)
        q += Math.min(p - q, excess * comp.saturationExcessShare * compact)
        const inf = p - q
        smi += inf + runon
        let rch = rc * (1 - (1 - comp.rechargeMult) * compact) * (inf + runon) * (cap > 0 ? Math.min(1, smi / cap) : 1)
        rch = Math.min(rch, smi)
        smi -= rch
        if (smi > cap) {
          rch += smi - cap
          smi = cap
        }
        gwi += rch
        const etm = kc * pet
        const ks = cap > 0 ? Math.min(1, smi / ((1 - pDep) * cap)) : 0
        const eta = Math.min(smi, etm * ks)
        smi -= eta
        const bRel = gwi * kbSub
        gwi -= bRel
        outQ = q + qi - runon
        outB = bi + bRel
        let etCell = eta
        if (isWet) {
          const capture = Math.min(outQ * wl.captureFrac, Math.max(0, wl.capacityMm - wsi))
          wsi += capture
          outQ -= capture
          const evapW = Math.min(wsi, Math.max(0, HYDRO.kc.value.wetland * pet - eta))
          wsi -= evapW
          etCell += evapW
          const rel = wsi * wrSub
          wsi -= rel
          outB += rel
        }
        sumEt += etCell
        etMm[i] += etCell
        etPotMm[i] += etm
        infiltrationMm[i] += inf + runon
        runoffMm[i] += q
        sumInfil += inf + runon
      }
      // abstraction at waterworks intakes (channel cells)
      if (intakeCapSub[i] > 0) {
        intakeFlow += outQ + outB
        const avail = (outQ + outB) * HYDRO.envFlowLimit.value
        const take = Math.max(0, Math.min(remainingSub[k], intakeCapSub[i], avail))
        remainingSub[k] -= take
        riverTaken += take
        const fromB = Math.min(take, outB)
        outB -= fromB
        outQ -= take - fromB
      }
      if (outQ > quickPeakMm[i]) quickPeakMm[i] = outQ
      const pk = outQ * peakAdj + outB
      if (pk > peakFlowMm[i]) peakFlowMm[i] = pk
      flowMm[i] += outQ + outB
      if (t >= 0) {
        qIn[t * SS + k] += outQ
        bIn[t * SS + k] += outB
      } else {
        outflow += outQ + outB
      }
    }
    sm[i] = smi
    gw[i] = gwi
    ws[i] = wsi
  }

  // --- allocate abstracted water: households first (treated capacity), then irrigation
  // (diversion capacity); the reservoir covers shortfalls (households only through spare
  // treatment capacity, irrigation only above the domestic reserve)
  const townFromRiver = Math.min(pipedDemand, riverTaken, totalCap)
  const irrFromRiver = Math.min(riverTaken - townFromRiver, totalIrrCap)
  // any planned take that could not be used (should not happen) goes back to the river outflow
  outflow += riverTaken - townFromRiver - irrFromRiver
  const townShort = pipedDemand - townFromRiver
  const treatmentSpare = Math.max(0, totalCap - townFromRiver)
  const townFromRes = totalCap > 0 ? Math.min(townShort, resStore, treatmentSpare) : 0
  resStore -= townFromRes
  const reserve = HYDRO.reservoir.value.domesticReserveFrac * resCapMm
  const irrFromRes = Math.min(Math.max(0, irrDemand - irrFromRiver), Math.max(0, resStore - reserve))
  resStore -= irrFromRes
  const townSupplied = townFromRiver + townFromRes
  const irrSupplied = irrFromRiver + irrFromRes

  // --- shallow wells near homes cover what tanks and pipes did not, limited by how full the
  // local groundwater is compared with its normal level
  const isLand = new Uint8Array(n)
  for (let i = 0; i < n; i++) isLand[i] = cls[i] === CLS_LAND ? 1 : 0
  const pipedShare = pipedDemand > 0 ? townSupplied / pipedDemand : 1
  let wellTotal = 0
  let homeGw = 0
  let homeGwN = 0
  for (let i = 0; i < n; i++) {
    if (homeDemand[i] <= 0) continue
    const short = Math.max(0, homeDemand[i] - tankMm[i] - (homeDemand[i] - tankMm[i]) * pipedShare)
    const hood = neighbourhood(terrain.width, terrain.height, i, sup.wellRadiusCells, isLand)
    let stored = 0
    let ref = 0
    for (const j of hood) {
      stored += gw[j]
      ref += input.groundwaterRefMm ? input.groundwaterRefMm[j] : gw[j]
    }
    homeGw += hood.length ? stored / hood.length : 0
    homeGwN++
    if (short <= 0 || stored <= 0) continue
    const reliability = ref > 0 ? clamp(stored / ref, 0, 1) : 0
    const draw = Math.min(short, sup.wellShareMax * homeDemand[i] * reliability, sup.wellDrawFrac * stored)
    if (draw <= 0) continue
    for (const j of hood) gw[j] -= draw * (gw[j] / stored)
    wellTotal += draw
  }
  const selfSupplied = tankTotal + wellTotal

  // --- apply irrigation: effective share to the root zone (consumed by ET first), rest seeps
  const irrigationMm = new Float32Array(n)
  let irrEt = 0
  if (irrDemand > 0 && irrSupplied > 0) {
    const share = irrSupplied / irrDemand
    for (let i = 0; i < n; i++) {
      if (irrDemandMm[i] <= 0) continue
      const a = irrDemandMm[i] * share
      irrigationMm[i] = a
      const effective = a * eff
      gw[i] += a - effective
      const extraEt = Math.min(effective, Math.max(0, etPotMm[i] - etMm[i]))
      etMm[i] += extraEt
      irrEt += extraEt
      sm[i] += effective - extraEt
      const cap = soilCapacityMm(cover[i], soilHealth[i], layers.coverAge[i])
      if (sm[i] > cap) {
        gw[i] += sm[i] - cap
        sm[i] = cap
      }
    }
  }
  sumEt += irrEt

  let gwLand = 0
  let landN = 0
  for (let i = 0; i < n; i++) {
    if (!isLand[i]) continue
    gwLand += gw[i]
    landN++
  }

  // --- water factor (relative ET) and upland runoff diagnostic
  const waterFactor = new Float32Array(n)
  let uplandQ = 0
  let uplandN = 0
  for (let i = 0; i < n; i++) {
    waterFactor[i] = cls[i] === CLS_LAND && etPotMm[i] > 0 ? clamp(etMm[i] / etPotMm[i], 0, 1) : 1
    if (cls[i] === CLS_LAND && terrain.heightAboveChannelM[i] > HYDRO.uplandHandM.value) {
      uplandQ += runoffMm[i]
      uplandN++
    }
  }

  // --- flooding: peak quick flow vs bankfull at the drainage channel cell
  const fp = HYDRO.flood.value
  const flooded = new Uint8Array(n)
  const floodDepthM = new Float32Array(n)
  let peakFloodRatio = 0
  const ratio = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    if (!terrain.channel[i] || terrain.bankfullMm[i] <= 0) continue
    ratio[i] = peakFlowMm[i] / terrain.bankfullMm[i]
    // the headline ratio is for the main river (large catchment), not tiny headwater rills
    if (terrain.flowAccumulation[i] >= MAIN_RIVER_CELLS && ratio[i] > peakFloodRatio) peakFloodRatio = ratio[i]
  }
  let settlementFloodRatio = 0
  for (let i = 0; i < n; i++) {
    if (cls[i] !== CLS_LAND) continue
    const d = terrain.nearestChannel[i]
    if (structure[i] === S.housing && d >= 0 && terrain.channelDistance[i] <= fp.maxDistanceCells && ratio[d] > settlementFloodRatio) settlementFloodRatio = ratio[d]
    if (d < 0 || terrain.channelDistance[i] > fp.maxDistanceCells || ratio[d] <= 1) continue
    const depth = Math.min(fp.maxDepthM, (ratio[d] - 1) * fp.depthPerRatioM)
    const over = depth - terrain.heightAboveChannelM[i]
    if (over > 0) {
      flooded[i] = 1
      floodDepthM[i] = over
    }
  }

  // --- ledger (basin-mean mm)
  let dSm = 0
  let dGw = 0
  let dWs = 0
  for (let i = 0; i < n; i++) {
    dSm += sm[i] - sm0[i]
    dGw += gw[i] - gw0[i]
    dWs += ws[i] - ws0[i]
  }
  const dRes = resStore - resStore0
  const sinks = sumEt + townSupplied + selfSupplied + outflow + dSm + dGw + dWs + dRes
  const ledger: WaterLedger = {
    rainMm: sumRain / n,
    infiltrationMm: sumInfil / n,
    evapotranspirationMm: sumEt / n,
    storageChangeMm: dSm / n,
    withdrawalsMm: (townSupplied + selfSupplied) / n,
    outflowMm: outflow / n,
    wetlandRetentionMm: dWs / n,
    reservoirStorageChangeMm: dRes / n,
    groundwaterChangeMm: dGw / n,
    irrigationMm: irrSupplied / n,
    residualMm: (sumRain - sinks) / n,
  }

  return {
    soilMoistureMm: sm,
    groundwaterMm: gw,
    wetlandStoreMm: ws,
    reservoirM3: resStore * toM3,
    infiltrationMm,
    runoffMm,
    flowMm,
    quickPeakMm,
    peakFlowMm,
    etMm,
    etPotMm,
    irrigationMm,
    waterFactor,
    flooded,
    floodDepthM,
    ledger,
    townDemandM3: input.townDemandM3,
    townSuppliedM3: townSupplied * toM3,
    selfSuppliedM3: selfSupplied * toM3,
    tankSuppliedM3: tankTotal * toM3,
    wellSuppliedM3: wellTotal * toM3,
    householdSuppliedM3: (townSupplied + selfSupplied) * toM3,
    meanGroundwaterMm: landN ? gwLand / landN : 0,
    homeGroundwaterMm: homeGwN ? homeGw / homeGwN : 0,
    surfaceInMm,
    irrigationDemandM3: irrDemand * toM3,
    irrigationSuppliedM3: irrSupplied * toM3,
    outflowM3: outflow * toM3,
    intakeFlowM3: intakeFlow * toM3,
    reservoirInflowM3: reservoirInflow * toM3,
    intakeCells: intakes.map((w) => w.intake),
    peakFloodRatio,
    settlementFloodRatio,
    uplandRunoffMm: uplandN > 0 ? uplandQ / uplandN : 0,
    rainMm,
  }
}

/** Bankfull capacity from a reference (normal wet season) run: factor x peak flow index. */
export function bankfullFromReference(terrain: Terrain, reference: HydrologyOutput): Float32Array {
  const n = terrain.width * terrain.height
  const out = new Float32Array(n)
  const f = HYDRO.flood.value.bankfullFactor
  for (let i = 0; i < n; i++) {
    if (!terrain.channel[i]) continue
    const floor = 2 * Math.sqrt(terrain.flowAccumulation[i])
    out[i] = f * Math.max(reference.peakFlowMm[i], floor)
  }
  return out
}
