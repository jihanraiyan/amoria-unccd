// Every model coefficient, cost, rate and event parameter in one place.
//
// Each entry is tagged:
//   'evidence-informed': the form or rough magnitude follows a published method or widely used
//                        reference (named in the note). The value is still a simplification.
//   'game-balance':      chosen to make the game playable and the tradeoffs legible. Not a
//                        measured or calibrated value.
// All model outputs are illustrative game units, not predictions for any real place.
// See docs/MODEL_ASSUMPTIONS.md for the equations that use these values.

export type Evidence = 'evidence-informed' | 'game-balance'
export interface Param<T> {
  value: T
  evidence: Evidence
  note: string
}
const ev = <T>(value: T, note: string): Param<T> => ({ value, evidence: 'evidence-informed', note })
const gb = <T>(value: T, note: string): Param<T> => ({ value, evidence: 'game-balance', note })

type CoverTable = Record<
  'forest' | 'grassland' | 'cropland' | 'agroforestry' | 'urban' | 'wetland' | 'water' | 'bare',
  number
>

// ---------------------------------------------------------------- time and climate
export const TIME = {
  seasonsPerYear: gb(2, 'Two steps per year: a wet season then a dry season.'),
  horizonYears: gb(20, 'Guided scenario length.'),
  weatherYears: gb(100, 'Weather is generated once for this many years (sandbox continues past the horizon).'),
  subSteps: gb(3, 'Each season is split into 3 sub-periods for the soil water balance so storage limits matter.'),
}

export const CLIMATE = {
  rainMm: gb(
    { wet: 420, dry: 110 },
    'Semi-arid seasonal rainfall, about 530 mm a year. Gives a UNEP aridity index (P/PET) near 0.45, inside the semi-arid band.',
  ),
  petMm: gb({ wet: 430, dry: 750 }, 'Seasonal potential evapotranspiration for a warm semi-arid valley.'),
  subStepRainFrac: gb({ wet: [0.3, 0.4, 0.3], dry: [0.5, 0.3, 0.2] }, 'How season rain is spread over its 3 sub-periods.'),
  eventsPerSeason: gb({ wet: 24, dry: 8 }, 'Number of rain events per season used by the curve-number runoff split.'),
  eventClasses: gb(
    [
      { frac: 0.4, depthMult: 0.4 },
      { frac: 0.4, depthMult: 1.0 },
      { frac: 0.2, depthMult: 2.2 },
    ],
    'Small, medium and large storms (mean depth multiplier is 1.0). Large storms make most of the runoff, as in real rainfall records.',
  ),
  orographicPerM: gb(0.0006, 'Rain increases 0.06% per metre above the basin mean elevation (mild orographic effect).'),
  kinds: gb(
    {
      normal: { rain: 1.0, rainNoise: 0.1, pet: 1.0, petNoise: 0.04, intensity: 1.0, intensityNoise: 0.1 },
      favorable: { rain: 1.15, rainNoise: 0.06, pet: 0.96, petNoise: 0.03, intensity: 0.9, intensityNoise: 0.05 },
      drought: { rain: 0.45, rainNoise: 0.07, pet: 1.12, petNoise: 0.03, intensity: 1.0, intensityNoise: 0.1 },
      'heavy-rain': { rain: 1.75, rainNoise: 0.1, pet: 0.93, petNoise: 0.03, intensity: 2.1, intensityNoise: 0.15 },
    },
    'Multipliers on the seasonal normal for each weather kind. Heavy rain means more rain falling in bigger storms.',
  ),
  transition: gb(
    {
      // probability of each kind given the previous season was a drought / not a drought
      wet: { afterDrought: { drought: 0.5, 'heavy-rain': 0.05, favorable: 0.05 }, otherwise: { drought: 0.12, 'heavy-rain': 0.12, favorable: 0.16 } },
      dry: { afterDrought: { drought: 0.5, 'heavy-rain': 0.0, favorable: 0.05 }, otherwise: { drought: 0.12, 'heavy-rain': 0.03, favorable: 0.12 } },
    },
    'Markov weather: droughts tend to persist across seasons. Remaining probability is a normal season.',
  ),
  guided: gb(
    {
      graceYears: 2,
      droughtStartYear: [6, 11] as [number, number],
      droughtSeasons: 3,
      heavyRainYear: [3, 8] as [number, number],
    },
    'Scenario design for the guided 20 years: calm first 2 years, a guaranteed 3-season drought starting in a wet season of years 6 to 11, and a guaranteed heavy-rain wet season in years 3 to 8.',
  ),
}

export const DEMOGRAPHY = {
  naturalGrowth: gb({ base: 0.008, noise: 0.002 }, 'Natural increase per season (about 1.6% a year).'),
  migration: gb(
    { base: 0.006, wavePeak: 0.014, waveYear: 9, waveWidthYears: 4, noise: 0.002 },
    'Regional migration pressure per season: a seeded wave peaking around year 9 (people moving from drier areas).',
  ),
}

// ---------------------------------------------------------------- hydrology
export const HYDRO = {
  curveNumber: ev(
    {
      forest: { good: 55, poor: 66 },
      grassland: { good: 61, poor: 79 },
      cropland: { good: 78, poor: 81 },
      croplandConservation: { good: 71, poor: 74 },
      agroforestry: { good: 58, poor: 73 },
      wetland: { good: 70, poor: 80 },
      bare: { good: 86, poor: 91 },
      housing: { good: 85, poor: 85 },
      housingDense: { good: 92, poor: 92 },
      road: { good: 98, poor: 98 },
    },
    'USDA NRCS TR-55 (1986) curve numbers for hydrologic soil group B: woods, pasture, straight-row and contoured+terraced row crops, woods-grass combination, fallow bare soil, 1/8-acre residential, commercial, paved roads. Bare land runs from 86 (TR-55 bare fallow, group B) when it has regrown some cover to 91 when freshly cleared and compacted: 91 is the TR-55 bare-fallow value for group C, used here as a stand-in for a crusted, compacted surface (see compaction). Wetland values are game-balance (TR-55 has no wetland class).',
  ),
  initialAbstractionRatio: ev(0.2, 'Ia = 0.2 S, the standard TR-55 assumption.'),
  amcWeight: gb(
    0.5,
    'Antecedent-moisture adjustment is applied at half strength: CN moisture classes are defined for about 5 days of prior rain, while our soil store is seasonal.',
  ),
  conditionWeights: gb({ vegetation: 0.55, soil: 0.45 }, 'Hydrologic condition (poor to good) from vegetation cover and soil health.'),
  soilCapacityMm: gb(130, 'Root-zone available water capacity at full soil health and rooting factor 1, mm (FAO-56 TAW concept).'),
  soilCapacityHealthFloor: gb(0.55, 'Capacity multiplier at soil health 0 (degraded soils hold less water).'),
  rootDepthFactor: gb(
    { forest: 1.4, grassland: 0.9, cropland: 1.0, agroforestry: 1.25, urban: 0.25, wetland: 1.2, water: 0, bare: 0.6 } satisfies CoverTable,
    'Relative rooting depth: trees reach deeper soil water (FAO-56 Zr idea). Forest 1.4 means a root zone 40% deeper than a field crop, so trees keep transpiring longer into a dry season. Kept moderate because most of a tree root system sits in the upper metre of soil.',
  ),
  depletionFraction: ev(0.5, 'FAO-56 depletion fraction p: plants start to suffer when more than half of the available water is used.'),
  kc: ev(
    { forest: 0.9, grassland: 0.75, cropland: 0.9, agroforestry: 0.9, urban: 0.25, wetland: 1.05, water: 1.05, bare: 0.3 } satisfies CoverTable,
    'Season-average crop coefficients in the spirit of FAO-56 (Allen et al. 1998). Cropland 0.9 is the mean of initial, mid and late stages.',
  ),
  kcSoil: ev(0.3, 'Soil-evaporation floor for sparse cover (FAO-56 Ke magnitude).'),
  kcFallow: gb(0.3, 'Cropland with no crop in the season (rainfed land in the dry season).'),
  kcHighIntensityMult: gb(1.1, 'High-input farming grows more biomass and uses more water.'),
  runOnFrac: gb(
    { forest: 0.5, grassland: 0.3, cropland: 0.25, agroforestry: 0.45, urban: 0.05, wetland: 0.6, water: 0, bare: 0.1 } satisfies CoverTable,
    'Share of runoff arriving from upslope that soaks in on this cell (run-on infiltration).',
  ),
  runOnConservationFrac: gb(0.4, 'Terraces and contour bunds slow water so more run-on soaks in.'),
  runOnCapMm: gb(25, 'Maximum run-on infiltration per sub-period when the soil is dry, mm.'),
  compaction: gb(
    { recoveredVegetation: 0.14, rechargeMult: 0.35, saturationExcessShare: 0.6 },
    'Freshly cleared or overgrazed bare land is compacted and crusted: it loses the root channels and soil structure that let water soak in deeply. Compaction = 1 - vegetation / 0.14 on bare land (0 once it has regrown the cover bare land can carry, and 0 on every other cover). It moves the curve number toward its poor value, cuts preferential recharge to 35% at full compaction, and sends up to 60% of the water the shallow root zone cannot hold over the surface instead of down to groundwater. This is the infiltration side of the trade-off described by Bruijnzeel (2004): removing trees lowers transpiration, but if soil infiltration is degraded, more rain leaves as storm runoff and less recharges the dry-season flow. Magnitudes are game-balance.',
  ),
  rechargeCoef: gb(0.16, 'Share of infiltration that bypasses the root zone (preferential flow) to shallow groundwater, scaled by wetness.'),
  baseflowPerSeason: gb(0.35, 'Fraction of shallow groundwater released to streams each season (linear reservoir).'),
  wetland: gb(
    { capacityMm: 400, captureFrac: 0.6, releasePerSeason: 0.3 },
    'Wetland ponding store: captures part of surface inflow, releases it slowly as baseflow.',
  ),
  openWaterKc: ev(1.05, 'Open-water evaporation relative to reference ET (FAO-56 order of magnitude).'),
  channelEvap: gb(
    { maxShare: 1, fullWidthFlowMmPerCell: 3, widthExponent: 0.5 },
    'Evaporation from a river channel cell = open-water rate x wetted share. The wetted share shrinks as flow falls: share = min(1, (flow / (3 mm x upstream cells))^0.5) per sub-period. A low river is narrow, so it loses less to evaporation than a full one. The exponent is a game-balance choice: about 0.5 is the width exponent Leopold and Maddock (1953) found in the downstream direction (between rivers of different size); at a single station, as here (one cell as its flow changes over time), they found about 0.26. We use 0.5 so that low rivers shrink faster. The 3 mm reference (the sub-period flow per upstream cell at which the channel cell is fully wet) is also game-balance.',
  ),
  reservoir: gb(
    { capacityM3PerCell: 120_000, envReleaseFrac: 0.15, domesticReserveFrac: 0.3 },
    'Each reservoir cell stores about 12 m depth over 1 ha; 15% of inflow always passes downstream; irrigation may not draw the last 30% of capacity, which is kept for household water (a simple operating rule).',
  ),
  townUseM3PerPersonSeason: gb(18.25, 'About 100 litres per person per day for homes, livestock watering and small businesses.'),
  waterworksCapacityM3: gb(36_000, 'River abstraction and treatment capacity per waterworks per season: enough for about 2 000 people at 100 litres a day, so a growing town needs more than one.'),
  envFlowLimit: gb(0.3, 'At most 30% of the river flow at an intake can be abstracted (environmental flow rule), so in a dry season after a drought the river alone cannot serve a large town.'),
  irrigationRainCredit: gb(
    0.85,
    'Irrigation demand is estimated before the season is simulated as crop water need minus stored soil water minus 85% of the season rain (the share expected to soak in rather than run off). The actual delivery then goes through the soil water balance, so this only sizes the request.',
  ),
  uplandHandM: gb(8, 'Cells more than 8 m above their nearest channel count as hillside upland in the hillside quick-runoff diagnostic shown in flood explanations.'),
  roadKcMult: gb(0.5, 'Roads evaporate half the urban rate (mostly paved or compacted, little vegetation).'),
  conditionSoilRef: gb(0.8, 'Soil health at which the soil half of the hydrologic condition counts as fully good.'),
  orographicBounds: gb([0.8, 1.25] as [number, number], 'The orographic rain factor is kept between 0.8 and 1.25 of the valley rain.'),
  irrigationEfficiency: gb(0.8, 'Share of diverted irrigation water reaching the root zone; the rest seeps to groundwater.'),
  irrigationReachCells: gb(8, 'Canals reach cropland up to this many cells (800 m) from the source that feeds them: a waterworks intake on the river or a reservoir.'),
  irrigationMaxLiftM: gb(12, 'Fields may sit at most 12 m above the water level at their source (a small pump lift); higher fields cannot be served.'),
  irrigationDiversionM3: gb(
    80_000,
    'Raw-water diversion capacity per waterworks headworks for irrigation canals, per season. Separate from the treated household capacity and never treated, so it pays canal operation but no treatment cost.',
  ),
  selfSupply: gb(
    {
      roofM2PerPerson: 12,
      roofRunoffCoef: 0.8,
      tankM3PerPersonSeason: 3.5,
      wellShareMax: 0.3,
      wellDrawFrac: 0.5,
      wellRadiusCells: 1,
    },
    'Household self-supply where piped water falls short. Roof tanks collect rain on about 12 m2 of roof per person (a runoff share of 0.8), up to 3.5 m3 a person a season. Shallow wells near homes can meet at most 30% of household need, in proportion to how full the shallow groundwater around the home is compared with its normal level, and never take more than half of that stored water in a season. Piped, treated water from a waterworks is used first.',
  ),
  flood: gb(
    { bankfullFactor: 1.5, depthPerRatioM: 1.1, maxDepthM: 4.5, maxDistanceCells: 5, intensityExponent: 0.5 },
    'Peak flow = quick flow x storm intensity^0.5 + baseflow, in the wettest sub-period. The river overflows when peak flow exceeds bankfull (1.5 times the reference normal wet-season peak, roughly a 1 to 2 year flood). Floodwater depth grows with the excess and reaches floodplain cells lower than that depth (HAND).',
  ),
}

// ---------------------------------------------------------------- soil and erosion
export const SOIL = {
  erosivityPerMm: gb(1.0, 'Rainfall erosivity R per mm of seasonal rain, times storm intensity (RUSLE R in game units).'),
  erodibility: ev(
    { base: 0.032, healthy: 0.7, degraded: 1.3 },
    'RUSLE K for a loam is near 0.03 (SI units); degraded soil with less organic matter is more erodible (Wischmeier and Smith 1978 nomograph trend). Multiplier runs from 1.3 at soil health 0 to 0.7 at 1.',
  ),
  lsExponents: ev({ m: 0.4, n: 1.3 }, 'Moore and Burch (1986) unit-stream-power LS: (As/22.13)^0.4 * (sin b / 0.0896)^1.3.'),
  lsMaxContribCells: gb(3, 'Slope length is capped at 3 cells (300 m) because flow concentrates into channels beyond that.'),
  cMin: gb(
    { forest: 0.001, grassland: 0.01, cropland: 0.22, agroforestry: 0.05, urban: 0.003, wetland: 0.001, water: 0, bare: 0.45 } satisfies CoverTable,
    'Cover-management C at full vegetation. Cropland value is for medium intensity (tillage keeps it high).',
  ),
  cIntensity: gb({ low: 0.16, medium: 0.22, high: 0.32 }, 'Cropland C floor by intensity: more tillage, less residue.'),
  sealedShare: gb(
    { housing: [0, 0.3, 0.5, 0.7], road: 0.5, market: 0.7, waterworks: 0.7, urban: 0.3 },
    'Share of a built cell covered by roofs and paving, which cannot erode. The rest (yards, verges, unpaved tracks) erodes like soil with the cell vegetation. Rural earth roads are counted as half sealed.',
  ),
  cCoverDecay: ev(4.5, 'C = Cmin + (1 - Cmin) * exp(-b * vegetation). Exponential form follows the RUSLE surface-cover subfactor (Renard et al. 1997, AH-703); b chosen for balance.'),
  pContouring: ev(
    [
      [0.015, 0.6],
      [0.04, 0.5],
      [0.07, 0.5],
      [0.105, 0.6],
      [0.145, 0.7],
      [0.185, 0.8],
      [0.23, 0.9],
    ] as [number, number][],
    'Support practice P for contour farming by slope (rise/run, P), from the contouring table in Wischmeier and Smith (1978), Agriculture Handbook 537: 0.6 at 1 to 2%, 0.5 at 3 to 8%, 0.6 at 9 to 12%, 0.7 at 13 to 16%, 0.8 at 17 to 20%, 0.9 at 21 to 25%. Values are interpolated between class midpoints.',
  ),
  pSteepLimit: gb(
    { slope: 0.3, p: 1.0 },
    'The table stops at 25%. Above it we assume contour practices lose their effect, reaching P = 1 at 30% slope (a conservative choice: real bench terraces can do better, but they are not modelled separately).',
  ),
  pAgroforestry: gb(0.7, 'Tree rows act as partial contour barriers.'),
  maxErosion: gb(
    150,
    'Knee of the soft ceiling on the seasonal erosion index per cell (game tonnes per ha). Below it the index is used as computed. Above it the index bends smoothly toward erosionCeiling: E = knee + (ceiling - knee) x (1 - exp(-(A - knee) / (ceiling - knee))). The bend is continuous with slope 1 at the knee and always rising, so a harder storm, a steeper slope or less cover always means more erosion; only extreme values on bare steep land are compressed. Game-balance.',
  ),
  erosionCeiling: gb(1500, 'Ceiling the soft-capped erosion index approaches but never reaches (game tonnes per ha). Game-balance.'),
  runoffErosion: ev(
    { exponent: 0.56, offsetMm: 5, min: 0.5, max: 2 },
    'Run-on multiplier on the erosion index: ((own reference runoff + surface water arriving from upslope + 5) / (the same with the business-as-usual inflow + 5))^0.56, bounded to 0.5..2. The 0.56 exponent on runoff is the one in MUSLE (Williams 1975); the offset and bounds are game-balance.',
  ),
  reservoirTrap: gb(
    { max: 0.9, halfRatio: 0.05 },
    'Share of incoming sediment a reservoir keeps = 0.9 x r / (r + 0.05), where r is storage capacity over the season inflow. Brune (1953) showed trap efficiency rising with the capacity-to-inflow ratio; this curve has that shape but its numbers are game-balance.',
  ),
  trap: gb(
    { landBase: 0.05, landVeg: 0.55, slopeScale: 0.1, wetland: 0.6, reservoir: 0.9, urban: 0.05 },
    'Share of incoming sediment deposited in a cell: high on flat vegetated land (buffers), wetlands and reservoirs; none in channels. Inspired by the connectivity idea in InVEST SDR.',
  ),
  siltDensityTPerM3: ev(1.3, 'Bulk density of deposited reservoir sediment, about 1.3 t/m3.'),
  healthLossPerT: gb(0.00015, 'Soil health lost per game tonne of erosion index.'),
  intensityPressure: gb({ low: 0, medium: 0.0012, high: 0.006 }, 'Soil health lost per cropped season from nutrient mining and tillage.'),
  conservationPressureMult: gb(0.5, 'Conservation practice halves intensity pressure (residue, cover crops).'),
  grazingPressure: gb(0.0005, 'Soil health lost per season on grazed grassland (trampling and bite), before recovery.'),
  recoveryRate: gb(0.08, 'Recovery per season toward the cover maximum, scaled by vegetation and water. With typical cover this gives a soil time scale of roughly 8 years under forest and 20 years on farmland.'),
  recoveryMoisture: gb(
    { floor: 0.5 },
    'Soil recovery runs at half speed in a completely dry season and full speed with no water stress: moisture factor = 0.5 + 0.5 x water factor. Soil life and roots rebuild organic matter faster in moist soil.',
  ),
  maxHealth: gb(
    { forest: 0.84, grassland: 0.68, cropland: 0.66, agroforestry: 0.8, urban: 0.5, wetland: 0.86, water: 0.5, bare: 0.4 } satisfies CoverTable,
    'Soil health each cover tends toward when undisturbed by erosion, farming or grazing. Starting soil is spun up to the balance between these maxima and the losses on each cell (see SPINUP).',
  ),
  maxHealthConservation: gb(0.76, 'Cropland under conservation practice can build soil to this level.'),
  conversionDecline: gb(0.02, 'Organic matter loss per season when soil is above the new cover maximum (after clearing).'),
  bounds: gb({ min: 0.05, max: 1 }, 'Soil health index bounds.'),
  lossTaper: gb(
    0.1,
    'Soft lower bound on soil health. Losses from erosion and cropping are multiplied by 1 - exp(-(soil health - 0.05) / 0.1): about 1 on any soil above 0.4, 0.39 at 0.1, and 0 at the 0.05 floor, because a soil with almost no topsoil or organic matter left has little more to lose. Cells therefore settle above the floor, where they still respond to storms, cover and conservation. Game-balance.',
  ),
  sensitiveSlope: gb(0.1, 'Slopes above 10% count as sensitive hillsides in diagnostics and explanations.'),
}

// ---------------------------------------------------------------- vegetation
export const VEG = {
  target: gb(
    {
      forest: { wet: 0.92, dry: 0.88 },
      grassland: { wet: 0.68, dry: 0.45 },
      cropland: { wet: 0.62, dry: 0.58 },
      fallow: { wet: 0.18, dry: 0.18 },
      fallowConservation: { wet: 0.32, dry: 0.32 },
      agroforestry: { wet: 0.8, dry: 0.68 },
      housing: { wet: 0.12, dry: 0.1 },
      road: { wet: 0.04, dry: 0.04 },
      wetland: { wet: 0.9, dry: 0.82 },
      bare: { wet: 0.14, dry: 0.08 },
    },
    'Fractional protective cover each land use tends toward with enough water and soil.',
  ),
  matureSeasons: gb({ forest: 20, agroforestry: 12, wetland: 6, other: 1 }, 'Seasons for restored cover to reach maturity: forest 10 years, agroforestry 6, wetland 3.'),
  establishFrac: gb({ forest: 0.25, agroforestry: 0.3, wetland: 0.3 }, 'Share of the mature cover target present at planting.'),
  understory: gb(
    { share: 1 },
    'Young plantings keep a grass and herb layer on the ground the canopy does not yet cover. Target cover = tree cover + (1 - tree cover / mature tree cover) x share x grassland target, so a new planting holds about as much ground cover as grassland and the herb layer fades as the canopy closes. Planting seedlings into a grass sward does not strip it.',
  ),
  growthRate: gb({ trees: 0.35, herbs: 0.7, wetland: 0.5 }, 'Fraction of the gap to target closed per season when growing.'),
  diebackRate: gb({ trees: 0.2, herbs: 0.6, wetland: 0.4 }, 'Fraction of the excess over target lost per season under stress. Trees resist drought.'),
  waterLimit: gb({ floor: 0.35 }, 'Target multiplier = floor + (1 - floor) * water factor.'),
  soilLimit: gb({ floor: 0.5, full: 0.6 }, 'Target multiplier rises from 0.5 at soil health 0 to 1 at 0.6 and above.'),
  youngTreeDroughtLoss: gb({ waterFactor: 0.35, loss: 0.08 }, 'Young plantings (maturity under half) lose cover in severe water stress.'),
  succession: gb({ minAge: 8, minVeg: 0.12, minSoil: 0.3 }, 'Bare land left alone for 4 years with some regrowth reverts to grassland.'),
}

// ---------------------------------------------------------------- agriculture
export const AGRI = {
  potentialT: gb({ wet: 2.4, dry: 2.0 }, 'Potential staple yield per ha per season (dry season needs irrigation).'),
  ky: ev(1.25, 'FAO Irrigation and Drainage Paper 33 (Doorenbos and Kassam 1979): 1 - Ya/Ym = Ky (1 - ETa/ETm); Ky about 1.25 for maize.'),
  kyAgroforestryCrop: gb(0.9, 'Intercrops under trees are buffered by shade and deeper tree roots.'),
  soilFactor: gb({ intercept: 0.25, slope: 1.0, max: 1.05 }, 'Soil factor = clamp(0.25 + soil health, 0.25, 1.05).'),
  management: gb({ low: 0.7, medium: 1.0, high: 1.35 }, 'Yield multiplier by input intensity.'),
  conservationYieldMult: gb(0.95, 'Terraces and strips take a little land out of production.'),
  agroforestryCropMult: gb(0.5, 'Staple yield share under agroforestry (trees take space and light).'),
  floodedYieldMult: gb(0.35, 'Event factor on a flooded field.'),
  sediment: gb({ thresholdT: 25, lossPerT: 1 / 300, maxLoss: 0.4 }, 'Crop burial when deposited sediment exceeds 25 game tonnes.'),
  inputCost: gb({ low: 0, medium: 15, high: 55 }, 'Farm program cost per cropped ha per season (seed, fertiliser), paid from the budget.'),
  irrigationOpexPerM3: gb(0.02, 'Pumping and canal operation per m3 diverted.'),
  cropPrice: gb(260, 'Value of one tonne of staple, currency.'),
  levy: gb(0.2, 'Reference share of farm and tree product value that reaches the community budget (cooperative levy). The starting rate is set per map at game start (see CALIBRATION); the player can then change it with the set-levy action (see ECON.ratePolicy).'),
  treeProduct: gb(
    { valuePerHa: 300, startAge: 6, fullAge: 14, waterSensitivity: 0.4 },
    'Agroforestry fruit, fodder and timber value per ha per season, ramping up from 3 to 7 years after planting. Trees tap deeper water, so only 40% of the value responds to the season water factor: value x (0.6 + 0.4 x water factor). It is also scaled by the soil factor, so trees on worn soil earn less.',
  ),
  grazing: gb(
    { valuePerHa: 22, fullVegetation: 0.68 },
    'Livestock value from grazing per ha of grassland per season, scaled by grass cover (full at 0.68) and the soil factor. It goes to herding households, not through the cooperative levy, so converting pasture costs livelihoods.',
  ),
  livestock: gb(
    {
      herdElasticity: 0.5,
      fodder: { grassland: 1, agroforestry: 1.5, cropland: 0.3, forest: 0.15, wetland: 0.4 },
      maxPressure: 3,
      soilPressurePerExcess: 4,
      coverLossPerExcess: 0.6,
    },
    'Livestock pressure on pasture. Herds grow with the town, but more slowly, because many new residents take non-farm work: herd = reference herd x (population / reference population)^0.5, where the reference is the starting homes full (the pasture is taken to be in balance with that village). Fodder land counts each pasture cell as 1, a fodder-tree agroforestry plot as 1.5 (tree fodder plus the grass under it), cropland as 0.3 (crop residues grazed after harvest), forest as 0.15 and wetland as 0.4 (browse and dry-season grazing). Pressure = (herd / starting herd) / (fodder land / starting fodder land), at most 3, and at most 1 on the starting landscape with the starting homes. Each unit of pressure above 1 multiplies the grazing soil loss by 1 + 4 x excess and divides the grass cover target by 1 + 0.6 x excess, so overgrazed pasture has less cover, erodes more and earns herders less. Overgrazing as a driver of land degradation in drylands is well documented (it is one of the main drivers named by the UNCCD), but these numbers are game-balance, not measured stocking rates.',
  ),
  forestProducts: gb(
    { valuePerHa: 18, fullVegetation: 0.88 },
    'Value households get from standing forest per ha per season (fuelwood, fodder, wild foods, honey, building poles), scaled by canopy cover (full at 0.88). It goes to households, not through the cooperative levy, and stops when the forest is cleared, so clearing forest for pasture trades one livelihood for another. Game-balance.',
  ),
  foodPerPersonT: gb(0.19, 'Staple need per person per season (380 kg a year of staple-equivalent food and feed, game units).'),
  imports: gb(
    { maxShare: 0.3, pricePerT: 420 },
    'Households can buy food from outside for at most 30% of need, scaled by livelihood (poorer households can buy less). They pay 420 a tonne (more than the 260 farm-gate price of local staple) out of household income, so relying on bought food lowers livelihoods. Food security counts bought food; food self-sufficiency (grown here over need) does not.',
  ),
}

// ---------------------------------------------------------------- economy
export const ECON = {
  startBudget: gb(300_000, 'Initial community development fund.'),
  maxDebt: gb(400_000, 'Borrowing limit for development loans.'),
  interestPerSeason: gb(0.015, 'Loan interest per season (about 3% a year, a concessional development loan).'),
  capex: gb(
    {
      road: 1400,
      roadSlopeMult: 3,
      bridge: 9000,
      housing: 7900,
      housingUpgrade: 12_000,
      cropland: 1400,
      clearForestExtra: 2000,
      drainWetlandExtra: 2000,
      irrigation: 1800,
      setIntensity: 300,
      agroforestry: 4500,
      clear: 1100,
      reforest: 3000,
      wetland: 6000,
      conservation: 1500,
      conservationSlopeMult: 2,
      reservoir: 60_000,
      waterworks: 45_000,
      market: 30_000,
      demolish: 1000,
    },
    'One-off costs per cell. Building costs (road, housing, cropland, waterworks, market) are for open ground (bare land or a harvested field). Building on land with other cover first pays to remove it, exactly what the clear action charges: clear (1 100) on grassland and agroforestry, clear + clearForestExtra (3 100) on forest, clear + drainWetlandExtra (3 100) on wetland, and the timber is sold either way. So farming grassland costs 1 100 + 1 400 = 2 500 and building homes on forest 3 100 + 7 900 = 11 000, the same whether done in one step or two. Road slope cost applies to the building part. A road over a river channel or open water is a bridge at a flat 9 000 per cell, about six times a road, with no clearing or slope cost; it keeps the road upkeep.',
  ),
  timberPerCell: gb({ forest: 1900, agroforestry: 800 }, 'Timber sale when clearing, scaled by vegetation cover: clearing forest pays now. This is the price for the first hectare sold in a season (see timberMarket).'),
  timberMarket: gb(
    { halfPriceHa: 10 },
    'The local timber market is small. The price per hectare falls as more is sold in the same season: price = full price / (1 + ha already sold this season / 10), so the 10th hectare fetches half price and the 30th a quarter. Revenue from selling N ha in a season grows only with the logarithm of N, so liquidating the forest is not a money machine. The count resets each season.',
  ),
  maintenance: gb(
    {
      road: 12,
      housingPerLevel: 25,
      reservoir: 900,
      waterworks: 1500,
      treatmentPerM3: 0.06,
      market: 700,
      wetland: 30,
      conservation: 15,
      irrigatedCell: 20,
      youngPlanting: 25,
    },
    'Recurring costs per season. Young plantings need protection for their first 4 seasons.',
  ),
  housingTaxPerResident: gb(7, 'Local tax per resident per season at the starting levy. It scales with the levy rate the player sets (see ratePolicy).'),
  ratePolicy: gb(
    { min: 0.02, max: 0.35, arrivalSensitivity: 0.35, arrivalFactorMin: 0.4, arrivalFactorMax: 1.25 },
    'The levy lever. The player may set the cooperative levy between 2% and 35% of farm and tree product value; the local tax per resident moves by the same multiple of its starting value. The money comes out of household income (farm households keep 1 - levy of their sales, and every resident pays the extra tax above the starting rate), so livelihood falls as the rate rises. Newcomers are also put off: arrivals are multiplied by 1 - 0.35 x (rate / starting rate - 1), kept between 0.4 and 1.25. Game-balance, so there is a SimCity-style choice between a richer fund and a more attractive town.',
  ),
  servicesPerResident: gb(4, 'Schools, clinics and waste services per resident per season.'),
  waterTariffPerM3: gb(0.2, 'Households pay for treated water supplied.'),
  market: gb({ feePerResident: 1.5, cropShare: 0.03, priceBoost: 0.08, maxMarkets: 3 }, 'Market fees and better crop prices (8% per market, up to 3).'),
  floodRepair: gb({ housingPerLevel: 2500, road: 600 }, 'Repair bill per flooded cell.'),
  youngPlantingSeasons: gb(4, 'Seasons of protection maintenance after planting trees or wetlands.'),
  turbidity: gb(
    { costPerTPer1000M3: 0.3, max: 2.5 },
    'Treatment cost multiplier = 1 + min(max, k * sediment tonnes per 1000 m3 passing the intake). Muddy water costs more to treat.',
  ),
}

// ---------------------------------------------------------------- placement rules
export const PLACEMENT = {
  roadSlope: gb(0.3, 'Roads cannot be built on slopes above 30%.'),
  housingSlope: gb(0.15, 'Homes need slopes of 15% or less.'),
  roadAccessCells: gb(2, 'Homes need a road within 2 cells (200 m).'),
  croplandSlope: gb(0.35, 'Fields cannot be made on slopes above 35%.'),
  agroforestrySlope: gb(0.45, 'Agroforestry can go on slopes up to 45% (tree rows hold steeper ground than open fields).'),
  wetlandSlope: gb(0.06, 'Wetlands are restored only on gentle ground (6% or less), where water can pond.'),
  wetlandMaxHandM: gb(4, 'Wetlands must lie within 4 m of the height of their nearest stream, so the water table can reach the surface.'),
  wetlandMinAccumulation: gb(25, 'A cell draining at least 25 upslope cells counts as a drainage line a wetland can sit on.'),
  reservoirMinAccumulation: gb(40, 'Off-channel reservoirs need a valley cell draining at least 40 upslope cells.'),
  reservoirSlope: gb(0.12, 'Off-channel reservoirs need a valley floor of 12% slope or less.'),
  reservoirMaxHandM: gb(6, 'Off-channel reservoirs must lie within 6 m of the height of the nearest stream.'),
  waterworksSlope: gb(0.15, 'Waterworks need slopes of 15% or less.'),
  waterworksRoadCells: gb(3, 'Waterworks need a road within 3 cells.'),
  marketSlope: gb(0.12, 'Markets need slopes of 12% or less.'),
  marketHousingCells: gb(4, 'Markets need homes within 4 cells.'),
  vegetationAfter: gb(
    { cleared: 0.05, tilled: 0.15, housing: 0.15, built: 0.05 },
    'Vegetation cover left on a cell right after the change: at most 0.05 after clearing or building a road, waterworks or market, 0.15 on a freshly tilled field or a new home plot (gardens). It then moves toward the target of the new land use.',
  ),
}

// ---------------------------------------------------------------- community
export const COMMUNITY = {
  housingCapacity: gb([0, 25, 55, 90], 'Residents per housing cell by density level 0..3.'),
  overcrowding: gb(1.05, 'Population can exceed housing capacity by 5% (overcrowding).'),
  initialOccupancy: gb(0.9, 'Starting population as a share of housing capacity.'),
  waitlistDecay: gb(0.85, 'Turned-away households give up and settle elsewhere at this rate per season.'),
  attractiveness: gb({ jobs: 0.35, food: 0.25, water: 0.25, safety: 0.15, scale: 1.3 }, 'How strongly conditions draw migrants.'),
  departure: gb({ rate: 0.04, wellbeingThreshold: 0.55, foodCrisis: 0.6, foodCrisisRate: 0.03 }, 'People leave when wellbeing is low or food runs short.'),
  laborForceShare: gb(0.42, 'Working-age share of residents.'),
  jobs: gb(
    {
      croplandLow: 1.2,
      croplandMedium: 1.5,
      croplandHigh: 1.8,
      irrigated: 0.5,
      grassland: 0.25,
      agroforestry: 2.0,
      forest: 0.08,
      wetland: 0.3,
      market: 30,
      waterworks: 6,
      reservoir: 2,
      servicesPerResident: 0.12,
    },
    'Jobs per cell (or per resident for local services).',
  ),
  wagePerJob: gb(220, 'Household income per non-farm job per season.'),
  incomeReferencePerCapita: gb(110, 'Income per resident per season that counts as a decent livelihood.'),
  livelihoodWeights: gb({ employment: 0.6, income: 0.4 }, 'Livelihood = 0.6 employment rate + 0.4 income index.'),
  hazardWeights: gb({ floodHousing: 0.45, floodCrops: 0.15, droughtStress: 0.25, sediment: 0.15 }, 'Hazard exposure components.'),
  floodRecovery: gb(
    0.6,
    'Flooded homes take time to dry out, repair and replace lost goods. The share of homes still recovering is max(this season flooded share, 0.6 x last season recovering share), so a flood keeps weighing on safety for about two years after the water goes down. This recovering share, not only the homes under water this season, is the flood part of hazard exposure.',
  ),
  sedimentHazardT: gb(40, 'Deposited sediment per housing cell that counts as fully hazardous (mud in homes).'),
  birthsFoodSecurityFull: gb(0.8, 'Natural increase runs at the full seeded rate when food security is at least 0.8 and falls in proportion below it.'),
  farmerDroughtHazardWeight: gb(0.5, 'Farmer hazard exposure = share of cropped fields flooded + 0.5 x drought stress on crops.'),
  downstreamIndex: gb(
    {
      sedimentWeight: 0.6,
      floodWeight: 0.4,
      sedimentFullHazardMult: 3,
      floodFullHazardExcess: 2,
      wetlandWeight: 0.5,
      wetlandCap: 1.2,
      flowWeight: 0.5,
      hazardIncomeLoss: 0.5,
    },
    'Downstream households live beyond the map, so their view is an index, not a simulation. Hazard = 0.6 x min(1, outlet sediment / (3 x the normal-season sediment of the starting valley)) + 0.4 x min(1, (flood peak ratio - 1) / 2). Water access = outflow / normal outflow for the season, capped at 1. Livelihood = (0.5 x min(wetland cells / starting wetland cells, 1.2) / 1.2 + 0.5 x water access) x (1 - 0.5 x hazard).',
  ),
}

// ---------------------------------------------------------------- per-map scenario calibration
export const CALIBRATION = gb(
  {
    foodBalance: 1.25,
    droughtFoodBalance: 0.5,
    maxHouseholdScale: 2.5,
    surplusShareOfStartBudget: 0.03,
    levyRange: [0.05, 0.3] as [number, number],
  },
  'Set once at game start from the starting landscape, so every map starts with the same pressures. Homes hold more people (never fewer than the base rule, at most 2.5 times) until a normal-weather year of the starting farmland grows 1.25 times what the residents need, or until the worst two seasons of a three-season drought grow only 50% of need, whichever comes first. The cooperative levy is then set (5% to 30%) so the starting village, in a normal-weather year, saves 3% of the starting fund. Both are game-balance, not estimates for any real place.',
)

export const SPINUP = gb(
  { landYears: 6, waterYears: 3 },
  'Before play, soil health and vegetation are brought to balance with the starting land use and the long-run climate (6 model years, solved per cell), then water stores are settled with 3 normal years.',
)

export const WELLBEING_WEIGHTS = gb(
  { housing: 0.2, food: 0.25, water: 0.2, livelihood: 0.2, safety: 0.15 },
  'Composite wellbeing weights (safety = 1 - hazard exposure). Shown to players with the components.',
)

export const OBJECTIVES = gb(
  {
    housingAdequacy: 0.9,
    populationGrowth: 1.5,
    foodSelfSufficiency: 1,
    waterSecurity: 0.9,
    soilVsReference: 0.01,
    maxDebtShare: 0.5,
    wellbeing: 0.9,
    wellbeingWeakestPart: 0.8,
    naturalCoverKeep: 0.95,
    windowSeasons: 6,
    resilienceWindowSeasons: 20,
    droughtSecurity: 0.6,
    floodedHomesVsReference: 0.9,
    erosionVsReference: 0.95,
  },
  'Guided 20-year goals. The averaged goals (food, household water, solvency, wellbeing) use the non-drought seasons of the last 3 years (windowSeasons 6), because the drought goal judges drought seasons; this keeps a late drought from failing them whatever the player did. The land goal follows the UNCCD land degradation neutrality idea but is measured against the business-as-usual twin in the same weather: mean soil health on the hillside farms and on every cell the player changed must end at least 0.01 above the twin on the same cells, so the weather seed cannot decide it. The natural-cover goal allows clearing in one place to be balanced by planting elsewhere. Resilience goals leave room to recover: food and household water at least 60% in every season of the most recent drought, total erosion over the last 10 years (resilienceWindowSeasons 20) at most 95% of the twin, and flooded home-seasons over the whole game at most 90% of the twin (heavy rain is rare, so a shorter window would often hold none).',
)

/** Registry of every parameter group for docs and the in-game "model assumptions" panel. */
export const PARAM_GROUPS = { TIME, CLIMATE, DEMOGRAPHY, HYDRO, SOIL, VEG, AGRI, ECON, PLACEMENT, COMMUNITY, CALIBRATION, SPINUP, WELLBEING_WEIGHTS, OBJECTIVES }

/** Flat list of every parameter with its group, key, tag and note. */
export function listParameters(): { group: string; key: string; evidence: Evidence; note: string }[] {
  const out: { group: string; key: string; evidence: Evidence; note: string }[] = []
  for (const [group, g] of Object.entries(PARAM_GROUPS)) {
    if ('evidence' in g && 'value' in g) {
      out.push({ group, key: group, evidence: (g as Param<unknown>).evidence, note: (g as Param<unknown>).note })
      continue
    }
    for (const [key, p] of Object.entries(g as Record<string, Param<unknown>>)) {
      out.push({ group, key, evidence: p.evidence, note: p.note })
    }
  }
  return out
}
