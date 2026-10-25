// Grounded explanations. Every claim cites simulated values (before and after), and every
// explanation says which part of a change came from exogenous weather and which from the
// state of the land, which the player's decisions shape. No free text is invented: each
// sentence is assembled from the numbers in `evidence`.
import { AGRI, COMMUNITY, HYDRO, SOIL, TIME, VEG } from '../params'
import type { DecisionRecord, Explanation, HistoryPoint, SimulationState, WeatherSeason } from '../types'
import { C, S } from '../models/cells'
import { contouringP } from '../models/soil'
import type { SeasonOutcome } from './season'

type Ev = Explanation['evidence'][number]

const r0 = (v: number) => Math.round(v)
const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round(v * 100) / 100
const pct = (v: number) => `${Math.round(v * 100)}%`
const num = (v: number) => Math.round(v).toLocaleString('en-US')
/** Seasons to years for prose, without trailing zeros. */
const years = (seasons: number) => `${Math.round((seasons / TIME.seasonsPerYear.value) * 10) / 10}`
const change = (before: number, after: number) => (before !== 0 ? (after - before) / Math.abs(before) : after > 0 ? 1 : 0)

interface Ctx {
  prev: SimulationState
  next: SimulationState
  w: WeatherSeason
  out: SeasonOutcome
  year: number
  season: WeatherSeason['season']
  decisions: DecisionRecord[]
  /** Last recorded point for the same season one year earlier (if any). */
  lastYear: HistoryPoint | null
  list: Explanation[]
}

function push(ctx: Ctx, e: Omit<Explanation, 'id' | 'year' | 'season'>): void {
  ctx.list.push({ id: `s${ctx.prev.step + 1}-${e.topic}-${ctx.list.length}`, year: ctx.year, season: ctx.season, ...e })
}

function weatherPhrase(w: WeatherSeason): string {
  const diff = change(w.normalRainfallMm, w.rainfallMm)
  if (w.kind === 'drought') return `drought cut rainfall to ${r0(w.rainfallMm)} mm, ${pct(-diff)} below the ${r0(w.normalRainfallMm)} mm normal (weather)`
  if (w.kind === 'heavy-rain') return `heavy rain brought ${r0(w.rainfallMm)} mm in storms ${r2(w.stormIntensity)} times as intense as usual (weather)`
  if (w.kind === 'favorable') return `a favourable season brought ${r0(w.rainfallMm)} mm of well spread rain (weather)`
  return `rainfall was ${r0(w.rainfallMm)} mm against a ${r0(w.normalRainfallMm)} mm normal (weather)`
}

/** Short list of the player's land decisions since the last step. */
function decisionSummary(ds: DecisionRecord[]): string {
  const counts = new Map<string, number>()
  for (const d of ds) {
    if (!('cells' in d.action)) continue
    counts.set(d.action.type, (counts.get(d.action.type) ?? 0) + d.action.cells.length)
  }
  return [...counts.entries()].map(([t, k]) => `${t} on ${k} cell${k === 1 ? '' : 's'}`).join(', ')
}

// ------------------------------------------------------------------ weather

function explainWeather(ctx: Ctx): void {
  const { w } = ctx
  if (w.kind === 'normal') return
  const ev: Ev[] = [
    { label: 'Rainfall', before: w.normalRainfallMm, after: w.rainfallMm, unit: 'mm' },
    { label: 'Potential evapotranspiration', after: w.petMm, unit: 'mm' },
    { label: 'Storm intensity', before: 1, after: w.stormIntensity, unit: 'x' },
  ]
  const fixed = 'This weather was set by the scenario seed before you made any decision, so the same season reaches every future you try. Your land choices change how hard it hits, not whether it comes.'
  if (w.kind === 'drought') {
    push(ctx, {
      topic: 'event',
      severity: 'warning',
      title: `Drought: ${r0(w.rainfallMm)} mm of rain`,
      body: `${capital(weatherPhrase(w))}. ${droughtImpact(ctx)} ${fixed}`,
      evidence: ev,
    })
  } else if (w.kind === 'heavy-rain') {
    push(ctx, {
      topic: 'event',
      severity: 'warning',
      title: `Heavy rain: ${r0(w.rainfallMm)} mm`,
      body: `${capital(weatherPhrase(w))}. Big storms make far more runoff and erosion than the same rain spread out. ${fixed}`,
      evidence: ev,
    })
  } else {
    push(ctx, { topic: 'event', severity: 'good', title: `Good growing season: ${r0(w.rainfallMm)} mm`, body: `${capital(weatherPhrase(w))}. ${fixed}`, evidence: ev })
  }
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** What the drought did to crops or water, from simulated values only. */
function droughtImpact(ctx: Ctx): string {
  const { w, out, next } = ctx
  if (w.season === 'wet') return `Rainfed crops got ${pct(out.diagnostics.meanCropWaterFactorRainfed)} of the water they needed.`
  const h = out.hydro
  const homes = `Households got ${pct(next.community.waterSecurity)} of the water they needed (${num(h.householdSuppliedM3)} of ${num(h.townDemandM3)} m³).`
  if (h.irrigationDemandM3 > 0) return `Irrigation met ${pct(h.irrigationSuppliedM3 / h.irrigationDemandM3)} of demand (${num(h.irrigationSuppliedM3)} of ${num(h.irrigationDemandM3)} m³). ${homes}`
  return `No fields are irrigated, so rainfed farmland lies fallow in the dry season and grows nothing until the rains. ${homes}`
}

// ------------------------------------------------------------------ food

function explainFood(ctx: Ctx): void {
  const { next, prev, lastYear, w } = ctx
  const now = next.totals.foodProducedT
  const meaningful = 0.1 * next.totals.foodDemandT
  if (lastYear && Math.max(lastYear.foodProducedT, now) >= meaningful && lastYear.foodProducedT > 1 && now > 0.5) {
    const before = lastYear.foodProducedT
    const ch = change(before, now)
    if (Math.abs(ch) >= 0.12) {
      const d = next.diagnostics
      const parts: { label: string; share: number; text: string; ev: Ev }[] = []
      const add = (label: string, b: number, a: number, text: string, unit?: string) => {
        if (b > 0 && a > 0) parts.push({ label, share: Math.log(a / b), text, ev: { label, before: r2(b), after: r2(a), unit } })
      }
      const rainDiff = Math.abs(change(lastYear.rainfallMm, w.rainfallMm)) > 0.15
      add(
        'Crop water factor',
        lastYear.meanCropWaterFactor,
        d.meanWaterFactor,
        rainDiff
          ? `the crop water factor moved from ${r2(lastYear.meanCropWaterFactor)} to ${r2(d.meanWaterFactor)} as ${weatherPhrase(w)} (it was ${r0(lastYear.rainfallMm)} mm a year earlier)`
          : `the crop water factor moved from ${r2(lastYear.meanCropWaterFactor)} to ${r2(d.meanWaterFactor)} with similar rain, so soil water and irrigation supply made the difference (land and water management)`,
      )
      const hill = lastYear.hillsideCropSoil > 0 && d.hillsideCropSoil > 0 ? `; soil health on hillside farms went from ${r2(lastYear.hillsideCropSoil)} to ${r2(d.hillsideCropSoil)}` : ''
      add(
        'Crop soil factor',
        lastYear.meanCropSoilFactor,
        d.meanSoilFactor,
        `the average soil factor on farms went from ${r2(lastYear.meanCropSoilFactor)} to ${r2(d.meanSoilFactor)}${hill} (land condition, shaped by erosion, farming intensity and conservation)`,
      )
      add(
        'Cropped fields',
        lastYear.activeCropCells,
        d.activeCropCells,
        `cropped fields went from ${num(lastYear.activeCropCells)} to ${num(d.activeCropCells)} ha (your land-use decisions)`,
        'ha',
      )
      add(
        'Management factor',
        lastYear.meanCropManagementFactor,
        d.meanManagementFactor,
        prev.economy.serviceLevel < 1
          ? `the farm program was only ${pct(prev.economy.serviceLevel)} funded, so the management factor went from ${r2(lastYear.meanCropManagementFactor)} to ${r2(d.meanManagementFactor)} (budget shortfall)`
          : `the management factor went from ${r2(lastYear.meanCropManagementFactor)} to ${r2(d.meanManagementFactor)} (your intensity and conservation choices)`,
      )
      add(
        'Flood and sediment factor',
        lastYear.meanCropEventFactor,
        d.meanEventFactor,
        `flooding and sediment on fields moved the event factor from ${r2(lastYear.meanCropEventFactor)} to ${r2(d.meanEventFactor)} (${d.floodedCropCells} fields flooded)`,
      )
      const ranked = parts.filter((p) => Math.abs(p.share) >= 0.03).sort((a, b) => Math.abs(b.share) - Math.abs(a.share))
      const drivers = ranked.filter((p) => Math.sign(p.share) === Math.sign(ch)).slice(0, 3)
      const offsets = ranked.filter((p) => Math.sign(p.share) !== Math.sign(ch)).slice(0, 1)
      const verb = ch < 0 ? 'fell' : 'rose'
      let body = `Harvest ${verb} ${pct(Math.abs(ch))} compared with the same season last year (${num(before)} t to ${num(now)} t)`
      body += drivers.length ? `: ${drivers.map((p) => p.text).join('; ')}.` : '.'
      if (offsets.length) body += ` Partly offsetting this, ${offsets[0].text}.`
      body += ' Harvest = cropped area x potential yield x soil factor x water factor x management factor x event factor.'
      const worst = lowestWaterCells(ctx)
      push(ctx, {
        topic: 'food',
        severity: ch < -0.25 ? 'critical' : ch < 0 ? 'warning' : 'good',
        title: `Harvest ${verb} ${pct(Math.abs(ch))}`,
        body,
        evidence: [{ label: 'Harvest', before: r0(before), after: r0(now), unit: 't' }, ...ranked.map((p) => p.ev)],
        cells: worst,
      })
    }
  }
  const fs0 = prev.community.foodSecurity
  const fs1 = next.community.foodSecurity
  if (fs1 < 0.9 && fs0 >= 0.9) {
    const need = 2 * prev.community.population * AGRI.foodPerPersonT.value
    push(ctx, {
      topic: 'food',
      severity: fs1 < 0.75 ? 'critical' : 'warning',
      title: `Food security fell to ${pct(fs1)}`,
      body: `Over the last two seasons the valley grew ${num(next.totals.foodProducedT + next.totals.foodProducedPrevT)} t against a need of ${num(need)} t for ${num(prev.community.population)} people. Households bought ${num(next.totals.foodImportedT)} t from outside, as much as their livelihoods (${pct(prev.community.livelihood)}) allowed, and paid ${num(next.community.foodImportCost ?? 0)} for it this season out of their incomes.`,
      evidence: [
        { label: 'Food security', before: r2(fs0), after: r2(fs1) },
        { label: 'Local food, two seasons', after: r0(next.totals.foodProducedT + next.totals.foodProducedPrevT), unit: 't' },
        { label: 'Food need, two seasons', after: r0(need), unit: 't' },
        { label: 'Imported', after: r0(next.totals.foodImportedT), unit: 't' },
        { label: 'Spent on bought food', after: r0(next.community.foodImportCost ?? 0) },
      ],
    })
  }
  // the farms stop feeding the town in a season that is not a drought: growth outran farmland
  const ss0 = prev.community.foodSelfSufficiency ?? 1
  const ss1 = next.community.foodSelfSufficiency ?? 1
  if (ss1 < 1 && ss0 >= 1 && ctx.w.kind !== 'drought' && prev.history[prev.history.length - 1]?.weather !== 'drought' && prev.step > 0) {
    const pop0 = prev.baseline.population
    const popNow = prev.community.population
    const crop0 = prev.history[0]?.cropAreaHa ?? next.totals.cropAreaHa
    push(ctx, {
      topic: 'food',
      severity: 'warning',
      title: `The valley's farms now grow ${pct(ss1)} of the food it needs`,
      body: `The weather was not the cause (${weatherPhrase(ctx.w)}). The town has grown from ${num(pop0)} to ${num(popNow)} people while farmland went from ${num(crop0)} to ${num(next.totals.cropAreaHa)} ha, so local harvests no longer cover the need. Households make up part of the gap with bought food, which costs ${num(AGRI.imports.value.pricePerT)} a tonne out of their incomes (${num(next.community.foodImportCost ?? 0)} this season). More or better-managed farmland, or agroforestry for income, closes the gap.`,
      evidence: [
        { label: 'Food grown / need', before: r2(ss0), after: r2(ss1) },
        { label: 'Population', before: r0(pop0), after: r0(popNow) },
        { label: 'Cropland', before: r0(crop0), after: r0(next.totals.cropAreaHa), unit: 'ha' },
        { label: 'Spent on bought food', after: r0(next.community.foodImportCost ?? 0) },
      ],
    })
  }
  if (fs1 >= 0.9 && fs0 < 0.9) {
    push(ctx, {
      topic: 'food',
      severity: 'good',
      title: `Food security recovered to ${pct(fs1)}`,
      body: `Local harvests over two seasons reached ${num(next.totals.foodProducedT + next.totals.foodProducedPrevT)} t for ${num(prev.community.population)} people.`,
      evidence: [{ label: 'Food security', before: r2(fs0), after: r2(fs1) }],
    })
  }
}

function lowestWaterCells(ctx: Ctx): number[] {
  const { next } = ctx
  const cells: number[] = []
  for (let i = 0; i < next.fields.yieldT.length; i++) if (next.fields.yieldT[i] > 0) cells.push(i)
  return cells.sort((a, b) => next.fields.waterFactor[a] - next.fields.waterFactor[b]).slice(0, 6)
}

// ------------------------------------------------------------------ water

function explainWater(ctx: Ctx): void {
  const { prev, next, out, w } = ctx
  const ws0 = prev.community.waterSecurity
  const ws1 = next.community.waterSecurity
  const h = out.hydro
  const evd: Ev[] = [
    { label: 'Household water security', before: r2(ws0), after: r2(ws1) },
    { label: 'Household demand', after: r0(h.townDemandM3), unit: 'm³' },
    { label: 'Household supply', after: r0(h.householdSuppliedM3), unit: 'm³' },
    { label: 'Piped from the waterworks', after: r0(h.townSuppliedM3), unit: 'm³' },
    { label: 'Roof tanks and shallow wells', after: r0(h.selfSuppliedM3), unit: 'm³' },
    { label: 'River flow at intakes', after: r0(h.intakeFlowM3), unit: 'm³' },
    { label: 'Piped water safe to drink', before: r2(prev.community.waterQuality ?? 1), after: r2(next.community.waterQuality ?? 1) },
    { label: 'Reservoir storage', before: r0(prev.reservoirM3), after: r0(next.reservoirM3), unit: 'm³' },
    { label: 'Rainfall', before: w.normalRainfallMm, after: w.rainfallMm, unit: 'mm' },
  ]
  if (ws1 < 0.95) {
    const works = countStructure(next, S.waterworks)
    const capM3 = works * HYDRO.waterworksCapacityM3.value * prev.economy.serviceLevel
    const reasons: string[] = []
    if (works === 0) reasons.push('there is no waterworks to treat and pump water')
    if (h.intakeFlowM3 > 0 && h.townSuppliedM3 + h.irrigationSuppliedM3 >= 0.98 * HYDRO.envFlowLimit.value * h.intakeFlowM3)
      reasons.push(`the river at the intake carried only ${num(h.intakeFlowM3)} m³ and at most ${pct(HYDRO.envFlowLimit.value)} may be taken to keep the river alive`)
    if (capM3 > 0 && h.townSuppliedM3 >= 0.98 * capM3) reasons.push(`waterworks capacity (${num(capM3)} m³ a season) is fully used`)
    const wq = next.community.waterQuality ?? 1
    if (wq < 0.99) reasons.push(`sediment from eroding land upstream made the river at the intakes so muddy that ${pct(1 - wq)} of the piped water was not safe to drink`)
    if (prev.economy.serviceLevel < 1) reasons.push(`budget shortages cut waterworks operation to ${pct(prev.economy.serviceLevel)}`)
    if (next.totals.reservoirCapacityM3 > 0 && next.reservoirM3 < 0.05 * next.totals.reservoirCapacityM3) reasons.push('the reservoir is empty')
    if (w.kind === 'drought') {
      const drought = `the drought (${r0(w.rainfallMm)} mm, ${pct(-change(w.normalRainfallMm, w.rainfallMm))} below the ${r0(w.normalRainfallMm)} mm normal; weather)`
      // with no waterworks, households live on roof tanks and wells, so stream flow is not what limits them
      reasons.push(works > 0 ? `${drought} lowered stream flow, filled roof tanks less and lowered well levels` : `${drought} filled roof tanks less and lowered well levels`)
    } else if (works > 0 && prev.history.some((p) => p.weather === 'drought') && h.intakeFlowM3 < 0.6 * Math.max(1, avgIntake(prev)))
      reasons.push('groundwater has not refilled since the drought, so baseflow is low')
    push(ctx, {
      topic: 'water',
      severity: ws1 < 0.7 ? 'critical' : 'warning',
      title: `Households got ${pct(ws1)} of their water`,
      body: `Households got ${pct(ws1)} of the ${num(h.townDemandM3)} m³ of safe water they needed (${num(h.householdSuppliedM3)} m³ supplied: ${num(h.townSuppliedM3)} piped, ${num(h.selfSuppliedM3)} from roof tanks and shallow wells)${reasons.length ? ` because ${reasons.join('; ')}` : ''}. Options: more waterworks capacity, a reservoir to store wet-season water, land that keeps more water in the ground, or trees, terraces and wetlands upstream to keep soil out of the river.`,
      evidence: evd,
    })
  } else if (ws0 < 0.95) {
    push(ctx, { topic: 'water', severity: 'good', title: 'Household water is back to normal', body: `Households got ${num(h.householdSuppliedM3)} m³, all of the need.`, evidence: evd })
  }
  if (h.irrigationDemandM3 > 1000) {
    const ratio = h.irrigationSuppliedM3 / h.irrigationDemandM3
    const lastRatio = ctx.lastYear?.irrigationSupplyRatio ?? 1
    if (ratio < 0.6 && lastRatio >= 0.6) {
      push(ctx, {
        topic: 'water',
        severity: 'warning',
        title: `Irrigation met ${pct(ratio)} of demand`,
        body: `Irrigated fields asked for ${num(h.irrigationDemandM3)} m³ and got ${num(h.irrigationSuppliedM3)} m³. Households have priority, the river can only give ${pct(HYDRO.envFlowLimit.value)} of its flow, and the reservoir keeps ${pct(HYDRO.reservoir.value.domesticReserveFrac)} of its capacity for homes.`,
        evidence: [
          { label: 'Irrigation supply ratio', before: r2(lastRatio), after: r2(ratio) },
          { label: 'Irrigation demand', after: r0(h.irrigationDemandM3), unit: 'm³' },
          { label: 'Irrigation supplied', after: r0(h.irrigationSuppliedM3), unit: 'm³' },
        ],
      })
    }
  }
}

function avgIntake(s: SimulationState): number {
  const dry = s.history.filter((p) => p.season === 'dry' && p.step > 0).map((p) => p.intakeFlowM3)
  return dry.length ? dry.reduce((a, b) => a + b, 0) / dry.length : 0
}

function countStructure(s: SimulationState, st: number): number {
  let k = 0
  for (let i = 0; i < s.layers.structure.length; i++) if (s.layers.structure[i] === st) k++
  return k
}

// ------------------------------------------------------------------ soil and erosion

/**
 * Split of a quantity this season into the weather's part and the land's part, using the
 * business-as-usual twin (the starting land use run through this same weather):
 * normal = a normal season of this type on the starting landscape, twin = the starting
 * landscape in this season's weather, yours = the player's valley in this season's weather.
 */
function twinSplit(normal: number, twin: number, yours: number, season: WeatherSeason['season']): { weather: string; land: string } {
  const weather = normal > 0 ? `${r2(twin / normal)} times a normal ${season} season (${num(normal)})` : `against ${num(normal)} in a normal ${season} season`
  const diff = twin > 0 ? change(twin, yours) : 0
  const land =
    Math.abs(diff) < 0.03
      ? 'about the same, so your land changes made little difference'
      : `${pct(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than that, which is the effect of the changes made to the land since the start`
  return { weather, land }
}

function explainSoil(ctx: Ctx): void {
  const { next, lastYear, w, out } = ctx
  const t = next.totals
  const tw = out.reference.last
  // erosion against a normal season of the same type on the starting landscape (weather plus
  // land), and against the twin in this same weather (land only)
  const refEro = next.baseline.referenceErosionT[w.season]
  const spike = refEro > 0 && t.totalErosionT > 1.6 * refEro && t.meanErosion > 1
  const landSpike = tw.totalErosionT > 0 && t.totalErosionT > 1.3 * tw.totalErosionT && t.meanErosion > 1
  const held = w.kind === 'heavy-rain' && tw.totalErosionT > 0 && t.totalErosionT < 0.85 * tw.totalErosionT
  if (spike || landSpike || held) {
    const { share, cells } = sensitiveErosion(ctx)
    const split = twinSplit(refEro, tw.totalErosionT, t.totalErosionT, w.season)
    // "before" is the starting landscape in this same weather (the twin), "after" is your valley
    const evidence: Ev[] = [
      { label: 'Erosion index, starting landscape in this weather vs yours', before: r0(tw.totalErosionT), after: r0(t.totalErosionT), unit: 'game t' },
      { label: 'Erosion index, normal season on the starting landscape', after: r0(refEro), unit: 'game t' },
      { label: 'Share from exposed hillsides', after: r2(share) },
      { label: 'Sediment leaving the valley, starting landscape vs yours', before: r0(tw.outletSedimentT), after: r0(t.outletSedimentT), unit: 'game t' },
      { label: 'Storm intensity', before: 1, after: w.stormIntensity, unit: 'x' },
      { label: 'Rainfall', before: w.normalRainfallMm, after: w.rainfallMm, unit: 'mm' },
    ]
    const twinSentence = `In this same weather the starting landscape would have eroded ${num(tw.totalErosionT)} game tonnes, ${split.weather}: that is the effect of the weather. Your valley eroded ${num(t.totalErosionT)}, ${split.land}.`
    const goodOnly = held && !spike && !landSpike
    push(ctx, {
      topic: 'soil',
      severity: goodOnly ? 'good' : 'warning',
      title: goodOnly
        ? 'The hills held their soil in the storms'
        : spike
          ? `Erosion ${r2(t.totalErosionT / refEro)} times a normal ${w.season} season`
          : `Erosion ${r2(t.totalErosionT / tw.totalErosionT)} times what the starting landscape would lose`,
      body: goodOnly
        ? `${capital(weatherPhrase(w))}. ${twinSentence} Cover on the slopes (trees, agroforestry, terraces, grass) is what holds the soil when big storms come.`
        : `The erosion index summed to ${num(t.totalErosionT)} game tonnes; ${weatherPhrase(w)}. ${twinSentence} ${pct(share)} of it came from cropland and bare ground on slopes above ${pct(SOIL.sensitiveSlope.value)} (land cover you can change with terraces, agroforestry or trees). ${num(out.soil.outletSedimentT)} game tonnes of sediment left the valley and ${num(out.soil.reservoirSiltT)} game tonnes settled in reservoirs.`,
      evidence,
      cells,
    })
  }
  explainHillside(ctx, lastYear)
}

/** Mean slope of cropland on sensitive hillsides (0 when there is none). */
function hillsideCropSlope(s: SimulationState): number {
  let sum = 0
  let k = 0
  for (let i = 0; i < s.layers.cover.length; i++) {
    if (s.layers.cover[i] !== C.cropland || s.terrain.slope[i] <= SOIL.sensitiveSlope.value) continue
    sum += s.terrain.slope[i]
    k++
  }
  return k ? sum / k : 0
}

function explainHillside(ctx: Ctx, lastYear: HistoryPoint | null): void {
  const { next } = ctx
  const t = next.totals
  if (!lastYear) return
  const ds = t.meanSoilHealth - lastYear.meanSoilHealth
  const d = next.diagnostics
  const dh = d.hillsideCropSoil - lastYear.hillsideCropSoil
  if (d.hillsideCropCells > 0 && lastYear.hillsideCropSoil > 0 && dh <= -0.02) {
    const slope = hillsideCropSlope(next)
    const p = contouringP(slope)
    const steep = SOIL.pSteepLimit.value.slope
    const terraced =
      d.hillsideConservationCells > 0
        ? ` ${d.hillsideConservationCells} of these fields already have terraces or contour bunds, which keep their erosion to about ${pct(d.hillsideConservationP)} on average.`
        : ''
    push(ctx, {
      topic: 'soil',
      severity: dh <= -0.05 ? 'critical' : 'warning',
      title: 'Hillside farm soils are wearing out',
      body: `Soil health on the ${d.hillsideCropCells} hillside crop fields fell from ${r2(lastYear.hillsideCropSoil)} to ${r2(d.hillsideCropSoil)} in a year. Farm erosion averaged ${r2(d.meanCropErosion)} game t/ha this season. On these slopes (${pct(slope)} on average) terraces and contour rows cut erosion to about ${pct(p)} of what it would be, so they help less the steeper the field, and not at all above ${pct(steep)}.${terraced} Agroforestry and lower intensity also slow the loss.`,
      evidence: [
        { label: 'Hillside farm soil health', before: r2(lastYear.hillsideCropSoil), after: r2(d.hillsideCropSoil) },
        { label: 'Mean farm erosion', after: r2(d.meanCropErosion), unit: 'game t/ha' },
        { label: 'Mean hillside farm slope', after: r2(slope) },
        { label: 'Share of erosion terraces leave at that slope', after: r2(p) },
      ],
    })
  }
  if (Math.abs(ds) >= 0.008) {
    push(ctx, {
      topic: 'soil',
      severity: ds > 0 ? 'good' : 'warning',
      title: ds > 0 ? 'Land condition is improving' : 'Land condition is declining',
      body: `Average soil health across the valley went from ${r2(lastYear.meanSoilHealth)} to ${r2(t.meanSoilHealth)} in a year (start of game: ${r2(next.baseline.meanSoilHealth)}). The guided goal is no net loss of land condition.`,
      evidence: [
        { label: 'Mean soil health', before: r2(lastYear.meanSoilHealth), after: r2(t.meanSoilHealth) },
        { label: 'Start of game', after: r2(next.baseline.meanSoilHealth) },
      ],
    })
  }
}

function sensitiveErosion(ctx: Ctx): { share: number; cells: number[] } {
  const { next } = ctx
  const e = next.fields.erosion
  let total = 0
  let sens = 0
  const idx: number[] = []
  for (let i = 0; i < e.length; i++) {
    total += e[i]
    const c = next.layers.cover[i]
    if ((c === C.cropland || c === C.bare) && next.terrain.slope[i] > SOIL.sensitiveSlope.value) sens += e[i]
    if (e[i] > 0) idx.push(i)
  }
  return { share: total > 0 ? sens / total : 0, cells: idx.sort((a, b) => e[b] - e[a]).slice(0, 8) }
}

// ------------------------------------------------------------------ floods

/**
 * Flooded homes split against the twin: homes the starting village would have had in this
 * same storm (weather), minus starting homes your valley kept dry, plus starting homes that
 * flooded only in your valley (a higher river), plus new homes built where the water reached.
 */
function floodSplit(ctx: Ctx): { twinHomes: number; spared: number; extraOld: number; newHomes: number; twinCells: number } {
  const { next, out } = ctx
  const refS = out.reference.layers.structure
  const refF = out.refHydro.flooded
  const f = next.fields.flooded
  const st = next.layers.structure
  let twinHomes = 0
  let spared = 0
  let extraOld = 0
  let newHomes = 0
  let twinCells = 0
  for (let i = 0; i < f.length; i++) {
    if (refF[i]) twinCells++
    const mine = f[i] === 1 && st[i] === S.housing
    const wasHome = refS[i] === S.housing
    if (wasHome && refF[i]) {
      twinHomes++
      if (!mine) spared++
    }
    if (mine && !wasHome) newHomes++
    if (mine && wasHome && !refF[i]) extraOld++
  }
  return { twinHomes, spared, extraOld, newHomes, twinCells }
}

function explainFlood(ctx: Ctx): void {
  const { next, w, out } = ctx
  const flooded = next.totals.floodedCells
  const homes = next.totals.floodedHousingCells
  const tw = out.reference.last
  const split = floodSplit(ctx)
  if (flooded === 0 && split.twinCells === 0 && w.kind !== 'heavy-rain') return
  const forestNow = next.totals.forestCoverFrac
  const forest0 = next.baseline.forestCoverFrac
  const wet0 = next.baseline.wetlandCells
  const wet1 = next.totals.wetlandCells
  const evd: Ev[] = [
    { label: 'Flooded cells', before: split.twinCells, after: flooded },
    { label: 'Flooded homes', before: split.twinHomes, after: homes },
    { label: 'River peak as a multiple of what the banks hold, at the village', before: r2(tw.settlementFloodRatio), after: r2(next.diagnostics.settlementFloodRatio) },
    { label: 'Hillside quick runoff', before: r0(tw.upstreamRunoffMm), after: r0(next.diagnostics.upstreamRunoffMm), unit: 'mm' },
    { label: 'Forest share of land', before: r2(forest0), after: r2(forestNow) },
    { label: 'Wetland cells', before: wet0, after: wet1 },
  ]
  // the "before" values above are the starting valley in this same weather (or at the start)
  const twinSentence = `In this same storm the river near the starting village would have peaked at ${r1(tw.settlementFloodRatio)} times what its banks can hold and flooded ${split.twinHomes} home${split.twinHomes === 1 ? '' : 's'} (${split.twinCells} cells): that is the effect of the weather. In your valley it peaked at ${r1(next.diagnostics.settlementFloodRatio)} times what the banks can hold and flooded ${homes} home${homes === 1 ? '' : 's'} (${flooded} cells).`
  const parts: string[] = []
  if (split.extraOld > 0) parts.push(`${split.extraOld} original home${split.extraOld === 1 ? '' : 's'} flooded only because the river rose higher than it would have on the starting land`)
  if (split.newHomes > 0) parts.push(`${split.newHomes} new home${split.newHomes === 1 ? ' was' : 's were'} built where the floodwater reaches`)
  if (split.spared > 0) parts.push(`${split.spared} home${split.spared === 1 ? '' : 's'} that would have flooded stayed dry`)
  const landPart = parts.length ? ` The difference comes from your changes: ${parts.join('; ')}.` : ' Your changes made no difference to which homes flooded.'
  const landNote = `How high the river rises depends on the land upstream: forest now covers ${pct(forestNow)} of the valley (${pct(forest0)} at the start) and there are ${wet1} wetland cells (${wet0} at the start) holding water back.`
  if (homes > 0) {
    const repairs = next.economy.expenses.floodRepairs ?? 0
    push(ctx, {
      topic: 'flood',
      severity: 'critical',
      title: `Flood reached ${homes} home${homes === 1 ? '' : 's'}`,
      body: `${capital(weatherPhrase(w))}. ${twinSentence}${landPart} Repairs cost ${num(repairs)}. ${landNote} Homes on the floodplain (less than a few metres above the river) are the ones at risk.`,
      evidence: [...evd, { label: 'Flood repairs', after: r0(repairs) }],
      cells: floodedCells(ctx),
    })
  } else if (split.twinHomes > 0) {
    push(ctx, {
      topic: 'flood',
      severity: 'good',
      title: `No homes flooded; the starting village would have lost ${split.twinHomes}`,
      body: `${capital(weatherPhrase(w))}. ${twinSentence}${landPart} ${landNote}`,
      evidence: evd,
      cells: floodedCells(ctx),
    })
  } else if (flooded > 0) {
    push(ctx, {
      topic: 'flood',
      severity: 'warning',
      title: `River overflowed onto ${flooded} cells`,
      body: `Floodwater covered low floodplain land but no homes; ${weatherPhrase(w)}. ${twinSentence} ${next.diagnostics.floodedCropCells} cropped fields were hit. ${landNote}`,
      evidence: evd,
      cells: floodedCells(ctx),
    })
  } else if (w.kind === 'heavy-rain') {
    push(ctx, {
      topic: 'flood',
      severity: 'good',
      title: 'The village stayed dry in heavy rain',
      body: `Despite ${r0(w.rainfallMm)} mm of rain, the river near the village peaked at ${r1(next.diagnostics.settlementFloodRatio)} times what its banks can hold and stayed in its banks. In the starting valley it would have peaked at ${r1(tw.settlementFloodRatio)} times in the same storm. ${landNote}`,
      evidence: evd,
    })
  }
}

function floodedCells(ctx: Ctx): number[] {
  const f = ctx.next.fields
  const out: number[] = []
  for (let i = 0; i < f.flooded.length; i++) if (f.flooded[i] && ctx.next.layers.structure[i] === S.housing) out.push(i)
  for (let i = 0; i < f.flooded.length && out.length < 8; i++) if (f.flooded[i] && !out.includes(i)) out.push(i)
  return out.slice(0, 8)
}

// ------------------------------------------------------------------ budget

/** Plain words for the expense keys of models/economy (shown to players). */
export const EXPENSE_LABELS: Record<string, string> = {
  roads: 'road upkeep',
  housing: 'housing upkeep',
  services: 'schools, clinics and waste services',
  waterworks: 'running the waterworks',
  reservoirs: 'reservoir upkeep',
  markets: 'market upkeep',
  wetlands: 'wetland care',
  conservation: 'terrace and contour upkeep',
  irrigation: 'running the canals',
  farmInputs: 'seed and fertiliser',
  youngPlantings: 'care for young plantings',
  floodRepairs: 'flood repairs',
  interest: 'loan interest',
}

/** A plain label for an expense key; unknown keys are split into lower-case words. */
export function expenseLabel(key: string): string {
  return EXPENSE_LABELS[key] ?? key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
}

function explainBudget(ctx: Ctx): void {
  const { prev, next } = ctx
  const e = next.economy
  const inc = Object.values(e.income).reduce((a, b) => a + b, 0)
  const exp = Object.values(e.expenses).reduce((a, b) => a + b, 0)
  const top = Object.entries(e.expenses).sort((a, b) => b[1] - a[1]).slice(0, 3)
  if (e.serviceLevel < 1) {
    push(ctx, {
      topic: 'budget',
      severity: 'critical',
      title: `Budget shortfall: ${num(e.unpaid)} unpaid`,
      body: `Bills this season came to ${num(exp)} but only ${num(prev.economy.budget + inc)} was available, so ${pct(e.serviceLevel)} was paid. Next season waterworks and farm programs run at that level. The unpaid bills are not forgiven: they are added to the debt and charge interest until they are paid back. Largest costs: ${top.map(([k, v]) => `${expenseLabel(k)} ${num(v)}`).join(', ')}.`,
      evidence: [
        { label: 'Budget', before: r0(prev.economy.budget), after: r0(e.budget) },
        { label: 'Income', after: r0(inc) },
        { label: 'Expenses', after: r0(exp) },
        { label: 'Debt', before: r0(prev.economy.debt), after: r0(e.debt) },
      ],
    })
  } else if (prev.economy.serviceLevel < 1) {
    push(ctx, { topic: 'budget', severity: 'good', title: 'Bills are paid in full again', body: `Income ${num(inc)} covered expenses ${num(exp)} this season.`, evidence: [{ label: 'Budget', before: r0(prev.economy.budget), after: r0(e.budget) }] })
  }
  const tree = e.income.treeProducts ?? 0
  const prevTree = prev.economy.income.treeProducts ?? 0
  if (tree > 0 && prevTree === 0) {
    push(ctx, {
      topic: 'budget',
      severity: 'good',
      title: 'Agroforestry trees started paying',
      body: `Tree products from agroforestry earned households ${num(next.diagnostics.treeProductValue)} this season and the community budget ${num(tree)} through the levy. Value grows until trees are about ${years(AGRI.treeProduct.value.fullAge)} years old.`,
      evidence: [{ label: 'Tree product value', before: 0, after: r0(next.diagnostics.treeProductValue) }],
    })
  }
}

// ------------------------------------------------------------------ population

function explainPopulation(ctx: Ctx): void {
  const { prev, next } = ctx
  const c0 = prev.community
  const c1 = next.community
  // counts are built from the rounded figures shown, so the sentence's arithmetic is exact for a reader
  const demandR = Math.round(c1.housingDemand)
  const popR = Math.round(c1.population)
  const capR = Math.round(c1.housingCapacity)
  const unhoused = Math.max(0, demandR - popR)
  const crowded = Math.max(0, popR - capR)
  if (c1.housingAdequacy < 0.9 && c0.housingAdequacy >= 0.9) {
    push(ctx, {
      topic: 'population',
      severity: 'warning',
      title: `About ${num(unhoused)} people could not find a home`,
      body: `${num(demandR)} people want to live here (regional migration pressure plus local growth), but only ${num(popR)} do now: ${num(demandR)} minus ${num(popR)} leaves ${num(unhoused)} turned away. Homes hold ${num(capR)} people, so ${num(crowded)} residents live in overcrowded homes. Housing covers ${pct(c1.housingAdequacy)} of demand. New homes need flat land near a road; floodplain sites are cheaper to reach but flood.`,
      evidence: [
        { label: 'Housing adequacy', before: r2(c0.housingAdequacy), after: r2(c1.housingAdequacy) },
        { label: 'Population', before: r0(c0.population), after: r0(c1.population) },
        { label: 'Housing capacity', after: r0(c1.housingCapacity) },
        { label: 'People who want to live here', after: r0(c1.housingDemand) },
      ],
    })
  }
  if (c1.departures > c1.arrivals + c1.births && c1.departures > 0.01 * c0.population) {
    push(ctx, {
      topic: 'population',
      severity: 'warning',
      title: `${num(c1.departures)} people left the valley`,
      body: `Wellbeing was ${pct(c0.wellbeing)} and food security ${pct(c1.foodSecurity)}; people leave when wellbeing drops below ${pct(COMMUNITY.departure.value.wellbeingThreshold)} or food security below ${pct(COMMUNITY.departure.value.foodCrisis)}. ${num(c1.arrivals)} arrived and ${num(c1.births)} were born.`,
      evidence: [
        { label: 'Departures', after: r0(c1.departures) },
        { label: 'Arrivals', after: r0(c1.arrivals) },
        { label: 'Wellbeing', after: r2(c0.wellbeing) },
      ],
    })
  }
}

// ------------------------------------------------------------------ vegetation and restoration

function explainVegetation(ctx: Ctx): void {
  const { prev, next, out, w } = ctx
  const m0 = prev.diagnostics.matureRestorationCells
  const m1 = next.diagnostics.matureRestorationCells
  if (m1 > m0) {
    push(ctx, {
      topic: 'vegetation',
      severity: 'good',
      title: `${m1 - m0} restored cell${m1 - m0 === 1 ? '' : 's'} reached maturity`,
      body: `Planted forest takes about ${years(VEG.matureSeasons.value.forest)} years, agroforestry ${years(VEG.matureSeasons.value.agroforestry)} and wetlands ${years(VEG.matureSeasons.value.wetland)} to reach full cover. ${m1} restored cells are now mature and ${next.diagnostics.youngRestorationCells} are still growing. Mature cover protects soil and slows runoff more than young plantings.`,
      evidence: [
        { label: 'Mature restored cells', before: m0, after: m1 },
        { label: 'Young restored cells', after: next.diagnostics.youngRestorationCells },
      ],
    })
  }
  const lastYear = ctx.lastYear
  if (lastYear && w.kind === 'drought') {
    const v1 = meanVeg(next)
    if (lastYear.meanVegetation - v1 > 0.04) {
      push(ctx, {
        topic: 'vegetation',
        severity: 'warning',
        title: 'Plants are drying out',
        body: `Average vegetation cover dropped from ${r2(lastYear.meanVegetation)} to ${r2(v1)}; ${weatherPhrase(w)}. Thin cover leaves soil exposed when the rains return.`,
        evidence: [{ label: 'Mean vegetation cover', before: r2(lastYear.meanVegetation), after: r2(v1) }],
      })
    }
  }
  if (out.succeeded.length > 0) {
    push(ctx, {
      topic: 'vegetation',
      severity: 'info',
      title: `${out.succeeded.length} bare cell${out.succeeded.length === 1 ? '' : 's'} grew back to grassland`,
      body: 'Left alone for a few years with enough soil, bare ground regrows on its own.',
      evidence: [{ label: 'Cells regrown', after: out.succeeded.length }],
      cells: out.succeeded.slice(0, 8),
    })
  }
}

function meanVeg(s: SimulationState): number {
  let v = 0
  let k = 0
  for (let i = 0; i < s.layers.vegetation.length; i++) {
    if (s.terrain.channel[i]) continue
    v += s.layers.vegetation[i]
    k++
  }
  return k ? v / k : 0
}

// ------------------------------------------------------------------ downstream

function explainDownstream(ctx: Ctx): void {
  const { next, w, out } = ctx
  const ref = next.baseline.referenceSedimentT[w.season]
  const sed = next.totals.outletSedimentT
  const twin = out.reference.last.outletSedimentT
  const muddy = ref > 0 && sed > 2.5 * ref
  const cleaner = ref > 0 && twin > 2.5 * ref && sed < 0.7 * twin
  if (!muddy && !cleaner) return
  const h0 = ctx.prev.community.stakeholders.downstream.hazardExposure
  const h1 = next.community.stakeholders.downstream.hazardExposure
  const split = twinSplit(ref, twin, sed, w.season)
  const twinSentence = `In this same weather the starting valley would have sent ${num(twin)} game tonnes downstream, ${split.weather}: that is the effect of the weather. Your valley sent ${num(sed)}, ${split.land}.`
  const index = `The downstream hazard index ${h1 > h0 ? `rose to ${r2(h1)} from ${r2(h0)}` : `stood at ${r2(h1)}`}; it is computed from the sediment and the flood peak leaving the valley (the river beyond the map is not simulated).`
  const evidence: Ev[] = [
    { label: 'Sediment leaving the valley, starting valley in this weather vs yours', before: r0(twin), after: r0(sed), unit: 'game t' },
    { label: 'Sediment in a normal season on the starting landscape', after: r0(ref), unit: 'game t' },
    { label: 'Downstream hazard index', before: r2(h0), after: r2(h1) },
  ]
  if (muddy) {
    push(ctx, {
      topic: 'soil',
      severity: 'warning',
      title: 'Muddy water reached downstream households',
      body: `${num(sed)} game tonnes of sediment left the valley, ${r2(sed / ref)} times a normal ${w.season} season on the starting landscape. ${twinSentence} ${index} Wetlands and vegetated buffers trap sediment before it reaches the river.`,
      evidence,
    })
  } else {
    push(ctx, {
      topic: 'soil',
      severity: 'good',
      title: 'Less mud went downstream than the starting valley would have sent',
      body: `${twinSentence} ${index} Wetlands, buffers and cover on the slopes keep soil out of the river.`,
      evidence,
    })
  }
}

// ------------------------------------------------------------------ entry points

/** Explanations for one completed step (prev = state before the step, next = after). */
export function explainStep(prev: SimulationState, next: SimulationState, w: WeatherSeason, out: SeasonOutcome): Explanation[] {
  const lastYear = [...prev.history].reverse().find((p) => p.season === w.season && p.step > 0) ?? null
  const ctx: Ctx = {
    prev,
    next,
    w,
    out,
    year: prev.year,
    season: prev.season,
    decisions: prev.decisions.filter((d) => d.step === prev.step),
    lastYear,
    list: [],
  }
  explainWeather(ctx)
  explainFood(ctx)
  explainWater(ctx)
  explainFlood(ctx)
  explainSoil(ctx)
  explainBudget(ctx)
  explainPopulation(ctx)
  explainVegetation(ctx)
  explainDownstream(ctx)
  const ds = decisionSummary(ctx.decisions)
  if (ds) {
    const spent = ctx.decisions.reduce((a, d) => a + d.cost, 0)
    push(ctx, {
      topic: 'budget',
      severity: 'info',
      title: 'Your decisions this season',
      body: `You applied ${ds}, spending ${num(spent)}. Their effects build up over the following seasons.`,
      evidence: [{ label: 'Spent on actions', after: r0(spent) }],
    })
  }
  return ctx.list
}

/** Orientation explanations for the starting landscape. */
export function explainStart(s: SimulationState): Explanation[] {
  let floodplainHomes = 0
  let hillsideFarms = 0
  for (let i = 0; i < s.layers.structure.length; i++) {
    if (s.layers.structure[i] === S.housing && s.terrain.heightAboveChannelM[i] < 3 && s.terrain.channelDistance[i] <= HYDRO.flood.value.maxDistanceCells) floodplainHomes++
    if (s.layers.cover[i] === C.cropland && s.terrain.slope[i] > SOIL.sensitiveSlope.value) hillsideFarms++
  }
  const t = s.totals
  const horizon = s.weather.slice(0, s.horizonYears * 2)
  const droughts = horizon.filter((w) => w.kind === 'drought').length
  const storms = horizon.filter((w) => w.kind === 'heavy-rain').length
  return [
    {
      id: 's0-start-0',
      year: 1,
      season: 'wet',
      topic: 'event',
      severity: 'info',
      title: `Welcome to ${s.meta.name}`,
      body: `${num(s.community.population)} people live in homes for ${num(s.community.housingCapacity)}. The valley has ${num(t.cropAreaHa)} ha of farmland, forest on ${pct(t.forestCoverFrac)} of the land and average soil health ${r2(t.meanSoilHealth)}. You have ${num(s.economy.budget)} to spend. ${floodplainHomes} homes sit low on the floodplain and ${hillsideFarms} farm fields are on slopes above ${pct(SOIL.sensitiveSlope.value)}, where heavy rain strips soil. Over ${s.horizonYears} years more people will want to live here. This game's weather (seed ${s.seed}) brings ${droughts} drought seasons and ${storms} season${storms === 1 ? '' : 's'} of heavy storms out of ${horizon.length}, including at least one long drought; other seeds bring more or fewer.`,
      evidence: [
        { label: 'Population', after: r0(s.community.population) },
        { label: 'Housing capacity', after: r0(s.community.housingCapacity) },
        { label: 'Farmland', after: r0(t.cropAreaHa), unit: 'ha' },
        { label: 'Forest share', after: r2(t.forestCoverFrac) },
        { label: 'Mean soil health', after: r2(t.meanSoilHealth) },
        { label: 'Floodplain homes', after: floodplainHomes },
        { label: 'Hillside farm fields', after: hillsideFarms },
        { label: 'Drought seasons ahead', after: droughts },
        { label: 'Heavy-rain seasons ahead', after: storms },
      ],
    },
  ]
}
