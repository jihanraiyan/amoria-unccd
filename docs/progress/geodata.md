# Geodata team notes

Owned paths: `scripts/geodata/**`, `public/world-data/**`, `src/data/**`, `docs/DATA_SOURCES.md`, this file.

## Current state (after the protected-ring fix, 2026-10-24)

- World file `public/world-data/kaani-machakos.json`: about 145 KiB, pipeline v1.3.0, 18 disclosures (one says the edge ring is a game rule, not a mapped protected area), 12 layers (`elevationCm`, `cover`, `observedCover`, `structure`, `structureLevel`, `protected`, `channel`, `roadSource`, `builtPct`, `worldCoverClass`, `worldCoverSharePct`, `demFilledPct`) plus `worldCoverLegend`.
- Key numbers (all in `meta.stats`): 188 channel cells (187 by contributing area, 1 observed water cell at (43, 52) joined because it drains into them), 1 off-network water body at (45, 63), main outlet (61, 63) collecting 3784 cells (92.4%), 0 channel breaks, 55 housing cells, 271 road cells (229 OSM main, 40 OSM minor, 2 pipeline-added), 3352 developable cells, 97 filled cells (91 in pits, max 7.06 m; 6 nudged, max 0.25 m), 495 cells adjusted from `observedCover`, 60 urban by the 15% rule, 2196 shrub-plurality cells, 71 merged-winner cells (cropland 48, tree cover 19, built-up 4), 2 cells kept as water by the water rule (`worldCoverWaterKeptCells`). WorldCover 100 to 121 native pixels per cell (mean 117.0). DEM: 43,263 pixels in the square, 52 ASTER void fills in 14 cells (max 91.7% of a cell), 40 edited. Horn slope mean 0.1305 at 100 m vs 0.1778 on native 30 m pixels. Protected edge ring: `protectedCells` 252, `protectedCellsWithStructure` 21 (existing OSM roads and housing kept).
- All 4 cells whose most common native WorldCover class is 80 (permanent water) now start as water: (43, 51) and (43, 52) are channels, (45, 63) is the water body, and (20, 38) (32% water) was already a channel by contributing area.

## Test file split (file-size fix), 2026-10-25

`scripts/geodata/tests/test_pipeline.py` was 980 lines, over the 800-line cap. It is now split by pipeline stage, with no test changed, added or dropped:

- `conftest.py` (24 lines): puts `scripts/geodata` and `tests/` on `sys.path` and holds the shared `world` fixture (the parsed export).
- `helpers.py` (74 lines): shared constants (`WORLD`, `DOCS`, `REGION`, `CACHE`, `HERE`) and builders (`geotiff`, `small_grid`, `covering_window`, `bowl`, `tilted_world`, `run_check`). These are plain functions, so they live in a module rather than conftest.
- `test_sampling.py` (283): Overpass replies, cache provenance, DEM dates, native WorldCover pixel counting, DEM fill mask, slope, OSM snapshot path.
- `test_landcover.py` (120): WorldCover to game cover aggregation.
- `test_hydrology_derive.py` (191): fill, D8 routing, settlement, channels, places, roads.
- `test_export_validation.py` (362): validators, the exported world file, and the docs-match-export check.

Verification (repo root): `scripts/geodata/.venv/bin/python -m pytest scripts/geodata/tests -q` 84 passed (same 84 as before the split; the collected test names were diffed against the old file and match exactly); `scripts/geodata/.venv/bin/ruff check scripts/geodata` all checks passed; `npx vitest run src/data` 2 files, 49 passed; `npx eslint src/data` clean; `npx tsc --noEmit -p .` 0 errors from src/data. Largest Python file under `scripts/geodata` is now `build_world.py` at 669 lines.

## Protected-ring fix (judge score 95), 2026-10-24

1. **Stale export regenerated.** The export predated the pipeline and docs change that added the edge-ring disclosure. Ran `scripts/geodata/.venv/bin/python -B scripts/geodata/build_world.py --region kaani-machakos --offline` from the repo root. That rewrote `public/world-data/kaani-machakos.json`, `index.json` and `src/data/realWorlds.generated.ts`. The export now has the provenance sentence "The protected ring along the map edge is a game rule, not a mapped reserve.", an 18th disclosure about the 252-cell ring, and `meta.stats.protectedCells` 252 / `protectedCellsWithStructure` 21.
2. **Docs test catches this now.** `test_numbers_in_docs_match_the_world_file` in `scripts/geodata/tests/test_export_validation.py` (was `test_pipeline.py` before the split) now expects `(252 cells)` and `(21 cells)` in DATA_SOURCES.md (built from `meta.stats`). It also fails if `stats.protectedCells > 0` and no disclosure mentions "not a mapped protected area", so a stale export can't pass.
3. **Notes.** Current state above has the new disclosure count and ring stats.

Verification (repo root): `build_world.py --region kaani-machakos --offline` exit 0 (145.2 KiB); `grep -o '"protectedCells[A-Za-z]*": *[0-9]*' public/world-data/kaani-machakos.json` gives 252 and 21; `scripts/geodata/.venv/bin/python -m pytest -q scripts/geodata/tests` 84 passed; `npx vitest run src/data` 2 files, 49 passed (registry test compares generated sources with the loaded file); `npx tsc --noEmit -p .` 0 errors from src/data; `npx eslint src/data` clean; `scripts/geodata/.venv/bin/ruff check scripts/geodata` all checks passed; no em dashes in DATA_SOURCES.md or this file.

## Re-check against the "fix round 2" list (score 87), 2026-10-24

That list was written against an older export (pipeline v1.0.0, 187 channel cells). The current tree already covers all 8 items, so no code or data changed this pass:
1. DATA_SOURCES.md matches the v1.3.0 export. Since v1.3.0 there are 188 channels: 187 by contributing area, plus (43, 52), which the water rule keeps as water and which drains into them. There is also 1 water body at (45, 63). The doc also covers the water-joins-only-if-draining rule, the continuity check in step 8, DEM acquisition dates (scenes 2010-12-26 to 2013-02-28, tile 2010-12-15 to 2013-04-21, Handbook pages 28 and 30), the year-mismatch limitation, the native WorldCover layers in the format table, the corrected observedCover definition, the merged-winner finding (71 cells under v1.3.0, water exempt), and the XML/KML URLs plus the extra ~100 KB. A pytest docs test checks the quoted counts against `meta.stats`.
2. Notes: see Current state (v1.3.0 figures, 188 channels plus 1 water body, current test counts).
3. `src/data/worldFile.ts` keeps and validates `sources[].acquired`. `registry.test.ts` asserts that the loaded `meta.sources` equals the generated registry.
4. The hydro.py docstring and the disclosure separate 91 pit cells from 6 cells nudged by at most 0.25 m.
5. The provenance says WorldCover is a classification of 2021 imagery and can be wrong. The accuracy disclosure quotes the v2.0 validation report with page references.
6. The Machakos distance is given geodesically: about 11 km to the centre, 7.8 km to the western edge.
7. `meta.generated.date` is a UTC timestamp. The rerun note names it as the only field that differs.
8. The README lists demdates.py and the metadata cache files. PIPELINE_VERSION is 1.3.0. `scripts/geodata/.gitignore` ignores `__pycache__/`.

Verification (repo root, 2026-10-24): `scripts/geodata/.venv/bin/python -B scripts/geodata/build_world.py --offline --preview-only` exit 0; `scripts/geodata/.venv/bin/python -B -m pytest scripts/geodata/tests -q -p no:cacheprovider` 84 passed; `scripts/geodata/.venv/bin/ruff check scripts/geodata` all checks passed; `npx vitest run src/data` 2 files, 49 passed; `npx eslint src/data` clean; `npx tsc --noEmit -p .` 0 errors; no em dashes in DATA_SOURCES.md, README.md or this file.

## Fix round 6 (judge round 4 review, score 96)

1. **Provenance names the water-joined channel.** `scripts/geodata/build_world.py` has a new `water_join_note(n)`; `meta.provenance` now reads "River channels come from flow accumulation on the DEM (plus 1 WorldCover water cell that drains into them), not from a river map", with N from `stats.channelCellsByWater` (the clause is left out when N is 0, and pluralised above 1). Re-exported; `src/data/realWorlds.generated.ts` regenerated with the same sentence. Apart from `meta.provenance` and `meta.generated.date` the world JSON is identical to the previous export (checked by JSON comparison); `index.json` is byte-identical. New pytest cases: `test_provenance_counts_water_joined_channels` (the exported provenance mentions the joined count whenever it is above 0) and `test_water_join_note_wording` (0, 1 and 3).
2. **DATA_SOURCES.md step 4 hedged.** (43, 52) is now "38% water; WorldCover maps open water here, perhaps a pond or small dam beside the stream, which the data cannot say".
3. **Stale notes fixed.** Decisions now says 495 adjusted cells (pointing to `meta.stats.coverCellsAdjusted`); the Render request lists 188 channel cells (187 by area plus the joined water cell (43, 52)) and the still-water body at (45, 63); the Simulation bullet gives today's starting village from a fresh engine probe (2569 population / 2854 capacity on Kaani, 898 / 998 on the valley, seed 7) and marks the round 1 harvest, budget and soil figures as historical; "Done (round 1)" is labelled historical.

Verification (repo root, 2026-10-24):
- `scripts/geodata/.venv/bin/python -B scripts/geodata/build_world.py --offline` twice: exit 0 both times; world JSON without `meta.generated.date` SHA-1 `0dd1e4eb...`, `index.json` `8f37f9b9...`, `realWorlds.generated.ts` `f80389a5...`, identical across runs.
- `scripts/geodata/.venv/bin/python -B scripts/geodata/build_world.py --offline --preview-only`: exit 0.
- `scripts/geodata/.venv/bin/python -B scripts/geodata/check_candidates.py --offline`: same four rows as the docs table.
- `scripts/geodata/.venv/bin/python -B -m pytest scripts/geodata/tests -q -p no:cacheprovider`: 84 passed.
- `scripts/geodata/.venv/bin/ruff check scripts/geodata`: all checks passed.
- `npx vitest run src/data`: 2 files, 49 tests passed.
- `npx eslint src/data`: clean.
- `npx tsc --noEmit -p .`: 0 errors.
- No em dashes in the touched files (grep for U+2014).

## Fix round 5 (judge round 3 review, score 94)

1. **Loader checks structure against cover** (`src/data/worldFile.ts`, `parseWorldFile`). New issues: "N housing cells are not on urban cover (first at row R, column C: <cover>)", the same for road cells, and "N water or wetland cells carry a structure other than a reservoir (first at ...: <structure>)". This matches what the game itself produces (probe of the procedural world: structures only on urban cover). Reservoirs on off-channel water and waterworks/markets on non-water land stay allowed; structures on channel cells were already rejected. Tests in `src/data/__tests__/worldFile.test.ts`: housing on a water body, road on forest, housing on grassland, market on wetland, reservoir on water and waterworks on cropland allowed, the shipped file with housing added at the water body (45, 63) rejected, and the shipped file still parsing with housing and roads only on urban and no structure on water.
2. **Observed open water survives pooling** (`scripts/geodata/amoria_geo/derive.py` `aggregate_counts`, constant `WATER_KEEP_MIN_SHARE = 0.30` in `config.py`). A cell stays water when WorldCover 80 is its native plurality class or at least 30% of its valid pixels are water. `CoverAggregate.water_kept` marks cells where this overrode the pooled vote (2 here: (43, 51) at 43% and (43, 52) at 38%). (43, 52) now drains into the channel at (43, 51) and joins the network through the existing rule; elevation, routing, settlement and roads are unchanged. Only `cover`, `observedCover` and `channel` changed, at those two cells. New disclosure (`water_kept_disclosure`), provenance sentence and stat `worldCoverWaterKeptCells`; the shrubland disclosure no longer lists permanent water among the merged winners; channel disclosure now says "1 more is a WorldCover water cell that drains into those channels". Pipeline bumped to v1.3.0. New pytest cases: 38% water + 35% shrub + 27% grass stays water and is not a merged winner; 30% water without plurality stays water; 20% water is still outvoted; an all-water cell is not counted as kept; every exported cell with native class 80 is water and (43, 52) is a channel; the docs test checks the kept-cell count.
3. **Docs** `docs/DATA_SOURCES.md`: step 4 describes the water rule with the worked example and the two cells; step 5, the map summary (188 channels, 3352 developable), cover adjustments (495), shrubland merged winners (71, water exempt), the format version history (1.3.0) and the loader checks were updated. `check_candidates.py --offline` output is unchanged by the rule (noted under the table).

Verification (all run from the repo root):
- `scripts/geodata/.venv/bin/python scripts/geodata/build_world.py --region kaani-machakos --offline`: exported, run twice; outputs identical except `meta.generated.date`.
- `scripts/geodata/.venv/bin/python scripts/geodata/check_candidates.py --offline`: same table as the docs.
- `scripts/geodata/.venv/bin/python -m pytest scripts/geodata/tests -q`: 82 passed.
- `scripts/geodata/.venv/bin/ruff check scripts/geodata`: all checks passed.
- `npx vitest run src/data`: 2 files, 49 tests passed.
- `npx eslint src/data`: clean.
- `npx tsc --noEmit -p .`: 0 errors.
- No em dashes in owned files (grep).

## Done (round 1, historical: figures as of that round, see Current state for v1.3.0)

- **Real region chosen and built from real data**: Kaani, Machakos County, Kenya (`kaani-machakos`). 6.4 km square, 64 x 64 cells of 100 m, EPSG:32737. Picked by comparing candidate squares around Mbooni/Tawa and the hills east of Machakos town on drainage coherence, woodland, cropland, settlement and named places (the earlier exploratory search code was not kept; `scripts/geodata/check_candidates.py` now reproduces the comparison table). 92% of the map drains to one outlet on the east edge. Rationale and the rejected candidates are in `docs/DATA_SOURCES.md`.
- **Downloads worked.** Both public buckets answered `curl -I` with HTTP 200 and the pipeline reads only the needed window of each COG over HTTPS:
  - `Copernicus_DSM_COG_10_S02_00_E037_00_DEM.tif` (GLO-30)
  - `ESA_WorldCover_10m_2021_v200_S03E036_Map.tif`
  - OpenStreetMap via Overpass (roads and place names), snapshot `2026-10-25T01:27:50Z`, committed in `scripts/geodata/snapshots/`.
- **Pipeline** `scripts/geodata/` (Python 3.14 venv at `scripts/geodata/.venv`, versions pinned in `requirements.txt`): grid in UTM, windowed fetch with cache, reprojection (DEM area-average to 100 m, WorldCover nearest to 10 m), majority aggregation with a documented mapping and tie order, Priority-Flood pit filling plus D8 and flow accumulation (same routing rule as the engine; slope differs, see fix round 2 item 9), channels from 150 ha contributing area, built-up threshold for settled cells, OSM main roads, settlement links routed along OSM minor roads (2 pipeline-added cells in total), edge protection, validation that aborts a bad export, JSON export, TS registry generation, text preview. Reruns with the same cache and snapshot are byte-identical except `meta.generated.date`.
- **World file** `public/world-data/kaani-machakos.json` (99 KB at the end of round 1; see Current state for today's size) plus `public/world-data/index.json`. Carries truthful `meta.provenance`, sources with versions, licences and URLs, required attribution text, plain disclosures (eleven in round 1) (cell aggregation, 2021 observation not prediction, DSM, geoid, pit filling, derived channels (likely seasonal, which the data cannot confirm), cover adjustments with counts, shrubland mapping, housing is not a census, road provenance, soil health not from satellites), OSM place names with node ids, stats, and the pipeline parameters. Extra layers kept for honesty: `observedCover` (the game-cover majority after mapping WorldCover pixels to game covers, before the channel, road and settlement rules; not the native class, which is `worldCoverClass` since the later round below), `roadSource`, `builtPct`.
- **World loader abstraction** `src/data/`:
  - `registry.ts`: `listWorlds()` (sync, procedural first, then every exported file), `getWorldListing`, `loadWorld(id, { fetchFn, baseUrl, signal })`, `loadWorldWithFallback(id)` (always starts a game, reports why it fell back), `worldFileUrl` (respects Vite `BASE_URL`), `DEFAULT_WORLD_ID = 'kaani-machakos'`, `FALLBACK_WORLD_ID = 'amoria-valley'`.
  - `worldFile.ts`: `parseWorldFile` / `parseWorldText` validate format and version, legends (remapped by name), every layer's length, type and range, finite elevation, housing level vs structure, channel cells are water with no structure, bbox, and that real-data worlds list sources. Errors are `WorldLoadError` with `code`, a player-safe `userMessage`, and a full `issues` list. Returns `LoadedWorld = WorldInput & { details }` where `details` has attribution, disclosures, places, observedCover, roadSource, builtPct, grid, stats (later rounds added worldCoverClass, worldCoverSharePct, worldCoverLegend, sourceDates).
  - `realWorlds.generated.ts`: written by the pipeline; a test checks it matches the files on disk.
  - `loaders/realData.ts`: exports `WORLDS` in the shape `src/state/worlds.ts` discovers (`{ meta, load }`), real-data worlds only, since that catalog already adds the procedural valley.
  - `index.ts`: barrel.
- **Docs**: `docs/DATA_SOURCES.md` (region rationale, sources, licences, DOIs, attribution text, pipeline steps, rerun commands, file format, assumptions and limitations, link to `public/assets/LICENSES.md` for the Kenney Nature Kit CC0 assets the render team recorded). `scripts/geodata/README.md` points there.

## Done (fix round 2, judge items 1 to 9)

1. **Download size corrected.** The cached windows are about 200 KB (DEM) and 80 KB (WorldCover), but a fresh run downloads about 2.6 MB because GDAL reads whole 1024 x 1024 COG tiles. The pipeline now computes the bytes fetched from the COG tile index (`block_size` over the intersected tiles) and prints it: DEM 1 tile, 2,401,670 bytes; WorldCover 2 tiles, 239,097 bytes. Docs fixed in both places.
2. **Developable cells exclude the protected ring.** `validate.check_world` takes the protection mask; `meta.stats.developableCells` is now 3347 (was 3576). The 30% playability check runs on the corrected number. Docs updated.
3. **Source fingerprints.** New `sources.describe_cached` records per source: HTTP `Last-Modified`, `ETag`, `Content-Length`, COG tags (WorldCover `product_version`, `algorithm_version`, `time_start`, `time_end`, `creation_time`), internal tiles read and bytes fetched, plus SHA-256 of the cached GeoTIFF and of the decoded pixel array. Stored in `meta.generated.sourceFiles` and in a `.provenance.json` sidecar beside each cache file (written at fetch time; for the pre-existing cache the headers were looked up once, `checkedOn` 2026-10-24). "2021 release" is gone: the DEM version is now "GLO-30, AWS Open Data COG copy, tile file last modified 2022-05-09 (HTTP Last-Modified)", built from the recorded header. WorldCover version names its COG tags. Hash table in `docs/DATA_SOURCES.md`.
4. **Loader requires real-data provenance.** `parseWorldFile` now rejects a `real-data-derived` world with no or empty `meta.attribution`, no or empty `meta.disclosures`, no `meta.bbox` or no `meta.crs`. Procedural world files are not asked for these. Tests for each case.
5. **Overpass `remark` check.** `osm.check_reply` raises when the reply has a remark mentioning "error" or "runtime", and `_overpass` runs every reply through it, so `--refresh-osm` cannot snapshot a timed-out partial result. Unit tests with a mocked remark reply, including an end-to-end `_overpass` test with `urlopen` patched.
6. **Candidate comparison is reproducible.** The docs no longer describe a systematic 400 m scan (that code was not kept). New `scripts/geodata/check_candidates.py` runs the four candidate centres through `build_world.run` in preview mode and prints the table; each row is also a `--lat/--lon` command. Rerun results (2026-10-24): Tawa 53.6%, Makabete 80.9%, unnamed square 99.0%, Kaani 92.4% one-outlet share. The table now also shows tree cover, cropland, housing cells and OSM places. The old "only scattered built-up cells" reason for the unnamed square was wrong (it has 60 housing cells, Kaani 58) and is replaced by the real reason: no named place.
7. **Hedged descriptive claims.** Region description, the channel disclosure and the docs now say channels are derived from the terrain and are likely seasonal, which the data cannot confirm. "Small farms" replaced by "cropland"; the description's spatial claims were checked against the data (western half 22% tree cover vs eastern 7%; 67% of cropland is in the eastern half).
8. **Test gaps closed.** pytest: `check_sources` with a DEM gap, NaN, out-of-range height and >50% WorldCover nodata; `check_world` on a valid world, an interior pit (also trips the routing check), an outlet off the edge, an outlet that is not a channel, no housing and no road, protected ring excluded from developable, too little developable land; source hashing offline and sidecar preference; exported file has hashes and WorldCover 2021 period and its developable stat matches the layers. Vitest: `routing parity` test runs the engine's `deriveTerrain` on the exported file and asserts outlet (61, 63), `flowAccumulation` at the outlet equals `meta.stats.mainCatchmentCells` (3784), no further fill by the engine, and cells with accumulation >= `meta.generated.parameters.channelMinCells` equal the channel layer minus observed-water cells.
9. **Slope docstring fixed.** `hydro.slope_max` now says it is not the engine's slope (the engine uses Horn 3x3) and is used only as a link-road routing cost. The docs say the same.

World layers are unchanged by this round (checked: the `layers` object is identical to the previous export); only `meta` text, stats and provenance changed. `realWorlds.generated.ts` and `index.json` regenerated by the pipeline.

## Done (fix round 2, second pass: DEM dating, native WorldCover classes, water bodies)

This work shipped in the export the round-3 judge reviewed but was not written up here at the time.

- **DEM acquisition dating** (`scripts/geodata/amoria_geo/demdates.py`, new). The DEM GeoTIFF has no date, so the pipeline fetches the tile's ISO 19115 XML metadata and its TanDEM-X source-scene KML from the same AWS folder (about 100 KB together, cached), reads the tile's `tsxx_startTime`/`tsxx_stopTime` (2010-12-15 to 2013-04-21) and keeps the scenes whose footprint covers the square (12 scenes, 2010-12-26 to 2013-02-28). The Copernicus DEM Product Handbook v5.0 statement (December 2010 to January 2015, section 2.1 page 30; "2011-2015", section 1.3.1 page 28) is recorded as producer-stated. All of it goes to `meta.generated.demAcquisition`, the DEM `version` text and `meta.sources[0].acquired`. New disclosure: the elevation and the land cover come from different years.
- **Native WorldCover layers.** `layers.worldCoverClass` (most common native class per cell), `layers.worldCoverSharePct` and top-level `worldCoverLegend`. The shrubland disclosure now reports the merged-winner finding: pooling shrubland and grassland pixels before the vote makes 75 cells grassland whose most common class is cropland (52), tree cover (17), built-up (4) or water (2).
- **Off-network water bodies.** `derive.channel_network` adds an observed water cell to the channels only if its D8 receiver is a channel; other water cells stay water cover but not channel (1 cell here). `validate.check_world` fails the export if any channel cell drains into a non-channel cell (`stats.channelBreaks`).
- **Loader contract additions** (`src/data`): `WorldDetails.worldCoverClass`, `worldCoverSharePct`, `worldCoverLegend`, `sourceDates` (source name to acquired period), and `describeWorldCover(details, cell, gameCoverName)` for player-facing text like "Shrubland (55% of the cell), played as grassland". `WorldMeta.sources[].acquired` (already typed in `src/simulation/types.ts`) is written by the pipeline.

## Done (fix round 3, judge items 1 to 8)

1. **`docs/DATA_SOURCES.md` regenerated from the export.** 187 channel cells plus 1 off-network water body at (45, 63); the water-joins-only-if-draining rule; channel-continuity check added to step 8; DEM acquisition (12 scenes over the square 2010-12-26 to 2013-02-28, tile coverage 2010-12-15 to 2013-04-21, Handbook statement with page refs) in the Sources table; year-mismatch limitation; format table now lists `worldCoverClass`, `worldCoverSharePct`, `worldCoverLegend`, `sources[].acquired`, `stats`, `generated.date`, `generated.demAcquisition`, `generated.worldCoverValidation`; `observedCover` described correctly (game-cover majority after pooling, not the WorldCover class); shrubland limitation gives the 75 merged-winner cells with the breakdown; XML and KML URLs listed under exact files read; the extra ~100 KB noted in the rerun section. New drift tests: pytest `TestDocsMatchExport` checks 18 numbers, dates, URLs and the pipeline version from the world file appear in the doc; vitest `docs/DATA_SOURCES.md` test checks the channel, water-body and catchment counts.
2. **These notes updated** (this section, Current state, the late write-up above, corrected render request, new verification run).
3. **Loader keeps `acquired`.** `parseMeta` in `src/data/worldFile.ts` copies `sources[i].acquired` when it is an ISO 8601 date or a `start/end` range (new exported `isIsoPeriod`; start must not be after end) and reports an issue otherwise. Tests: loaded `meta` equals the registry listing `meta` (and `REAL_WORLDS` sources) for every real world; valid dates kept, absent stays absent, malformed values rejected. The DEM fallback `acquired` value (used only when the tile metadata is missing) is now the ISO `2010-12/2015-01` so it passes this check.
4. **Pit-filling wording.** `hydro.fill_depressions` docstring now says the epsilon gradient also nudges cells that are not in a depression. `derive_hydrology` splits the raised cells: a cell is a pit cell if a zero-gradient fill also raises it. Result: 91 pit cells (max 7.06 m) and 6 gradient-nudged cells (max 0.25 m), matching the judge's recomputation. New stats `filledCells`, `filledPitCells`, `filledPitMaxRaiseM`, `gradientNudgedCells`, `gradientNudgeMaxM`; the disclosure reports both counts. Tests on a flat square and on a gently tilted plane with a pit.
5. **WorldCover presented as a classification.** Provenance now says "WorldCover is a classification of 2021 satellite imagery and can be wrong, especially between shrubland, grassland and cropland". I downloaded ESA's WorldCover Product Validation Report v2.0 (SHA-256 `05700af5...a1f4a9`) and quote from it only what is in it: overall accuracy 76.7% global (section 3.1, p. 15), 76.5% Africa (Table 3, p. 16), Africa user's accuracy shrubland 48.5%, grassland 70.7%, cropland 71.3%, tree cover 80.3% (Table A2.1, p. 27). New disclosure says these are continental figures, not measured for this square. Figures and quotes live in `config.WORLDCOVER_VALIDATION` and `meta.generated.worldCoverValidation`.
6. **Distance to Machakos.** Description and docs now say about 11 km east-north-east of Machakos town, western edge about 8 km (pyproj Geod from the OSM `place=town` node at 1.52125 S, 37.26609 E: centre 10.85 km at 76 degrees, middle of the western edge 7.82 km). I did not compute it in the pipeline because the town node is outside the grid's Overpass query.
7. **UTC build stamp.** `meta.generated.date` is now a UTC timestamp (`dt.datetime.now(dt.UTC)`, for example `2026-10-25T03:29:20Z`), so it compares directly with `osmTimestamp`. Docs say it is the only field that differs between reruns.
8. **Housekeeping.** README lists `demdates.py`, the XML/KML cache files and the tests; `PIPELINE_VERSION` bumped to 1.1.0 with a comment on what changed (format version stays 1 because every addition is optional for the loader); `scripts/geodata/.gitignore` ignores `__pycache__/`, `*.pyc`, `.pytest_cache/`, `.ruff_cache/`.

World layers are unchanged by round 3 (checked: `layers` and `worldCoverLegend` identical to the export the judge reviewed); only `meta` text, stats and provenance changed.

## Done (fix round 4, judge round-3 items 1 to 5)

1. **DEM producer void fills checked and disclosed.** `sources.SOURCE_KINDS` now also fetches the window of the tile's Filling Mask (FLM) and Editing Mask (EDM) from `AUXFILES/` (`config.dem_aux_url`), cached as `demFillMask_-2_37.tif` / `demEditMask_-2_37.tif` with `.provenance.json` sidecars, and fingerprinted in `meta.generated.sourceFiles` like the DEM (ETag, Last-Modified, bytes fetched, SHA-256 of file and pixels). Every mask pixel is counted into the cell holding its centre (`sources.pixel_cells`, `derive.dem_fill_summary`). Value tables come from the Handbook v5.0 Table 6 (p. 18) and Table 7 (p. 19), which I read in the PDF text (`config.DEM_FILL_MASK_VALUES`, `DEM_EDIT_MASK_VALUES`). Result: 52 of 43,263 pixels ASTER-filled, 14 cells in two north-west patches (rows 1 to 4 cols 12 to 13, rows 13 to 16 cols 14 to 15), cell (14, 15) 11 of 12 pixels; FLM edited 40; EDM 52 infill, 18 interpolated, 22 smoothed. This matches the judge's counts (they had 41 edited over a slightly different window). New: `layers.demFilledPct`, `meta.generated.demQualityMasks` (tables, URLs, value counts, every affected cell, warnings), stats `demPixelsInGrid`, `demPixelsPerCellMean`, `demVoidFilledPixels`, `demVoidFilledPixelsBySource`, `demVoidFilledCells`, `demVoidFilledMaxCellPct`, `demEditedPixels`. Provenance, `sources[0].version` and the year-mismatch disclosure now say "except 52 pixels the producer void-filled from ASTER GDEM"; new disclosure with counts and location. `validate.check_dem_fill` warns on any fill and stops the export above 5% (`Region.dem_max_void_filled_frac`) or if the mask misses a cell. `sources[0].acquired` stays the TanDEM-X scene period; the version text and disclosure say the fills have other dates (I did not invent ASTER dates). Loader reads `demFilledPct` (`WorldDetails.demFilledPct`, range-checked). Tests: pytest summary, warning/threshold, uncovered cell, pixel-to-cell placement on a synthetic mask, aux URL, export consistency; vitest layer vs stats and out-of-range rejection.
2. **Every native WorldCover pixel counted.** The 10 m nearest-neighbour warp is gone. `sources.pixel_cells` projects each native pixel centre (1/12000 degree) to EPSG:32737 and `sources.cell_value_counts` + `derive.aggregate_counts` do the votes from full counts (`aggregate_worldcover` on gridded blocks is kept for the unit tests). 100 to 121 pixels per cell, mean 117.0, matching the judge's recount. Downstream: 60 urban-by-threshold cells (was 69), 55 housing (58), 229/40/2 roads (231/41/2), 496 adjusted (504), 2196 shrub-plurality (2180), 73 merged-winner (75: cropland 48, tree 19, built-up 4, water 2), developable 3353 (3347). Wording fixed everywhere: about 117 native pixels of about 9.3 x 9.2 m (nominally 10 m), DEM pixel about 30.9 x 30.7 m (1 arc-second), computed from the rasters with pyproj Geod (`sources.pixel_spacing_m`, `stats.pixelSizeM`, `stats.worldCoverPixelsPerCell`). Tests: synthetic 1/12000 degree raster gives the native density within 2% and counts each pixel once; same on the real cache (skipped without it); exported mean matches `pixelSizeM`; "100 WorldCover pixels" no longer appears.
3. **Preview reads the committed snapshot.** `build_world.osm_snapshot_path`: export and preview both use `snapshots/<key>_osm.json` for a registered region; only exploratory `--lat/--lon` centres (no snapshot) and `--preview-only --refresh-osm` (so the committed file is never rewritten by a preview) use the cache. Each run prints `OSM extract: <path from repo root>`. pytest checks export and preview resolve to the same existing file, and the two cache cases. Docs rerun section updated.
4. **Built-up accuracy quoted.** `WORLDCOVER_VALIDATION` gains Built-up user's 47.1 (+/- 9.7) and producer's 84.0 (Table A2.1, p. 27; I re-read the row in the PVR text: misclassified built-up samples are grassland 0.2, bare 0.2, tree 0.1 of 0.9). Housing disclosure now says only 47.1% (+/- 9.7) of samples mapped as built-up were built-up, the rest mostly grassland, bare ground or trees, so some settled cells may have no buildings. Accuracy disclosure and DATA_SOURCES.md limitations include it; drift tests cover it.
5. **Slope measured.** `hydro.horn_slope` (Horn 1981, edge clamp, per-row east-west spacing for geographic grids) and `derive.slope_summary`. Recorded in `meta.stats.slope` for the exported 100 m elevation (mean 0.1305, median 0.1011, p90 0.2606, 24.8% > 15%, 7.9% > 30%) and the 43,263 native DEM pixels in the square (mean 0.1778, median 0.1456, p90 0.351, 47.8% > 15%, 14.3% > 30%). New disclosure and the Scale limitation quote them. Vitest parity: engine `deriveTerrain(world).slope` mean, median and share > 30% equal the recorded 100 m figures; pytest recomputes the summary from the exported elevation. (The judge's 0.14 was a different gradient measure; the engine's Horn mean is 0.1305.)

Also: `PIPELINE_VERSION` 1.2.0, README layout updated, docs drift tests extended (pytest: 14 new quoted figures plus the two mask ETags; vitest: one new test).

## Decisions

- Kaani over the brief's Machakos default area in general: same semi-arid hills, but this square is a near-complete catchment with a named village and real woodland. Tawa/Mbooni had better forest but only 54% of the map in one catchment.
- WorldCover 20 shrubland maps to grassland (the game has no shrub class). It is 48% of the square, so it is disclosed prominently.
- A cell counts as settled at 15% built-up pixels (rural homesteads here are dispersed, so a pure majority rule leaves almost no village). Housing levels 1/2/3 at under 40%, 40 to 70%, over 70% built-up.
- Real OSM roads (trunk to tertiary) instead of an invented access road. Densely built cells (30%+) stay housing where a main road crosses them, so roads do not eat the village. Links from hamlets follow OSM minor roads; only 2 cells cross open land.
- Channel cells get cover `water` (like the procedural world). The mapped majority is kept in `observedCover` and the native class in `worldCoverClass`. 495 of 4096 cells differ from `observedCover` in total as of v1.3.0 (channels, roads, settled cells; the live figure is `meta.stats.coverCellsAdjusted`); every one is a documented rule.
- WorldCover accuracy is quoted only from ESA's own validation report, with page numbers, and labelled as continental, not local.
- Elevation is stored depression-filled in whole centimetres so the browser's D8 gives the same routing as the pipeline (the export validation re-derives it after rounding).
- The OSM extract is committed as a snapshot because OSM changes daily; rasters are cached locally only (fixed, versioned releases that can be refetched).

## Contract notes and requests to other teams

- **UI/state (src/state/worlds.ts)**: new in round 4: `details.demFilledPct` (share of each cell's elevation that the producer void-filled from ASTER GDEM; 14 cells are non-zero) if the inspector wants to flag "elevation here is not radar-measured". Optional extras from earlier rounds: `details.sourceDates` (when each source was observed, for an "About this map" panel) and `describeWorldCover(details, cell, coverName)` for the inspector ("Shrubland (55% of the cell), played as grassland").
- **UI/state, original requests**: `src/data/loaders/realData.ts` follows your documented loader contract (`WORLDS` with `{ meta, load }`). If you want the richer API, import from `src/data` (`listWorlds`, `loadWorldWithFallback`, `DEFAULT_WORLD_ID`). Requests:
  1. Show `details.attribution` (three lines) somewhere visible whenever the Kaani map is in play, for example in the world picker, a credits panel, or the inspector footer. The CC BY 4.0 and Copernicus licences require it.
  2. Show `meta.provenance` and `details.disclosures` in the world picker or a "About this map" panel, and label the map as real-data-derived, not as a measurement or forecast.
  3. If you want the real map as default, `DEFAULT_WORLD_ID` is `kaani-machakos`; use `loadWorldWithFallback` so a failed download starts the Amoria Valley with `result.error.userMessage` shown.
  4. `details.places` has Kaani and Kaseve with grid row/col if you want labels.
- **Simulation**: the real map is a valid `WorldInput` and `createInitialState` runs on it (test in `src/data/__tests__/registry.test.ts`). Things I observed with the engine as of this round, for balance (I did not change anything in your area):
  - Starting village (v1.3.0): 55 housing cells and 271 road cells. With the engine as it is in the tree today (probe on 2026-10-24, seed 7, deleted afterwards) the real map starts with population 2569 and housing capacity 2854; the procedural valley starts with 898 / 998. (Historical, round 1: 58 housing cells gave 1800 / 2000 against the valley's 860 / 955, with the engine of that time.)
  - Historical (round 1 engine, not rechecked since): wet-season harvest is about 1100 to 1300 t against a demand of about 350 t, because the square really is 21% cropland (856 cells vs 273 in the valley). Food is not a pressure on this map at current parameters, and the budget grows to about 1.04 M over 20 years versus 0.50 M in the valley. You may want parameters that scale to the map, or this can be a deliberate difference between maps.
  - Mean slope (Horn, 100 m) is 0.13 for the real map (`meta.stats`, current); the valley figure of 0.099 was measured in round 1. Starting crop soil health about 0.51 was a round 1 observation. Erosion lessons should show up strongly here, which fits the real history of the area.
- **Render**: the real map (v1.3.0) has 188 channel cells: 187 by contributing area on the DEM, plus the WorldCover water cell at row 43, column 52 that drains into them (render all 188 as streams; they are likely seasonal, which the data cannot confirm). It also has 1 still-water body at row 45, column 63: water cover but not a channel (WorldCover open water, perhaps a pond or small dam; the data cannot say which), so render it as still water rather than a stream. Roads stop at channel cells (no structure there), so a bridge or ford prop where a road cell neighbours a channel on both sides would read well. Row 0 is north. `details.roadSource` tells OSM roads (1, 2) from pipeline links (3) if you ever want to style them. Live counts are in `details.stats` (`channelCells`, `channelCellsByArea`, `channelCellsByWater`, `waterBodyCells`).

## Known gaps

- Only one real region so far. Adding one is a `Region` entry in `scripts/geodata/amoria_geo/regions.py` plus a pipeline run.
- Channels are derived from the DEM, not from a river dataset; they are permanent water in the game, although in this semi-arid area they are likely seasonal (not confirmable from the data used).
- No soil, rainfall or yield data is imported. Those are model values in the simulation. Trends.Earth or FAO data could inform a later round, but nothing here claims them.
- The DEM Height Error Mask (HEM) is not read; the void fills are taken from the Filling Mask. The acquisition dates of the ASTER GDEM imagery behind the 52 filled pixels are not recorded anywhere we read, so none are claimed.
- The pipeline is not wired into `npm run check` (it needs Python and network). Its Python tests run separately; the TS tests read the committed output.

## Verification (fix round 4, commands run from the repo root)

- `scripts/geodata/.venv/bin/python -B scripts/geodata/build_world.py --region kaani-machakos` (online): fetched the FLM and EDM windows (1 COG tile each, 8,260 and 8,899 bytes), all checks pass, one warning for the 52 ASTER pixels, wrote 144.3 KiB.
- `scripts/geodata/.venv/bin/python -B scripts/geodata/build_world.py --offline` twice: exit 0; world JSON without `meta.generated.date` SHA-1 `130e3b48...` both times; `index.json` `8f37f9b9...`, `realWorlds.generated.ts` `f5d93632...`, preview `58f58fae...` identical both times.
- `scripts/geodata/.venv/bin/python -B scripts/geodata/build_world.py --offline --preview-only`: prints `OSM extract: scripts/geodata/snapshots/kaani-machakos_-1.4967_37.3605_osm.json`.
- `scripts/geodata/.venv/bin/python -B scripts/geodata/check_candidates.py` (online, fetched masks for the other candidates) and again with `--offline`: same four rows as the docs table (Tawa 74, Makabete 79, unnamed 56, Kaani 55 housing cells).
- `scripts/geodata/.venv/bin/python -B -m pytest scripts/geodata/tests -q -p no:cacheprovider`: 77 passed (the docs drift test failed first, as intended, until the doc was updated).
- `scripts/geodata/.venv/bin/ruff check scripts/geodata`: all checks passed.
- `npx vitest run src/data`: 2 files, 45 tests passed.
- `npx eslint src/data`: clean.
- `npx tsc --noEmit -p .`: 4 errors, all in other teams' paths (`src/game/__tests__/shaders.test.ts`, `src/game/props/PropLayers.tsx`, `src/simulation/__tests__/zz_probe2.test.ts`); none in `src/data`.
- `curl -sI` on the FLM, EDM, HEM and WBM AUXFILES URLs: all `HTTP/1.1 200 OK`.
- No em dashes in any geodata-owned file (grep for U+2014).

## Verification (fix round 3, historical)

- `scripts/geodata/.venv/bin/python -B scripts/geodata/build_world.py --offline` twice: exit 0, all checks pass; prints "187 by contributing area, 0 WorldCover water cells joined to them; 1 water cells off the stream network" and "filled 97 cells (max raise 7.06 m): 91 in pits, 6 nudged by the gradient (max 0.25 m)". Both runs: world JSON without `meta.generated.date` SHA-1 `809fe8e6...`, and `index.json`, `realWorlds.generated.ts` and the text preview byte-identical.
- `scripts/geodata/.venv/bin/python -B scripts/geodata/check_candidates.py --offline`: same four rows as the docs table.
- `scripts/geodata/.venv/bin/python -B -m pytest scripts/geodata/tests -q -p no:cacheprovider`: 59 passed (the docs drift test failed first, as intended, before the doc was updated).
- `scripts/geodata/.venv/bin/ruff check scripts/geodata`: all checks passed.
- `npx vitest run src/data`: 2 files, 41 tests passed.
- `npx eslint src/data`: clean.
- `npx tsc --noEmit -p .`: 0 errors.
- `curl -sI` on the DEM XML metadata and SRC KML URLs: both `HTTP/1.1 200 OK`.
- No em dashes in any geodata-owned file (grep for U+2014).

## Verification (fix round 2, historical: figures as of that round, superseded by fix round 3 above)

- `curl -sI <DEM tile URL>` and `curl -sI <WorldCover tile URL>`: both `HTTP/1.1 200 OK`; Last-Modified and ETag match what the pipeline recorded.
- `scripts/geodata/.venv/bin/python -B scripts/geodata/build_world.py --region kaani-machakos`: online run, wrote the provenance sidecars, all checks pass, `developableCells` 3347.
- `scripts/geodata/.venv/bin/python -B scripts/geodata/build_world.py --offline` twice: same SHA-1 for the world JSON, `index.json` and `realWorlds.generated.ts` both times.
- `scripts/geodata/.venv/bin/python -B scripts/geodata/check_candidates.py` (online, 5 min) and again with `--offline`: same four rows as the docs table.
- `scripts/geodata/.venv/bin/python -B -m pytest scripts/geodata/tests -q -p no:cacheprovider`: 37 passed.
- `scripts/geodata/.venv/bin/ruff check scripts/geodata`: all checks passed.
- `npx vitest run src/data`: 2 files, 31 tests passed.
- `npx eslint src/data`: clean.
- `npx tsc --noEmit -p .`: 2 errors, both in `tests/ui/analysis.test.ts` (another team's path); none in `src/data`.
- No em dashes in any geodata-owned file (grep).

## Verification (round 1, historical)

- `curl -sI <DEM tile URL>` and `curl -sI <WorldCover tile URL>`: both `HTTP/1.1 200 OK`.
- `scripts/geodata/.venv/bin/python -B scripts/geodata/build_world.py --offline`: all 7 steps pass validation, writes `public/world-data/kaani-machakos.json (98.9 KiB)`; two consecutive runs gave the same SHA-1.
- `scripts/geodata/.venv/bin/python -B -m pytest scripts/geodata/tests -q -p no:cacheprovider`: 18 passed.
- `scripts/geodata/.venv/bin/ruff check scripts/geodata`: all checks passed.
- `npx vitest run src/data`: 2 files, 28 tests passed.
- `npx eslint src/data`: clean.
- `npx tsc --noEmit -p .`: 0 errors (none in `src/data`).
