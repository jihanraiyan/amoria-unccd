// Guided scenario: "Amoria Valley, 20 years". Transparent objectives evaluated as a pure
// function of simulation state and history, plus an end-of-horizon report. Nothing here
// changes the simulation; it only reads it.
import { C, cellHa } from '../models/cells'
import { ECON, OBJECTIVES, SOIL } from '../params'
import { summarizeWeather } from '../events/weather'
import type { Explanation, HistoryPoint, PlayerAction, SimulationState } from '../types'

export interface ObjectiveStatus {
  id: 'housing' | 'growth' | 'food' | 'water' | 'land' | 'cover' | 'solvency' | 'wellbeing' | 'drought' | 'floods' | 'erosion'
  label: string
  description: string
  /** Current value of the measured quantity. */
  value: number
  target: number
  /** 'atLeast' targets want value >= target; 'atMost' want value <= target. */
  direction: 'atLeast' | 'atMost'
  met: boolean
  /** 0..1 progress toward the target (1 when met). */
  progress: number
  unit?: string
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/** Seasons played so far (excludes the pre-game baseline point). */
const playedSeasons = (s: SimulationState): HistoryPoint[] => s.history.filter((p) => p.step > 0)

/**
 * Seasons in the last `windowSeasons` that were not drought seasons (the drought goal judges
 * those). Falls back to the whole window if every season in it was a drought.
 */
export function goalWindow(s: SimulationState): HistoryPoint[] {
  const recent = playedSeasons(s).slice(-OBJECTIVES.value.windowSeasons)
  const calm = recent.filter((p) => p.weather !== 'drought')
  return calm.length ? calm : recent
}

/** Drought episodes played so far: runs of consecutive drought seasons, oldest first. */
export function droughtEpisodes(played: HistoryPoint[]): HistoryPoint[][] {
  const out: HistoryPoint[][] = []
  let run: HistoryPoint[] = []
  for (const p of played) {
    if (p.weather === 'drought') run.push(p)
    else if (run.length) {
      out.push(run)
      run = []
    }
  }
  if (run.length) out.push(run)
  return out
}

/**
 * Resilience measures. All of them leave room to recover from an early mistake:
 * - droughtSecurity: lowest of food and household water security over the seasons of the most
 *   recent drought episode (1 when no drought has come yet), so getting ready after a bad first
 *   drought counts once the next one comes;
 * - floodedHomesRatio: flooded home-seasons over the whole game against the business-as-usual
 *   twin (the starting village in the same weather), as (yours + 1) / (twin + 1), or 0 when no
 *   home has flooded (heavy-rain seasons are rare, so a shorter window would often hold none);
 * - erosionRatio: erosion over the last `resilienceWindowSeasons` seasons against the twin over
 *   the same seasons.
 */
export function resilienceMeasures(s: SimulationState): {
  worstDroughtSecurity: number
  droughtSecurity: number
  droughtSeasons: number
  droughtEpisodes: number
  lastEpisodeSeasons: number
  floodedHomeSeasons: number
  refFloodedHomeSeasons: number
  floodedHomesRatio: number
  erosionT: number
  refErosionT: number
  erosionRatio: number
  windowSeasons: number
} {
  const played = playedSeasons(s)
  const drought = played.filter((p) => p.weather === 'drought')
  const episodes = droughtEpisodes(played)
  const last = episodes[episodes.length - 1] ?? []
  const sec = (p: HistoryPoint) => Math.min(p.foodSecurity, p.waterSecurity)
  // floods count over the whole game: one big flood is rare, so a shorter window would often hold none
  const floodedHomeSeasons = total(played.map((p) => p.floodedHousingCells))
  const refFloodedHomeSeasons = total(played.map((p) => p.refFloodedHousingCells))
  const recent = played.slice(-OBJECTIVES.value.resilienceWindowSeasons)
  const erosionT = total(recent.map((p) => p.totalErosionT))
  const refErosionT = total(recent.map((p) => p.refTotalErosionT))
  return {
    worstDroughtSecurity: drought.length ? Math.min(...drought.map(sec)) : 1,
    droughtSecurity: last.length ? Math.min(...last.map(sec)) : 1,
    droughtSeasons: drought.length,
    droughtEpisodes: episodes.length,
    lastEpisodeSeasons: last.length,
    floodedHomeSeasons,
    refFloodedHomeSeasons,
    floodedHomesRatio: floodedHomeSeasons === 0 ? 0 : (floodedHomeSeasons + 1) / (refFloodedHomeSeasons + 1),
    erosionT,
    refErosionT,
    erosionRatio: refErosionT > 0 ? erosionT / refErosionT : 1,
    windowSeasons: recent.length,
  }
}

/**
 * Land condition against the business-as-usual twin in the same weather, on the land that
 * matters: every cell whose land use differs from the twin's (cover, structure, terraces,
 * input level) or whose cover is younger than the twin's (land changed and later changed
 * back, such as a replanted forest), plus the hillside farms the map started with. Value = mean of (your soil health
 * minus the twin's) over those cells. Weather moves both alike, so what is left is the player's;
 * a valley left alone scores 0.
 */
export function landGain(s: SimulationState): { gain: number; cells: number; soil: number; refSoil: number } {
  const L = s.layers
  const R = s.reference?.layers
  if (!R) return { gain: 0, cells: 0, soil: s.totals.meanSoilHealth, refSoil: s.totals.meanSoilHealth }
  const steep = SOIL.sensitiveSlope.value
  let k = 0
  let mine = 0
  let ref = 0
  for (let i = 0; i < L.cover.length; i++) {
    const changed =
      L.cover[i] !== R.cover[i] ||
      L.structure[i] !== R.structure[i] ||
      L.conservation[i] !== R.conservation[i] ||
      L.intensity[i] !== R.intensity[i] ||
      // land changed and later changed back (a replanted forest) is younger than the twin's
      L.coverAge[i] < R.coverAge[i]
    const hillFarm = R.cover[i] === C.cropland && s.terrain.slope[i] > steep
    if (!changed && !hillFarm) continue
    k++
    mine += L.soilHealth[i]
    ref += R.soilHealth[i]
  }
  return k ? { gain: (mine - ref) / k, cells: k, soil: mine / k, refSoil: ref / k } : { gain: 0, cells: 0, soil: s.totals.meanSoilHealth, refSoil: s.totals.meanSoilHealth }
}

function status(
  id: ObjectiveStatus['id'],
  label: string,
  description: string,
  value: number,
  target: number,
  direction: ObjectiveStatus['direction'],
  unit?: string,
): ObjectiveStatus {
  const met = direction === 'atLeast' ? value >= target - 1e-9 : value <= target + 1e-9
  let progress: number
  if (direction === 'atLeast') progress = target > 0 ? Math.min(1, Math.max(0, value / target)) : 1
  else progress = met ? 1 : Math.max(0, 1 - (value - target) / Math.max(Math.abs(target), 1e-6))
  return { id, label, description, value, target, direction, met, progress, unit }
}

/** How the averaged goals describe their window. */
const WINDOW_TEXT = `non-drought seasons of the last ${OBJECTIVES.value.windowSeasons / 2} years`

const PART_LABELS = { housing: 'homes', food: 'food', water: 'water', livelihood: 'livelihood', safety: 'safety' } as const

/** The wellbeing part with the lowest average over the window (parts as in WELLBEING_WEIGHTS). */
export function weakestWellbeingPart(s: SimulationState, win: HistoryPoint[]): { part: keyof typeof PART_LABELS; value: number } {
  const parts = win.length
    ? {
        housing: mean(win.map((p) => p.housingAdequacy)),
        food: mean(win.map((p) => p.foodSecurity)),
        water: mean(win.map((p) => p.waterSecurity)),
        livelihood: mean(win.map((p) => p.livelihood)),
        safety: mean(win.map((p) => 1 - p.hazardExposure)),
      }
    : s.community.wellbeingParts
  let best: { part: keyof typeof PART_LABELS; value: number } = { part: 'housing', value: Infinity }
  for (const k of Object.keys(PART_LABELS) as (keyof typeof PART_LABELS)[]) if (parts[k] < best.value) best = { part: k, value: parts[k] }
  return best
}

/** Wellbeing goal: a high average and no part left far behind. */
function wellbeingStatus(wellbeing: number, weakest: { part: keyof typeof PART_LABELS; value: number }): ObjectiveStatus {
  const o = OBJECTIVES.value
  const base = status(
    'wellbeing',
    'A good place to live',
    `Average wellbeing over the ${WINDOW_TEXT} is at least ${Math.round(o.wellbeing * 100)}%, and none of its parts (homes, food, water, livelihood, safety) averages below ${Math.round(o.wellbeingWeakestPart * 100)}%. Weakest part now: ${PART_LABELS[weakest.part]} at ${Math.round(weakest.value * 100)}%.`,
    wellbeing,
    o.wellbeing,
    'atLeast',
  )
  const partOk = weakest.value >= o.wellbeingWeakestPart - 1e-9
  return { ...base, met: base.met && partOk, progress: Math.min(base.progress, Math.min(1, Math.max(0, weakest.value / o.wellbeingWeakestPart))) }
}

export function evaluateObjectives(s: SimulationState): ObjectiveStatus[] {
  const o = OBJECTIVES.value
  const win = goalWindow(s)
  const food = win.length ? mean(win.map((p) => p.foodSelfSufficiency ?? p.foodSecurity)) : (s.community.foodSelfSufficiency ?? s.community.foodSecurity)
  const water = win.length ? mean(win.map((p) => p.waterSecurity)) : s.community.waterSecurity
  const wellbeing = win.length ? mean(win.map((p) => p.wellbeing)) : s.community.wellbeing
  const weakest = weakestWellbeingPart(s, win)
  const minService = win.length ? Math.min(...win.map((p) => p.serviceLevel)) : s.economy.serviceLevel
  const debtShare = s.economy.debt / ECON.maxDebt.value
  const land = landGain(s)
  const r = resilienceMeasures(s)
  return [
    status('housing', 'Homes for everyone', `Housing covers at least ${Math.round(o.housingAdequacy * 100)}% of the people who want to live here.`, s.community.housingAdequacy, o.housingAdequacy, 'atLeast'),
    status(
      'growth',
      'A growing town',
      `Population reaches ${o.populationGrowth} times the starting ${Math.round(s.baseline.population)}.`,
      s.community.population / Math.max(1, s.baseline.population),
      o.populationGrowth,
      'atLeast',
      'x',
    ),
    status(
      'food',
      'Food grown here',
      `Over the ${WINDOW_TEXT}, the valley's own farms grow on average at least ${Math.round(o.foodSelfSufficiency * 100)}% of the food its people need (bought food does not count).`,
      food,
      o.foodSelfSufficiency,
      'atLeast',
    ),
    status('water', 'Safe water at home', `Average household water security over the ${WINDOW_TEXT} is at least ${Math.round(o.waterSecurity * 100)}%.`, water, o.waterSecurity, 'atLeast'),
    status(
      'land',
      'Healthier land',
      `On the hillside farms and every piece of land you have changed, soil health ends at least ${o.soilVsReference.toFixed(2)} higher on average than the starting landscape would have in the same weather (now ${land.soil.toFixed(2)} against ${land.refSoil.toFixed(2)} on ${Math.round(land.cells * cellHa(s.terrain))} ha). Weather wears both alike, so the gap is what your land use did. Clearing and hard cropping lower it, terraces, trees and wetlands raise it.`,
      land.gain,
      o.soilVsReference,
      'atLeast',
    ),
    status(
      'cover',
      'Keep the valley green',
      `Forest and wetland cover (agroforestry counts half) stays at least ${Math.round(o.naturalCoverKeep * 100)}% of the start. Clearing in one place can be balanced by planting elsewhere.`,
      s.baseline.naturalCover > 0 ? s.totals.naturalCover / s.baseline.naturalCover : 1,
      o.naturalCoverKeep,
      'atLeast',
    ),
    status(
      'solvency',
      'A solvent budget',
      `All bills paid in the ${WINDOW_TEXT} (a shortfall in a drought season does not count) and debt at most ${Math.round(o.maxDebtShare * 100)}% of the borrowing limit.`,
      minService >= 1 ? debtShare : Math.max(debtShare, 1),
      o.maxDebtShare,
      'atMost',
    ),
    wellbeingStatus(wellbeing, weakest),
    status(
      'drought',
      'Ready for drought',
      `In the most recent drought, food security and household water both stay at least ${Math.round(o.droughtSecurity * 100)}% in every season of it${r.droughtEpisodes ? ` (last drought: ${r.lastEpisodeSeasons} season${r.lastEpisodeSeasons === 1 ? '' : 's'}, ${r.droughtEpisodes} drought${r.droughtEpisodes === 1 ? '' : 's'} so far)` : ' (no drought yet)'}. A bad drought early on can be made up for by being ready for the next one.`,
      r.droughtSecurity,
      o.droughtSecurity,
      'atLeast',
    ),
    status(
      'floods',
      'Homes out of the floodwater',
      `Over the whole game, no home floods, or homes stand in floodwater at most ${Math.round(o.floodedHomesVsReference * 100)}% as often as the starting village would have in the same weather (${r.floodedHomeSeasons} flooded home-seasons against ${r.refFloodedHomeSeasons}).`,
      r.floodedHomesRatio,
      o.floodedHomesVsReference,
      'atMost',
      'x',
    ),
    status(
      'erosion',
      'Hold the soil on the hills',
      `Erosion over the last ${o.resilienceWindowSeasons / 2} years is at most ${Math.round(o.erosionVsReference * 100)}% of what the starting landscape would have lost in the same weather.`,
      r.erosionRatio,
      o.erosionVsReference,
      'atMost',
      'x',
    ),
  ]
}

export interface MetricArc {
  start: number
  end: number
  min: number
  max: number
}

export interface EndReport {
  yearsPlayed: number
  complete: boolean
  objectives: ObjectiveStatus[]
  objectivesMet: number
  metrics: Record<
    'population' | 'housingCapacity' | 'foodSecurity' | 'waterSecurity' | 'meanSoilHealth' | 'forestCoverFrac' | 'budget' | 'debt' | 'wellbeing' | 'outletSedimentT',
    MetricArc
  >
  cumulative: {
    foodProducedT: number
    erosionT: number
    outletSedimentT: number
    floodedHomeSeasons: number
    shortageSeasons: number
    spentOnActions: number
    revenueFromActions: number
  }
  weather: ReturnType<typeof summarizeWeather> & { designedSeasons: number }
  decisionsByType: Partial<Record<PlayerAction['type'], { count: number; cells: number; cost: number }>>
  keyMoments: Explanation[]
  stakeholders: SimulationState['community']['stakeholders']
}

function arc(h: HistoryPoint[], f: (p: HistoryPoint) => number): MetricArc {
  const v = h.map(f)
  return { start: v[0] ?? 0, end: v[v.length - 1] ?? 0, min: Math.min(...v), max: Math.max(...v) }
}

/** End-of-horizon report (also usable mid-game as a progress summary). */
export function endReport(s: SimulationState): EndReport {
  const h = s.history
  const played = h.filter((p) => p.step > 0)
  const objectives = evaluateObjectives(s)
  const byType: EndReport['decisionsByType'] = {}
  for (const d of s.decisions) {
    const e = (byType[d.action.type] ??= { count: 0, cells: 0, cost: 0 })
    e.count++
    e.cells += 'cells' in d.action ? d.action.cells.length : 0
    e.cost += d.cost
  }
  const sevRank = { critical: 3, good: 2, warning: 1, info: 0 } as const
  const keyMoments = s.explanations
    .filter((e) => e.severity === 'critical' || e.severity === 'good' || e.topic === 'event')
    .sort((a, b) => sevRank[b.severity] - sevRank[a.severity] || a.year - b.year)
    .slice(0, 10)
    .sort((a, b) => a.year - b.year || (a.season === b.season ? 0 : a.season === 'wet' ? -1 : 1))
  const ws = summarizeWeather(s.weather, 0, s.step)
  return {
    yearsPlayed: s.step / 2,
    complete: s.step >= s.horizonYears * 2,
    objectives,
    objectivesMet: objectives.filter((o) => o.met).length,
    metrics: {
      population: arc(h, (p) => p.population),
      housingCapacity: arc(h, (p) => p.housingCapacity),
      foodSecurity: arc(h, (p) => p.foodSecurity),
      waterSecurity: arc(h, (p) => p.waterSecurity),
      meanSoilHealth: arc(h, (p) => p.meanSoilHealth),
      forestCoverFrac: arc(h, (p) => p.forestCoverFrac),
      budget: arc(h, (p) => p.budget),
      debt: arc(h, (p) => p.debt),
      wellbeing: arc(h, (p) => p.wellbeing),
      outletSedimentT: arc(h, (p) => p.outletSedimentT),
    },
    cumulative: {
      foodProducedT: played.reduce((a, p) => a + p.foodProducedT, 0),
      erosionT: played.reduce((a, p) => a + p.totalErosionT, 0),
      outletSedimentT: played.reduce((a, p) => a + p.outletSedimentT, 0),
      floodedHomeSeasons: played.reduce((a, p) => a + p.floodedHousingCells, 0),
      shortageSeasons: played.filter((p) => p.serviceLevel < 1).length,
      spentOnActions: s.decisions.reduce((a, d) => a + d.cost, 0),
      revenueFromActions: s.decisions.reduce((a, d) => a + d.revenue, 0),
    },
    weather: { ...ws, designedSeasons: s.weather.slice(0, s.step).filter((w) => w.designed).length },
    decisionsByType: byType,
    keyMoments,
    stakeholders: s.community.stakeholders,
  }
}
