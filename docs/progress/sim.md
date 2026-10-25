# Simulation team: progress notes

Owned paths: `src/simulation/**`, `docs/MODEL_ASSUMPTIONS.md`, this file.

## Status (final-panel round 2): complete, suite green

### What changed (panel items 1 to 7)
1. **Goals hold across seeds.** Food, household water, solvency and wellbeing are now averaged over the non-drought seasons of the last 3 years (`goalWindow`, `OBJECTIVES.windowSeasons` 6); an unpaid bill in a drought season no longer fails solvency. New cross-seed suite over 20 fixed seeds on both maps (`__tests__/seeds.valley.test.ts`, `seeds.kaani.test.ts`, shared `seedsShared.ts`, runner `bots/seeds.ts`): the best land-aware bot (`fundedBalanced`) meets at least 7 goals on at least 90% of seeds (actual: 7 to 10 on all 20, both maps), idle fails at least 5 on every seed (valley 5 to 8, Kaani 7 or 8), no bot meets all 11 on any seed. The scenario intro (`explainStart`) now says how many drought and heavy-rain seasons the seed brings ("brings N drought seasons and M seasons of heavy storms out of 40"), with evidence rows "Drought seasons ahead" and "Heavy-rain seasons ahead"; the seeds range from 7 to 17 drought seasons.
2. **Land goal measured against the twin.** `landGain(state)` = mean of (your soil health minus the twin's) over the hillside farms the map started with plus every cell whose cover, structure, terraces or input level differ from the twin's, or whose cover is younger than the twin's (a replanted forest). Target: at least +0.01 (`OBJECTIVES.soilVsReference`, replaces `soilHealthDrop`). Label "Healthier land". Idle is 0 (to 1e-4) on every seed; agroforestry and funded balanced are above 0.03 on every seed (0.05 to 0.16); clear and farm is below 0 on every seed. Tested in the cross-seed suite.
3. **Levy lever.** New action `{ type: 'set-levy'; rate }` (2% to 35%, `ECON.ratePolicy`), stored as `economy.levyRate`. The local tax per resident scales by the same multiple of its starting value (`taxPerResidentAt`). Costs: farm households keep 1 - levy, residents pay the tax above the starting rate out of household income (`CommunityInput.extraTax`), arrivals are multiplied by `arrivalRateFactor` (1 - 0.35 x (multiple - 1), between 0.4 and 1.25). New bot `fundedBalancedBot` (balanced at 2.5 times the starting levy, in `FUNDED`): operating surplus about 45k a year on the valley and 107k on Kaani over years 6 to 20, against about -4k for balanced at the starting rate; mean livelihood falls 0.89 to 0.82 (valley) and 0.85 to 0.78 (Kaani) and it fails the wellbeing goal on its livelihood part. Tests: `economy.test.ts` "the levy lever" (validation, zero cost, decision recorded, tax and arrival factor neutral at the starting rate, higher levy raises fund income more than 20%, lowers livelihood and arrivals); `strategies.test.ts` asserts a surplus of at least 5% of the start fund a year after year 5 on both maps and the livelihood cost. Recorded in MODEL_ASSUMPTIONS section 8 as game balance.
4. **Redemption.** Drought goal judges the most recent drought episode (`droughtEpisodes`, `resilienceMeasures().droughtSecurity`; `worstDroughtSecurity` still reported). Erosion is over the last 10 years against the twin (`OBJECTIVES.resilienceWindowSeasons` 20). Floods stay whole-game on purpose: a 10-year window often held no heavy rain and let idle pass on some seeds (seed 19 valley). The recovery bot was rebuilt (levy, loan, reservoir, fodder trees on steep farms, terraces, replant the cleared forest as money comes in, canals and canal-fed farms, fodder trees on overgrazed pasture). Test: recovery meets more goals than clear and farm on both maps at seed 42 (valley 8 vs 7, Kaani 7 vs 6). A scenario test makes the first drought a disaster and the last one fine and checks the goal is met.
5. **Game tonnes.** `explain.ts` erosion note now says "... game tonnes of sediment left the valley and ... game tonnes settled in reservoirs". New test in `explain.test.ts`: no non-food erosion or sediment explanation body contains a number followed by a bare "t", and no erosion, sediment or silt evidence row uses the unit "t".
6. and 7. **Perf docs.** MODEL_ASSUMPTIONS section 15 now describes the real gate (500 ms by default, the project's 50 ms with `AMORIA_PERF=1`, measured median 18 ms at load 1.5). The test comment says "the project's 50 ms budget" and notes the spec gives no number.

### Other test changes
- `scenario.test.ts`: the resilience test now checks the new definitions (episodes, last-episode value, 20-season erosion window, whole-game floods, goal window has no drought seasons, land value equals `landGain`).
- `strategies.test.ts`: both "no strategy dominates" checks gained a household-livelihood axis (the levy-raising recovery bot would otherwise dominate intensify on Kaani). The Kaani recovery check compares `landGain` instead of hillside crop soil, and erosion on the replanted cells instead of map-wide tail erosion (the restoring town grows larger under the higher levy and its herds wear the pasture; documented in section 20).

### Verification (run 2026-10-25 after the last edit)
- `npx tsc --noEmit -p .`: exit 0, no output (whole project).
- `npx eslint src/simulation`: exit 0, no output.
- `npx vitest run src/simulation`: 16 files, 195 tests passed, 89 s wall (the two cross-seed files take about 75 s each and run in parallel).
- `npx vitest run src/state src/ui src/game tests src/data`: 46 files, 567 tests passed.
- Balance tables in MODEL_ASSUMPTIONS sections 11, 20 and 21 come from scratch probes (deleted, not committed) at seed 42 and over the 20 test seeds.

### Contract changes (all additive)
- `PlayerAction` gains `{ type: 'set-levy'; rate: number }` (the state team has already handled it in `toolActions.ts`, `messages.ts`, `persistence.ts`, `upkeep.ts`; tsc is clean). `Economy.levyRate?`.
- `EconomyInput.taxPerResident?`; `CommunityInput.extraTax?`, `arrivalFactor?`. New exports in `models/economy`: `levyRateOf`, `taxPerResidentAt`, `arrivalRateFactor`.
- `scenarios/guided`: new exports `goalWindow`, `droughtEpisodes`, `landGain`; `resilienceMeasures` adds `droughtSecurity`, `droughtEpisodes`, `lastEpisodeSeasons`, `windowSeasons`. Objective ids unchanged; `land` label is now "Healthier land", direction `atLeast`, value is the gain against the twin.
- params: `ECON.ratePolicy` (new), `OBJECTIVES.soilVsReference` 0.01 (replaces `soilHealthDrop`), `OBJECTIVES.windowSeasons` 6 (was 4), `OBJECTIVES.resilienceWindowSeasons` 20 (new).

### Requests to other teams
- **UI**: a levy control (slider 2% to 35%, `ECON.ratePolicy`) that dispatches `set-levy`, showing the current rate from `levyRateOf(state.economy, state.calibration.levy)`, the starting rate, and the tax per resident from `taxPerResidentAt`. The budget panel's local-tax line now scales with it.
- **UI**: the `land` goal is now `atLeast` with a small positive target (0.01) and a value that can be negative; show it as a soil-health difference, not a percentage of the start.
- **Docs owner (GAME_DESIGN.md line 49)**: "No net land degradation" is now "Healthier land"; the averaged goals skip drought seasons; the drought goal judges the most recent drought; erosion is over the last 10 years.

### Known gaps
- On the valley the recovery bot regains goals mainly through drought readiness and keeps food; its erosion and land values stay worse than the twin's after 14 years because replanted forest takes 20 seasons to mature and its larger town overgrazes. That is the model's honest answer, not a tuning target.
- The levy lever is strong at its top end (2.5 times the starting rate gives a large surplus). Its price is livelihood and the wellbeing goal; no human playtest has judged whether that price is enough.

## Round 5 notes (kept for history)

### What changed in round 5 (review items 1 to 8)
1. **Land now decides whether growth succeeds (grazing pressure).** New `models/grazing.ts` and `AGRI.livestock`: herds grow with the town (elasticity 0.5) against fodder land (pasture 1, fodder-tree agroforestry 1.5, cropland residues 0.3, forest 0.15, wetland 0.4), relative to the starting homes full. Overgrazing (pressure above 1) multiplies pasture soil loss by 1 + 4 x excess and divides the grass cover target by 1 + 0.6 x excess, which raises erosion, sediment and treatment cost and lowers herding income. Wired into `runSoil` (`SoilInput.grazingPressure`), `landPressure` (6th arg) and `runVegetation` (5th arg) for the player's valley and the twin (`engine/season.ts`); the twin and an idle valley stay at or below 1. Also: waterworks capacity 60 000 to 36 000 m³ a season (about 2 000 people), and planned bots add a waterworks as demand nears capacity (`growWaterworks`). New strategy tests on both maps (block "the guided goals create real decisions on both maps"): no naive bot meets more goals than the best land-aware bot; both naive bots fail the land and erosion goals and end with grazing pressure above 1.15; idle stays at or below 1; a land-aware bot beats homes-only on mean livelihood by more than 0.04 (valley 0.946 vs 0.831, Kaani 0.865 vs 0.795) and homes-only spends more on bought food. Kaani: homes-only 6 goals, homes-and-farms 8, drought-ready 8 (tie allowed by the rule), agroforestry and balanced 7. Valley: naive 5, agroforestry 9.
2. **Bought food is a real, weaker crutch.** Import cap 40% to 30% of need (still scaled by livelihood); households pay 420 a tonne out of income (`Community.foodImportCost`, half the window's purchase per season), which lowers livelihood. New `Community.foodSelfSufficiency` (grown here / need, 0..2) and history fields `foodSelfSufficiency`, `foodImportCost`, `grazingPressure`. The food goal now measures self-sufficiency ("Food grown here", target 1.0). New explanation "The valley's farms now grow X% of the food it needs" in normal seasons, citing population, cropland and spending; the food-security explanation cites what households paid. Tests: `economy.test.ts` "bought food is a real cost" and "doubling the town with no new farms drops normal-season food below the goals" (self-sufficiency 0.65, below 1.0; food security 0.94 thanks to paid imports).
3. **Goal targets calibrated against the bot spread.** Wellbeing 0.65 to 0.9 plus a weakest-part rule (no part below 0.8 averaged over the window; `weakestWellbeingPart` exported). Floods: none, or at most 0.9 of the twin (`floodedHomesRatio` is 0 when no home flooded). Food: self-sufficiency 1.0. Drought stays 0.6, with `CALIBRATION.droughtFoodBalance` 0.42 to 0.5 so Kaani's drought goal stays reachable (Kaani scale 1.14, 2 023 starting residents, levy 6.3%). Idle fails 5 goals on the valley and 6 on Kaani; every goal is met by some bot and failed by some non-idle bot on both maps, except household water on the valley (met by all; the test records this exception explicitly, MODEL_ASSUMPTIONS section 21 explains it). The drought-ready bot was reworked (40 steepest terraces, one reservoir, canal-fed farms on reachable grass, farms below 1.8 x need); Kaani margin on the drought goal is small (0.603 vs 0.6).
4. **Leopold and Maddock.** Kept 0.5 and rewrote the note (params `HYDRO.channelEvap`, MODEL_ASSUMPTIONS 4.11): 0.5 is their downstream exponent, about 0.26 at a station; 0.5 is a game-balance choice so low rivers shrink faster. The parameter was already tagged game-balance.
5. **Timeouts.** Every test in `invariants.test.ts` and `scenario.test.ts` has an explicit 60 s timeout (`LONG`). The step-time check takes the best median of up to 3 rounds of 12 steps and allows 200 ms instead of 50 ms when `process.env.CI` is set or the 1-minute load average exceeds the core count.
6. **Budget shortfall text.** `EXPENSE_LABELS` and `expenseLabel()` exported from `engine/explain.ts` ("seed and fertiliser", "care for young plantings", "flood repairs", "loan interest", ...). Test: every budget shortfall from four bot runs has no camelCase token and Kaani intensify's names "seed and fertiliser".
7. **Plain words.** "1.4 times what its banks can hold" (one decimal), "terraces and contour rows cut erosion to about 50% of what it would be", "added to the debt and charge interest until they are paid back", m³ everywhere in explanation text and units. Exact values stay in the evidence tables. Test: no explanation title or body from four full bot runs contains camelCase, "bankfull", "P = ", "arrears", "accrue", "m3" or an em dash.
8. **`sensitivityParts(state)`** exported from `derived/overlays.ts`: per-cell `erosion`, `flood`, `streamBank`, `wetland`, `max` and `driver` (0 none, 1 erosion, 2 flood, 3 stream bank, 4 wetland; `SENSITIVITY_DRIVERS` names them). `environmentalSensitivity` now returns its `max`, so the two cannot drift. Test in `derived.test.ts`.

### Verification (round 5, run 2026-10-25 after the last edit)
- `npx tsc --noEmit -p .`: exit 0, no output (whole project).
- `npx eslint src/simulation`: exit 0, no output.
- `npx vitest run src/simulation`: 14 files, 176 tests passed (was 159).
- `npx vitest run src/state src/ui src/game tests src/data`: 42 files, 495 tests passed (no regressions from the sim changes).
- Balance tables in MODEL_ASSUMPTIONS sections 11, 20 and 21 come from scratch probes (outside the repo, not committed) that play all 11 bots on both maps at seed 42.
- Timing (one vitest process, seed 42): `createInitialState` 366 ms valley, 291 ms Kaani; step median 20.3 ms valley, 16.6 ms Kaani.

### Contract changes in round 5 (all additive)
- `Community.foodSelfSufficiency?`, `Community.foodImportCost?`; `HistoryPoint.foodSelfSufficiency?`, `foodImportCost?`, `grazingPressure?`; `StepDiagnostics.grazingPressure?`; `BaselineMetrics.fodderUnits?`.
- `SoilInput.grazingPressure?`; `landPressure(..., grazing = 1)`; `runVegetation(..., grazingPressure = 1)`.
- params: `AGRI.livestock` (new), `AGRI.imports.maxShare` 0.3, `HYDRO.waterworksCapacityM3` 36 000, `CALIBRATION.droughtFoodBalance` 0.5, `OBJECTIVES.foodSelfSufficiency` (replaces `foodSecurity`), `OBJECTIVES.wellbeing` 0.9, `OBJECTIVES.wellbeingWeakestPart` 0.8, `OBJECTIVES.floodedHomesVsReference` 0.9.
- Objective ids unchanged (still 11). `food` label is now "Food grown here"; `floods` value is 0 when no home flooded.
- New exports: `models/grazing` (`fodderUnits`, `grazingPressure`, `overgrazing`, `grazingSoilMult`, `grazingCoverMult`), `weakestWellbeingPart` (scenarios/guided), `EXPENSE_LABELS`, `expenseLabel` (engine/explain), `sensitivityParts`, `SENSITIVITY_DRIVERS`, `SensitivityParts` (derived/overlays). Test bots: `growWaterworks` helper, droughtReady changed, metrics `heavyRainUpstreamRunoffMm`.

### Requests to other teams (round 5)
- **UI**: `src/ui/inspector/sensitivity.ts` should read the driver from `sensitivityParts(state).driver[cell]` (and the parts) instead of `bareErosionPart`, then drop its direct use of `erodibility`, `lsFactor` and `SOIL.maxErosion`.
- **UI**: `src/ui/metrics.ts` food calculation text: bought food is now paid from household income at `AGRI.imports.value.pricePerT`, and the food goal uses `community.foodSelfSufficiency`. A "food grown here" metric (history `foodSelfSufficiency`) and "spent on bought food" (`foodImportCost`) would make the goal readable. `tests/ui/metrics.test.ts` already reads `maxShare` from params, so it follows the 30% value.
- **UI**: `BudgetPanel` can use `EXPENSE_LABELS` / `expenseLabel` from `engine/explain` so the panel and the shortfall insight use the same words.
- **UI**: for the `floods` goal, a value of 0 means "no home has flooded" (show "none" rather than "0.00x").
- **Docs owner (GAME_DESIGN.md)**: goal list line 48 still says "Enough food"; please rename to "Food grown here" and list the targets from MODEL_ASSUMPTIONS section 21 (food 1.0 of need grown locally, wellbeing 0.9 with no part below 0.8, floods none or at most 0.9 of the starting village).

### Known gaps (round 5)
- Household water goal on the procedural valley is met by every bot (waterworks plus roof tanks cover any town the bots grow). It is pressured there only through the drought goal.
- Kaani drought goal margin is small (drought-ready 0.603 against 0.6). Balance is tuned with bots, not players.
- On Kaani a naive bot (homes and farms) ties the best land-aware bot at 8 goals; it fails land, drought and erosion, while the drought-ready bot meets land and drought (and fails housing, growth and erosion).

## Round 4 notes (kept for history)

### What changed in round 4 (judge items 1 to 4)
1. **Farm inputs billed by delivery.** `runAgriculture` (`models/agriculture.ts`) now bills each cropped cell `AGRI.inputCost[intensity] x ha x clamp(serviceLevel, 0, 1)`, matching the management interpolation (low intensity costs 0). New test in `agriculture.test.ts`: at service level 0.5 the input bill is exactly half the full-service bill, the management factor is halfway between low and full, and service level 0 bills nothing. Both balance tables below and in MODEL_ASSUMPTIONS sections 11 and 20 were re-run (seed 42, 20 years, recovery switch at step 12). Kaani intensify now ends at -581k (was -637k), 89% service at the end (was 86%); valley intensify -94k (was -139k). Smaller shifts for balanced, clear-cut, drought-ready and recovery. The drought-ready bot still meets the drought goal on Kaani (0.61, was 0.63). Section 9 of MODEL_ASSUMPTIONS now states the billing rule.
2. **CALIBRATION note** in `params.ts` says 42% of need, matching the value 0.42.
3. **Housing-shortage explanation** (`engine/explain.ts`): body now reads (Kaani, clear-and-farm bot, step 12): "3,005 people want to live here (...), but only 2,820 do now: 3,005 minus 2,820 leaves 185 turned away. Homes hold 2,686 people, so 134 residents live in overcrowded homes." The counts are built from the rounded figures shown, so the arithmetic is exact (the title now says 185, not 184). Population (before and after) added to the evidence. New test in `explain.test.ts` plays Kaani with the clear-and-farm bot until the explanation fires and rebuilds the title count and the overcrowding count from the body numbers.
4. **References**: TR-55 (1986) and NRCS National Engineering Handbook Part 630 are now two separate entries.

### Verification (round 4)
- `npx vitest run src/simulation`: 14 files, 159 tests passed.
- `npx tsc --noEmit -p .`: no errors in `src/simulation`.
- `npx eslint src/simulation`: clean.

## Round 3 notes (kept for history; tables below are round 4 numbers)

Every equation, unit, parameter and source is in `docs/MODEL_ASSUMPTIONS.md`. When the two disagree, `params.ts` wins.

### What changed this round (judge items 1 to 4)
1. **Kaani balance and goals.**
   - New Kaani block in `__tests__/strategies.test.ts`. It reads `public/world-data/kaani-machakos.json` from disk (fixture `KAANI_WORLD` in `__tests__/helpers.ts`, parsed with `parseWorldText` from `src/data/worldFile.ts`) and plays every bot plus recovery for 20 years on seed 42. It checks the valley's relations without the valley's effect-size margins: clearing vs agroforestry (outflow, flood peak, sediment, drought value and yield losses, more food), restoration costs early and pays later, clear-cut, intensify, sprawl, no strategy dominating on the metric axes, two decent end states, recovery. It also checks that every one of the 11 goals is met by at least one bot, that no bot meets all 11, that no bot is at least as good as every other on every goal, that at least 3 different bots are best on some goal, and that drought on Kaani is decided by water as well as food.
   - **Drought goal reachable.** The calibration now also runs a probe of three designed drought seasons (wet, dry, wet). The household scale is the smaller of the normal-year rule (1.25 x need) and a drought rule: the worst two consecutive drought seasons must still grow `CALIBRATION.droughtFoodBalance` = 0.42 of need (`engine/index.ts`). On Kaani this sets the scale to 1.35 (was 1.44), so 2 417 starting residents. On the procedural valley the drought rule also binds, holding the scale at 1 (was 1.044).
   - **New bot `droughtReady`** (in `STRATEGIES`): waterworks plus a reservoir first, terraces, canal irrigation on reachable farms, plain farms when food is below 1.4 x need, planned housing. It meets the drought goal on Kaani (0.61) and on the valley (0.74). Water alone does not do it on Kaani: a waterworks gets about a quarter of need in the driest drought season because only 30% of a small river may be taken, so a reservoir is needed.
   - **Household water at 30% at the start on Kaani** is a fact of the map: the real data has no waterworks, so homes rely on roof tanks and wells. Building a waterworks is the first move. Documented, not changed.
   - **Intensify debt spiral on Kaani: kept as an intended tradeoff.** With a 5.5% levy the fund pays the high-input cost (55 a ha a season, scaled by the share delivered) and gets back little of the 6% extra food. It ended round 3 with about 637k debt; since round 4 bills inputs by service level it ends with about 581k (arrears plus interest, over the 400k borrowing limit, which applies to loans only). Test: intensify has the lowest net worth of all bots on Kaani and fails solvency, while still growing more food than idle and wearing out hillside soil. Documented in MODEL_ASSUMPTIONS section 20.
2. **No hard erosion cap, no soil floor.**
   - `softCapErosion` in `models/soil.ts`: identity up to the knee `SOIL.maxErosion` (still 150, kept as a number because `src/ui/inspector/sensitivity.ts` reads it), then `knee + (ceiling - knee) x (1 - exp(-(A - knee) / (ceiling - knee)))` toward `SOIL.erosionCeiling` 1500. Continuous, slope 1 at the knee, strictly rising, never reached. Also used by the erosion susceptibility overlay (`derived/overlays.ts`).
   - `lossTaper` (`SOIL.lossTaper` 0.1): erosion and cropping losses are multiplied by 1 - exp(-(SH - 0.05) / 0.1), and one season's loss is kept below 90% of the distance to the floor.
   - Spin-up solve (`equilibriumSoil`, exported from `engine/index.ts`) is now a bisection on the balance with the taper.
   - Results on Kaani (idle start): 0 open-land cells on the soil floor (was 41) and none below 0.1 (was 66), lowest 0.11. Normal wet season: 15 cells above the knee, 0 in the saturated zone (the point where the response has halved, knee + ln 2 x 1350); heavy rain: 230 above the knee, 0 saturated. 60 steepest forest cells cleared: heavy / normal erosion 2.97 (3.32 left forested); was 1.13 under the hard cap. Valley: 0 above the knee in normal seasons, 14 in heavy rain, 0 saturated.
   - Tests in `soil.test.ts` (Kaani block): soft ceiling shape; under 1% of erodible land saturated in a normal season and every cell with C > 0 eroding strictly more in heavy rain; no cell on the floor; cleared ratio above 1.5 and above half the forested ratio, and clearing raises normal-season erosion more than 5x on those cells.
3. **MODEL_ASSUMPTIONS.md**: new section 20 on the Kaani map (generic two-season climate of about 530 mm, not the bimodal Machakos rains; what is real and what is generic; calibration values; starting water and soil; erosion figures; the balance table and what it shows; the intensify trap). Line 5 and the "drought goal is decided by food" bullet reworded so they hold on both maps. Sections 5, 9, 11, 12, 15 updated for the soft ceiling, taper, bisection, drought bound and new numbers. Also fixed three stale figures found on the way: household use is 18.25 m3 a season (100 litres a day, not 14.6), the environmental-flow limit and the well share are both 30% (not 40%).
4. **Drought water explanation** (`engine/explain.ts`): now reads "the drought (52 mm, 53% below the 110 mm normal; weather) filled roof tanks less and lowered well levels" when there is no waterworks, and "... lowered stream flow, filled roof tanks less and lowered well levels" when there is one. The "baseflow is low after the drought" reason is only given when a waterworks exists. Test in `explain.test.ts` plays Kaani with no waterworks through its first droughts and with the clear-and-farm bot's waterworks.

### Objectives (`evaluateObjectives`, 11 goals, in this order)
`housing`, `growth`, `food`, `water`, `land`, `cover`, `solvency`, `wellbeing`, `drought`, `floods`, `erosion`. `floods` and `erosion` are ratios to the business-as-usual twin (`unit: 'x'`, direction `atMost`, targets 1 and 0.95); `drought` is the worst min(food, household water) over drought seasons played (target 0.6, value 1 before any drought).

Round 3 and 4 balance tables are superseded by the round 5 tables in docs/MODEL_ASSUMPTIONS.md sections 11, 20 and 21.

### Performance (Node, seed 42)
- `createInitialState`: 355 ms on the valley, 254 ms on Kaani (includes the drought probe; measured in a vitest process).
- `step`: median 15.7 ms (max 30.6) on the valley, 15.1 ms (max 16.1) on Kaani. The invariants suite asserts the median is under 50 ms.

## Decisions
- Season = step (wet then dry), 3 hydrology sub-periods per season.
- CN antecedent-moisture adjustment at half strength (game-balance, documented).
- Flooding is a screening rule (peak index vs bankfull 1.5 x the reference wet peak, HAND below floodwater depth), not hydraulics.
- Reservoirs keep 30% of capacity for households.
- Starting soil and vegetation are solved to equilibrium with the starting land use (`spinUpLand`), so the valley does not drift on its own.
- Per-map calibration (household scale 1 to 2.5, set by the smaller of a normal-year food rule and a drought food rule; levy 5% to 30%) makes every map start with the same food, drought and budget pressure. Values above.
- The intensify debt spiral on low-levy maps is an intended lesson, not a bug (round 3).
- The twin runs the starting land use through the same weather and never reads player state; in the frozen pre-game year it is computed once and shared.
- Timber: falling price within a season rather than a hard cap, so small clearings still pay a little and large ones do not.

## Contract changes (all additive in `types.ts`; nothing renamed or removed)
Earlier rounds: `Terrain` (`filledElevationM`, `nearestChannel`, `channelDistance`, `heightAboveChannelM`, `bankfullMm`); `WorldLayers` (`groundwaterMm`, `wetlandStoreMm`); `StepFields` (`etMm`, `irrigationMm`, `sedimentFlux`, `flooded`, `floodDepthM`); `WeatherSeason` (`normalRainfallMm`, `designed`); `DemographySeason`; `WaterLedger` (`groundwaterChangeMm`, `irrigationMm`); `Economy` (`serviceLevel`, `unpaid`); `Community` (`housingDemand`, `laborForce`, `births`, `arrivals`, `departures`, `wellbeingParts`); many `Totals` and `HistoryPoint` fields; `DecisionRecord` (`step`, `revenue`); `ActionValidation` (`revenue`, `cellReasons`); `SimulationState` (`demography`, `reservoirSiltM3`, `diagnostics`, `baseline`); `WorldInput` (`irrigated`, `intensity`); `createInitialState(world, seed, opts?)`.

Added in round 3:
- `ScenarioCalibration`: `droughtFoodBalanceUnscaled?`, `droughtFoodBalance?`, `householdScaleBy?` ('normal-year' | 'drought' | 'bound').
- `params`: `SOIL.erosionCeiling`, `SOIL.lossTaper`, `CALIBRATION.droughtFoodBalance`. `SOIL.maxErosion` keeps its type (number) and now means the knee of the soft ceiling.
- New exports: `softCapErosion`, `lossTaper` (models/soil), `equilibriumSoil` (engine). New test bot `droughtReadyBot` in `STRATEGIES`.

Added in the calibration and fix rounds:
- `Community.floodRecovery?` (share of housing still recovering from a flood) and `COMMUNITY.floodRecovery` in params (last pass).
- `SimulationState.calibration: ScenarioCalibration` (`householdScale`, `residentsPerHome`, `levy`, `foodBalanceUnscaled`, `foodBalance`, `normalYearSurplus`).
- `SimulationState.reference: ReferenceRun` (`layers`, `population`, `runoffMm`, `surfaceInMm`, `erosion`, `last: ReferenceOutcome`). `ReferenceOutcome`: `totalErosionT`, `outletSedimentT`, `upstreamRunoffMm`, `settlementFloodRatio`, `peakFloodRatio`, `floodedHousingCells`, `meanSoilHealth`.
- `Economy.timberSoldHa?` (ha of timber sold this season; resets each step).
- `ActionValidation.timberHa?`.
- `Totals`: `pipedWaterM3`, `selfSupplyM3`, `grazingValue`, `forestProductValue?`.
- `HistoryPoint`: `intakeFlowM3`, `meanGroundwaterMm`, `homeGroundwaterMm`, `selfSupplyShare`, `pipedShare`, `grazingValue`, `forestProductValue?`, `reservoirM3`, `refTotalErosionT`, `refOutletSedimentT`, `refUpstreamRunoffMm`, `refSettlementFloodRatio`, `refFloodedHousingCells`, `refMeanSoilHealth`.
- `StepDiagnostics`: `meanCropWaterFactorRainfed`, `meanGroundwaterMm`, `homeGroundwaterMm`, `grazingValue`, `hillsideConservationP`, `hillsideConservationCells`, `intakeFlowM3`.
- `BaselineMetrics`: `referenceErosionT`, `naturalCover`, `groundwaterRefMm`.
- `ObjectiveStatus.id` gains `'drought' | 'floods' | 'erosion'`; new export `resilienceMeasures(state)`.
- New exported helpers: `irrigationSources`, `irrigationReason`, `irrigationReachable`, `timberSale` (landUse); `compaction`, `rootFactor` (hydrology); `contouringP`, `practiceFactor`, `runOnFactor`, `reservoirTrapShare`, `sealedShare` (soil); `baseTarget`, `canopyShare` (vegetation).

## Requests to other teams
- **UI/state**: `evaluateObjectives` returns 11 goals. Please label `floods` and `erosion` as ratios to "the starting village in the same weather" (they carry `unit: 'x'`), not as percentages; `drought` is a 0..1 share and reads fine as a percentage. Use `validation.timberHa` and `validation.revenue` in the clear preview so players see the falling timber price. `history[0]` is the pre-game baseline (step 0). `ref*` history fields allow a "you vs business as usual" chart.
- **UI/state**: `tests/ui/store.test.ts > save then load in a fresh store continues at the same state` fails at line 199 (`undo()` after loading changes the state, removing the last decision). That is store undo logic, not the sim; sim replay is exact (tested in `invariants.test.ts`).
- **UI**: `src/ui/inspector/sensitivity.ts` uses `SOIL.maxErosion.value / 3` as a bare-land reference. That still works (150 is now the knee of a soft ceiling, values above it are possible up to `SOIL.erosionCeiling` 1500). If the inspector shows erosion as a share of a maximum, use `softCapErosion` and `SOIL.erosionCeiling`.
- **Render**: read restoration maturity from `maturity(cover, coverAge)` or `VEG.matureSeasons` (forest 20, agroforestry 12, wetland 6 seasons) so visuals match the model.
- **Geodata**: real worlds should provide `channel` and `protected`. Balance is tuned for 1 ha cells.

## Known gaps
- Not calibrated to any place; all outputs are illustrative game units (MODEL_ASSUMPTIONS section 12).
- Weather is spatially uniform apart from a mild orographic factor; one soil group; no lateral groundwater flow; floods are a screening rule.
- Dry-season flow: clearing forest raises low flows modestly in this model; it cannot show the degraded-soil case where clearing dries the river (documented).
- On the valley household water is close to 1.0 in drought for every bot; on Kaani it is the first thing to fail without a waterworks and a reservoir.
- Kaani runs the generic one-wet-one-dry climate, not the bimodal Machakos rains (MODEL_ASSUMPTIONS section 20).
- Balance tuned with bots, not human playtests.

## Verification (run 2026-10-25, fix round 3, after the last edit)
- `npx tsc --noEmit -p .`: exit 0, no output (whole project).
- `npx eslint src/simulation`: exit 0, no output.
- `npx vitest run src/simulation`: 14 files, 157 tests passed (was 141; new: Kaani strategy block 10, Kaani soil block 4, Kaani explain block 2).
- Balance, calibration, erosion and timing numbers above come from scratch probes (deleted, not committed) that play every bundled bot on both maps at seed 42.
