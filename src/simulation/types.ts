// Shared simulation contract. Pure data: no React, three.js or store imports.
// The grid is stored struct-of-arrays (one typed array per layer, length = width*height,
// index = z*width + x). Engine functions never mutate their inputs; they return new state.

export const LAND_COVERS = [
  'forest',
  'grassland',
  'cropland',
  'agroforestry',
  'urban',
  'wetland',
  'water',
  'bare',
] as const
export type LandCover = (typeof LAND_COVERS)[number]
/** Numeric code stored in WorldLayers.cover (index into LAND_COVERS). */
export type CoverCode = number

export const STRUCTURES = ['none', 'road', 'housing', 'reservoir', 'waterworks', 'market'] as const
export type Structure = (typeof STRUCTURES)[number]

export const INTENSITIES = ['low', 'medium', 'high'] as const
export type Intensity = (typeof INTENSITIES)[number]

export type Season = 'wet' | 'dry'

/** Static terrain, computed once at world load and never changed by actions. */
export interface Terrain {
  width: number
  height: number
  /** Physical size of one cell edge in metres. */
  cellSizeM: number
  elevationM: Float32Array
  /** Slope as rise/run (dimensionless), from elevation. */
  slope: Float32Array
  /** D8 receiver cell index, or -1 if the cell drains out of the basin. */
  flowTo: Int32Array
  /** Cell indices sorted upstream to downstream (topological order for routing). */
  flowOrder: Int32Array
  /** Upstream contributing cells including self (static, from flowTo). */
  flowAccumulation: Float32Array
  /** 1 if the cell is a permanent river/lake channel that cannot be built on. */
  channel: Uint8Array
  /** 1 if land is unavailable for development (e.g. protected reserve, map edge). */
  protected: Uint8Array
  /** Depression-filled elevation used for routing (priority-flood + epsilon), metres. */
  filledElevationM: Float64Array
  /** Channel cell this cell drains to along its D8 flow path, -1 if it leaves the map first. */
  nearestChannel: Int32Array
  /** Distance to the nearest channel cell in cells (Chebyshev). */
  channelDistance: Float32Array
  /** Height above nearest drainage (HAND) along the flow path, metres (floodplain height). */
  heightAboveChannelM: Float32Array
  /** Bankfull quick-flow capacity at channel cells, mm over one cell per sub-step (0 elsewhere). */
  bankfullMm: Float32Array
}

/** Mutable-by-actions / evolving-by-step state per cell. */
export interface WorldLayers {
  baselineCover: Uint8Array
  cover: Uint8Array
  structure: Uint8Array
  /** Housing density 1..3 when structure=housing, else 0. */
  structureLevel: Uint8Array
  /** Index into INTENSITIES for cropland; ignored otherwise. */
  intensity: Uint8Array
  /** 1 if soil-conservation practice (terraces/contours/cover crops) is applied. */
  conservation: Uint8Array
  /** 1 if cropland is irrigated (draws from the shared water supply). */
  irrigated: Uint8Array
  /** Seasons since the cell's cover last changed (drives restoration maturity). */
  coverAge: Uint16Array
  /** 0..1 soil condition index (illustrative, not a lab measurement). */
  soilHealth: Float32Array
  /** Plant-available soil water store, mm. */
  soilMoistureMm: Float32Array
  /** 0..1 fractional protective vegetation cover. */
  vegetation: Float32Array
  /** Shallow groundwater store below the root zone, mm (feeds baseflow). */
  groundwaterMm: Float32Array
  /** Ponded water held in wetland cells, mm (0 on non-wetland cells). */
  wetlandStoreMm: Float32Array
}

/** Per-cell outputs of the most recent step. Derived; never edited by actions. */
export interface StepFields {
  infiltrationMm: Float32Array
  runoffMm: Float32Array
  /** Water passing through the cell from upstream + local runoff, mm-equivalent over one cell. */
  flowMm: Float32Array
  /** Erosion pressure index (game units, RUSLE-inspired). */
  erosion: Float32Array
  /** Sediment deposited from upstream, game units. */
  sedimentIn: Float32Array
  /** Crop yield this step, tonnes (game-scaled), 0 for non-crop cells. */
  yieldT: Float32Array
  /** 0..1 water-limitation factor applied to vegetation/crops. */
  waterFactor: Float32Array
  /** Actual evapotranspiration this step, mm (includes irrigation consumed). */
  etMm: Float32Array
  /** Irrigation water applied this step, mm. */
  irrigationMm: Float32Array
  /** Sediment leaving the cell downstream this step, game tonnes. */
  sedimentFlux: Float32Array
  /** 1 if the cell was flooded this step (heavy flow near a channel). */
  flooded: Uint8Array
  /** Modelled flood water depth index above ground, metres (illustrative). */
  floodDepthM: Float32Array
}

export interface WeatherSeason {
  year: number
  season: Season
  rainfallMm: number
  /** Potential evapotranspiration, mm. */
  petMm: number
  /** Peak-intensity multiplier for erosion (1 = normal). */
  stormIntensity: number
  kind: 'normal' | 'drought' | 'heavy-rain' | 'favorable'
  /** Long-run normal rainfall for this season type, mm (for explanations). */
  normalRainfallMm: number
  /** True when the kind was placed by guided-scenario design rather than drawn at random. */
  designed: boolean
}

/** Exogenous demographic conditions for one season (seeded; never reads player state). */
export interface DemographySeason {
  /** Natural increase per season (births minus deaths), fraction of population. */
  naturalGrowthRate: number
  /** Regional migration pressure per season, potential arrivals as a fraction of population. */
  migrationPressure: number
}

export interface WaterLedger {
  rainMm: number
  infiltrationMm: number
  evapotranspirationMm: number
  storageChangeMm: number
  withdrawalsMm: number
  outflowMm: number
  wetlandRetentionMm: number
  reservoirStorageChangeMm: number
  /** Change in shallow groundwater storage, mm. */
  groundwaterChangeMm: number
  /** Irrigation diverted from river/reservoir and applied to fields, mm. Internal transfer:
   *  it already appears in ET / storage terms, so it is not subtracted again. */
  irrigationMm: number
  /** rain - (ET + withdrawals + outflow + soil, groundwater, wetland and reservoir storage changes); ~0.
   *  All terms are basin-mean mm (cell-mm summed over the grid divided by cell count).
   *  storageChangeMm is the root-zone soil store only; withdrawalsMm is consumptive town use. */
  residualMm: number
}

export interface Economy {
  budget: number
  debt: number
  /** Last step breakdown, currency units. */
  income: Record<string, number>
  expenses: Record<string, number>
  /** Fraction of last step's obligations that could be paid (1 = all). Below 1 means shortages:
   *  maintenance and farm programs ran at reduced level this step. */
  serviceLevel: number
  /** Obligations left unpaid last step (shortage), currency. They are not forgiven: the whole
   *  amount is added to debt as arrears, which accrue interest until repaid. */
  unpaid: number
  /** Hectares of timber sold so far this season (clearing forest or agroforestry). The timber
   *  price falls as this grows; it resets when the season is simulated. Missing means 0. */
  timberSoldHa?: number
  /** Cooperative levy rate the player has set with a 'set-levy' action (share of farm and tree
   *  product value). Missing means the map's starting rate (calibration.levy). The local tax per
   *  resident scales with it. */
  levyRate?: number
}

export interface Community {
  population: number
  housingCapacity: number
  jobs: number
  /** All 0..1. */
  housingAdequacy: number
  foodSecurity: number
  waterSecurity: number
  livelihood: number
  hazardExposure: number
  wellbeing: number
  stakeholders: Record<'farmers' | 'townspeople' | 'downstream', StakeholderView>
  /** People who want to live here: residents plus those turned away by lack of housing. */
  housingDemand: number
  laborForce: number
  /** Last step's population flows. */
  births: number
  arrivals: number
  departures: number
  /** Component values behind wellbeing (documented weights in params.WELLBEING_WEIGHTS). */
  wellbeingParts: { housing: number; food: number; water: number; livelihood: number; safety: number }
  /** Share of housing capacity still recovering from a flood (this season's flooded share, or last season's recovery x COMMUNITY.floodRecovery). Optional for older saves. */
  floodRecovery?: number
  /** Food grown here over the two-season window / need (0..2; imports excluded). Optional for older saves. */
  foodSelfSufficiency?: number
  /** What households paid this season for food bought from outside, currency (taken from household income before livelihood is scored). Optional for older saves. */
  foodImportCost?: number
}

export interface StakeholderView {
  income: number
  waterAccess: number
  hazardExposure: number
  note: string
}

export interface Totals {
  foodProducedT: number
  foodDemandT: number
  waterSupplyM3: number
  waterDemandM3: number
  meanSoilHealth: number
  forestCoverFrac: number
  meanErosion: number
  outletSedimentT: number
  floodedCells: number
  /** Previous step's local food production (food security uses a two-season window). */
  foodProducedPrevT: number
  foodImportedT: number
  townWaterDemandM3: number
  townWaterSuppliedM3: number
  irrigationDemandM3: number
  irrigationSuppliedM3: number
  /** Water leaving the map this step, m3. */
  outflowM3: number
  reservoirCapacityM3: number
  cropAreaHa: number
  agroforestryAreaHa: number
  urbanCells: number
  wetlandCells: number
  /** Sum of the erosion index over all cells this step (game tonnes). */
  totalErosionT: number
  floodedHousingCells: number
  /** Forest + wetland cells + half of agroforestry cells (tree and wetland cover). */
  naturalCover: number
  /** Household water from a waterworks (treated, piped), m3. Included in townWaterSuppliedM3. */
  pipedWaterM3: number
  /** Household water from roof tanks and shallow wells, m3. Included in townWaterSuppliedM3. */
  selfSupplyM3: number
  /** Livestock value from grazing grassland this step (to herding households), currency. */
  grazingValue: number
  /** Fuelwood, fodder and wild-food value from standing forest this step (to households), currency. */
  forestProductValue?: number
}

/** A grounded, data-backed explanation of a change. Every claim cites state values. */
export interface Explanation {
  id: string
  year: number
  season: Season
  topic: 'food' | 'water' | 'soil' | 'budget' | 'population' | 'flood' | 'vegetation' | 'event'
  severity: 'info' | 'good' | 'warning' | 'critical'
  title: string
  body: string
  /** Variables cited, with before/after values. */
  evidence: { label: string; before?: number; after: number; unit?: string }[]
  /** Optional cells to focus the camera on. */
  cells?: number[]
  /** Stable key of the condition this note reports (used to avoid repeating persistent conditions). */
  key?: string
}

export type PlayerAction =
  | { type: 'road'; cells: number[] }
  | { type: 'housing'; cells: number[] }
  | { type: 'cropland'; cells: number[]; intensity: Intensity; irrigated: boolean }
  | { type: 'set-intensity'; cells: number[]; intensity: Intensity }
  | { type: 'toggle-irrigation'; cells: number[] }
  | { type: 'agroforestry'; cells: number[] }
  | { type: 'clear'; cells: number[] }
  | { type: 'reforest'; cells: number[] }
  | { type: 'wetland'; cells: number[] }
  | { type: 'conservation'; cells: number[] }
  | { type: 'reservoir'; cells: number[] }
  | { type: 'waterworks'; cells: number[] }
  | { type: 'market'; cells: number[] }
  | { type: 'demolish'; cells: number[] }
  | { type: 'loan'; amount: number }
  | { type: 'repay'; amount: number }
  /** Set the cooperative levy (and with it the local tax) for the seasons that follow. */
  | { type: 'set-levy'; rate: number }

export type ActionType = PlayerAction['type']

export interface ActionValidation {
  ok: boolean
  cost: number
  /** Per-cell validity, aligned with action.cells (empty for non-cell actions). */
  cellOk: boolean[]
  reasons: string[]
  /** One-off revenue the action would earn (e.g. timber sale when clearing forest). */
  revenue?: number
  /** Per-cell reason for invalid cells, aligned with action.cells ('' when valid). */
  cellReasons?: string[]
  /** Hectares of timber the action would sell (its revenue already reflects the falling price). */
  timberHa?: number
}

export interface DecisionRecord {
  year: number
  season: Season
  action: PlayerAction
  cost: number
  /** Simulation step at which the action was applied (before that step ran). */
  step: number
  /** One-off revenue from the action (e.g. timber from clearing forest). */
  revenue: number
}

/** Compact per-step metrics kept for charts and comparison. */
export interface HistoryPoint {
  year: number
  season: Season
  weather: WeatherSeason['kind']
  rainfallMm: number
  budget: number
  debt: number
  population: number
  housingCapacity: number
  foodProducedT: number
  foodDemandT: number
  foodSecurity: number
  waterSecurity: number
  meanSoilHealth: number
  forestCoverFrac: number
  meanErosion: number
  outletSedimentT: number
  wellbeing: number
  income: number
  expenses: number
  /** Steps completed when this point was recorded (0 = pre-game baseline, labelled year 0 dry). */
  step: number
  stormIntensity: number
  housingAdequacy: number
  livelihood: number
  hazardExposure: number
  serviceLevel: number
  cropAreaHa: number
  activeCropCells: number
  meanCropSoilFactor: number
  meanCropWaterFactor: number
  meanCropManagementFactor: number
  meanCropEventFactor: number
  hillsideCropSoil: number
  totalErosionT: number
  floodedCells: number
  floodedHousingCells: number
  reservoirFillFrac: number
  irrigationSupplyRatio: number
  outflowM3: number
  treeProductValue: number
  meanVegetation: number
  arrivals: number
  departures: number
  peakFloodRatio: number
  settlementFloodRatio: number
  upstreamRunoffMm: number
  irrigatedCells: number
  /** Crop value plus tree product value this step (before the levy), currency. */
  farmValue: number
  /** River flow passing waterworks intakes (before abstraction), m3. */
  intakeFlowM3: number
  /** Mean shallow groundwater over land cells, mm. */
  meanGroundwaterMm: number
  /** Mean shallow groundwater around homes (3x3 neighbourhoods), mm. */
  homeGroundwaterMm: number
  /** Share of household need met by roof tanks and wells this step. */
  selfSupplyShare: number
  /** Share of household need met by piped (waterworks) water this step. */
  pipedShare: number
  grazingValue: number
  /** Forest product value to households this step, currency. */
  forestProductValue?: number
  reservoirM3: number
  /** Business-as-usual reference (same weather, no decisions since the start) for this step. */
  refTotalErosionT: number
  refOutletSedimentT: number
  refUpstreamRunoffMm: number
  refSettlementFloodRatio: number
  refFloodedHousingCells: number
  refMeanSoilHealth: number
  /** Food grown here / need over the two-season window (imports excluded). Optional for older saves. */
  foodSelfSufficiency?: number
  /** Household spending on bought food this step, currency. Optional for older saves. */
  foodImportCost?: number
  /** Livestock pressure on pasture against the start (1 = starting herd on starting fodder land). Optional for older saves. */
  grazingPressure?: number
}

/** Full-state snapshot for history scrubbing / compare (layers copied, terrain shared). */
export interface Snapshot {
  year: number
  season: Season
  layers: WorldLayers
  fields: StepFields
  community: Community
  economy: Economy
  totals: Totals
  /** Reservoir storage and trapped silt at the snapshot, m3 (absent in snapshots built outside the engine). */
  reservoirM3?: number
  reservoirSiltM3?: number
}

export interface WorldMeta {
  id: string
  name: string
  kind: 'procedural' | 'real-data-derived'
  description: string
  /** Free-text provenance shown in UI; must be truthful. */
  provenance: string
  bbox?: [number, number, number, number]
  crs?: string
  /** Data sources; `acquired` is the observation or snapshot period (ISO date or range), when known. */
  sources?: { name: string; version: string; license: string; url: string; acquired?: string }[]
}

export interface SimulationState {
  version: 1
  seed: number
  meta: WorldMeta
  terrain: Terrain
  layers: WorldLayers
  fields: StepFields
  /** Steps elapsed since start. step 0 = year 1 wet season, before simulation. */
  step: number
  year: number
  season: Season
  /** Full exogenous weather sequence, generated from seed at start; actions never change it. */
  weather: WeatherSeason[]
  economy: Economy
  community: Community
  totals: Totals
  ledger: WaterLedger
  /** Reservoir storage, m3. */
  reservoirM3: number
  explanations: Explanation[]
  decisions: DecisionRecord[]
  history: HistoryPoint[]
  /** Guided-scenario horizon in years (sandbox continues past it). */
  horizonYears: number
  /** Exogenous demographic sequence aligned with weather (seeded at start). */
  demography: DemographySeason[]
  /** Sediment trapped in reservoirs, m3 (reduces their usable capacity). */
  reservoirSiltM3: number
  /** Aggregated factors from the last step, used for grounded explanations. */
  diagnostics: StepDiagnostics
  /** Values at step 0, for objectives and "since the start" comparisons. */
  baseline: BaselineMetrics
  /** Per-map scenario settings fixed at game start from the starting landscape. */
  calibration: ScenarioCalibration
  /** Business-as-usual twin: the starting landscape with no decisions, run through the same weather. */
  reference: ReferenceRun
}

/** Per-map settings derived once from the starting landscape (see params.CALIBRATION). */
export interface ScenarioCalibration {
  /** Multiplier on residents per home cell (COMMUNITY.housingCapacity). */
  householdScale: number
  /** Residents per home cell by density level 0..3 after scaling. */
  residentsPerHome: number[]
  /** Cooperative levy rate on farm and tree product value. */
  levy: number
  /** Normal-year local food / need on the starting landscape before household scaling. */
  foodBalanceUnscaled: number
  /** Normal-year local food / need after scaling. */
  foodBalance: number
  /** Normal-year budget surplus of the starting village at the calibrated levy, currency per year. */
  normalYearSurplus: number
  /** Worst two-season local food / need of the starting farmland in a three-season drought, before household scaling. */
  droughtFoodBalanceUnscaled?: number
  /** The same after scaling (the starting residents). */
  droughtFoodBalance?: number
  /** Which rule set the household scale: the normal-year food target, the drought food target, or a bound. */
  householdScaleBy?: 'normal-year' | 'drought' | 'bound'
}

/** The business-as-usual twin. Land use stays as at the start; soil, vegetation and water evolve. */
export interface ReferenceRun {
  layers: WorldLayers
  reservoirM3: number
  reservoirSiltM3: number
  population: number
  /** Per-cell reference results of the last step (for run-on erosion and explanations). */
  runoffMm: Float32Array
  surfaceInMm: Float32Array
  erosion: Float32Array
  last: ReferenceOutcome
}

export interface ReferenceOutcome {
  totalErosionT: number
  outletSedimentT: number
  upstreamRunoffMm: number
  settlementFloodRatio: number
  peakFloodRatio: number
  floodedHousingCells: number
  meanSoilHealth: number
  outflowM3: number
}

/** Area-weighted means and flows from one step. All derived from layers and fields. */
export interface StepDiagnostics {
  cropCells: number
  /** Cropland cells that were actually cropped this step (dry season needs irrigation). */
  activeCropCells: number
  meanSoilFactor: number
  meanWaterFactor: number
  meanManagementFactor: number
  meanEventFactor: number
  /** Mean soil health on cropland with slope above params.SENSITIVE_SLOPE. */
  hillsideCropSoil: number
  hillsideCropCells: number
  meanCropErosion: number
  matureAgroforestryCells: number
  treeProductValue: number
  youngRestorationCells: number
  matureRestorationCells: number
  /** Turbidity multiplier on water treatment cost (1 = clear water). */
  intakeTurbidity: number
  reservoirFillFrac: number
  floodedCropCells: number
  /** Peak flood ratio on the main river (peak flow / bankfull), max over main-stem channel cells. */
  peakFloodRatio: number
  /** Flood ratio at the river cells that housing drains to (the village's flood risk this step). */
  settlementFloodRatio: number
  cropValue: number
  /** Mean quick runoff over the cells upstream of the village intake, mm. */
  upstreamRunoffMm: number
  meanCropWaterFactorRainfed: number
  meanGroundwaterMm: number
  homeGroundwaterMm: number
  grazingValue: number
  /** Mean support-practice factor P applied on hillside crop fields with conservation (1 if none). */
  hillsideConservationP: number
  hillsideConservationCells: number
  /** River flow passing waterworks intakes before abstraction, m3. */
  intakeFlowM3: number
  /** Livestock pressure on pasture this step against the start (see models/grazing). Optional for older saves. */
  grazingPressure?: number
}

export interface BaselineMetrics {
  meanSoilHealth: number
  forestCoverFrac: number
  population: number
  housingCapacity: number
  budget: number
  wetlandCells: number
  meanCropSoilHealth: number
  /** Normal-weather outflow leaving the map from the spin-up run, m3 (downstream reference). */
  referenceOutflowM3: { wet: number; dry: number }
  /** Normal-weather sediment leaving the map from the spin-up run, game tonnes. */
  referenceSedimentT: { wet: number; dry: number }
  /** Normal-weather erosion index total on the starting landscape, game tonnes. */
  referenceErosionT: { wet: number; dry: number }
  /** Forest + wetland cells + half of agroforestry cells at the start. */
  naturalCover: number
  /** Normal shallow groundwater level per cell (mean of the spin-up wet and dry seasons), mm. */
  groundwaterRefMm: Float32Array
  /** Fodder land at the start in grassland-equivalent cells (see models/grazing). Optional for older saves. */
  fodderUnits?: number
}

export interface StepResult {
  state: SimulationState
  explanations: Explanation[]
  snapshot: Snapshot
}

export interface SimulationEngine {
  createInitialState(world: WorldInput, seed: number): SimulationState
  validateAction(state: SimulationState, action: PlayerAction): ActionValidation
  applyAction(state: SimulationState, action: PlayerAction): { state: SimulationState; validation: ActionValidation }
  step(state: SimulationState): StepResult
}

/** What a world loader (procedural or GIS) provides. */
export interface WorldInput {
  meta: WorldMeta
  width: number
  height: number
  cellSizeM: number
  elevationM: Float32Array
  cover: Uint8Array
  /** Optional initial structures (village, road). */
  structure?: Uint8Array
  structureLevel?: Uint8Array
  protected?: Uint8Array
  channel?: Uint8Array
  /** Optional initial irrigated cropland flags. */
  irrigated?: Uint8Array
  /** Optional initial cropland intensity codes (index into INTENSITIES). */
  intensity?: Uint8Array
}

export const coverCode = (c: LandCover): CoverCode => LAND_COVERS.indexOf(c)
export const coverName = (code: CoverCode): LandCover => LAND_COVERS[code] ?? 'bare'
export const structureCode = (s: Structure): number => STRUCTURES.indexOf(s)
export const structureName = (code: number): Structure => STRUCTURES[code] ?? 'none'
