# Data sources and the real-data map

Amoria ships two maps:

| Map | Kind | Where it comes from |
|---|---|---|
| Amoria Valley (`amoria-valley`) | `procedural` | Generated in code (`src/simulation/world/procedural.ts`). A made-up valley, not based on any real place or data. Always available, used as the fallback. |
| Kaani, Machakos County, Kenya (`kaani-machakos`) | `real-data-derived` | Built offline by `scripts/geodata/build_world.py` from Copernicus DEM GLO-30, ESA WorldCover 2021 and OpenStreetMap. Stored in `public/world-data/kaani-machakos.json`. |

Both maps load through the same code path (`src/data/registry.ts`) and produce the same `WorldInput` structure, so every game system works on either one.

## Why Kaani

The UNCCD challenge is about land use in drylands and what restoration can offer. We wanted one compact, real place where a young player can see that story inside a single catchment. The Machakos hills in Kenya fit well:

- Semi-arid climate, steep hillsides, cropland on slopes, patches of woodland and bushland (the land cover part is what WorldCover shows for the square, see below). The classic dryland tradeoffs (clearing, cropping steep land, soil loss, water scarcity, terracing, tree planting) all apply here.
- The wider area has a long, documented history of soil conservation and terracing. A well-known study of it is Tiffen, Mortimore and Gichuki (1994), *More People, Less Erosion: Environmental Recovery in Kenya*. We mention it as background reading only; no number in the game comes from it.
- The open data needed is published for this area: the Copernicus GLO-30 tile `S02 E037` and the ESA WorldCover tile `S03E036` are both public and readable over plain HTTPS.

Inside that area we compared candidate squares in the Mbooni hills around Tawa and in the hills east of Machakos town, looking at: share of cells that drain to a single outlet, tree cover, cropland, settled cells and whether OpenStreetMap names a place inside the square. An exploratory search in an earlier round found these candidates, but its code was not kept, so we do not present it as a reproducible scan. What can be reproduced is the comparison itself: `scripts/geodata/check_candidates.py` runs each candidate centre through the same pipeline (preview only, nothing is exported) and prints the table below. Each row is also one command, for example `scripts/geodata/.venv/bin/python scripts/geodata/build_world.py --lat=-1.57 --lon=37.46` (a `--lat/--lon` run implies `--preview-only`).

| Candidate (centre) | One-outlet share | Forest (game cover) | Cropland (game cover) | Housing cells | OSM places in square | Why not chosen |
|---|---|---|---|---|---|---|
| Tawa, Mbooni hills (1.57 S, 37.46 E) | 53.6% | 12% | 24% | 74 | Songeni, Tawa | Good villages, but the square splits into several catchments. |
| Makabete, near Machakos (1.561 S, 37.299 E) | 80.9% | 3% | 18% | 79 | Makabete | Very little woodland; mostly bushland. |
| Unnamed square (1.457 S, 37.357 E) | 99.0% | 11% | 31% | 56 | none | Drains best, but OpenStreetMap names no place inside it, so there is no real village to anchor the story. |
| **Kaani (1.4967 S, 37.3605 E)** | **92.4%** | **13%** | **21%** | **55** | **Kaani, Kaseve** | Chosen: one main stream network, tree cover on the western hills, cropland, a named village, a main road. |

Shares are of the 4096 game cells after the pipeline's adjustments (forest and cropland are game covers, not raw WorldCover shares: for Kaani, WorldCover tree cover is 18.1% of the square's pixels against 13% forest cells after the majority vote and the adjustments; housing comes from the built-up rule below). Numbers come from a run on 2026-10-25 (UTC) with pipeline v1.4.0, which counts every native WorldCover pixel (earlier runs used a subsample, see step 3, so their housing counts were a few cells different). The water rule added in v1.3.0 (step 4) does not change any figure in the table, and the bridges added in v1.4.0 only add their 4 cells to the Kaani road count. For Kaani the run reads the committed OSM snapshot; for the other three the place column depends on the live Overpass reply cached for each candidate and can change as OSM is edited.

OpenStreetMap places Kaani in Machakos County, Kathiani constituency, Lower Kaewa-Kaani ward (checked with an Overpass `is_in` query at the square's centre). The square's centre is about 11 km east-north-east of Machakos town and its western edge about 8 km from it (geodesic distances from the OpenStreetMap `place=town` node for Machakos at 1.52125 S, 37.26609 E: 10.85 km to the centre at a bearing of 76 degrees, 7.8 km to the middle of the western edge).

## What the map contains

- 64 by 64 cells of 100 m (6.4 km by 6.4 km), in WGS 84 / UTM zone 37S (`EPSG:32737`). Row 0 is the northern edge, column 0 the western edge, index = row * 64 + column.
- North-west grid corner at UTM (314400 E, 9837800 N). WGS84 envelope: 37.3317 E to 37.3893 E, 1.4668 S to 1.5248 S.
- Elevation 1246 m to 1808 m. Highest ground in the north-west and west, lowest at the outlet on the eastern edge.
- Game cover shares: grassland 54% (most of it WorldCover shrubland), cropland 21%, forest 13%, urban (housing and roads) 8%, water 5% (channels plus one water body).
- 188 channel cells: 187 from contributing area on the DEM, plus 1 observed WorldCover water cell (row 43, column 52) that drains into them. 92% of the map (3784 cells) drains to one outlet at row 61, column 63, and every channel cell drains along channel cells to the map edge.
- 1 WorldCover water cell (row 45, column 63) lies off the derived stream network. It starts as open water but is not a channel (for example a pond or small dam; the data does not say which).
- 55 housing cells, 275 road cells, 3352 cells open for development (no channel, no structure, not water, and not in the protected edge ring).
- Named places from OpenStreetMap that fall inside the grid: Kaani (village), Kaseve (village and locality).
- Terrain slope (Horn's 3 x 3 method, the same as the game engine, as rise over run): mean 0.1305 and median 0.1011 on the 100 m grid, with 24.8% of cells steeper than 15% and 7.9% steeper than 30%. On the native 30 m DEM pixels inside the square the mean is 0.1778 and the median 0.1456, with 47.8% steeper than 15% and 14.3% steeper than 30%. Both are in `meta.stats.slope`.

`scripts/geodata/out/kaani-machakos_preview.txt` has a text picture of the whole grid.

## Sources

| Source | Version | Licence | Used for |
|---|---|---|---|
| Copernicus DEM GLO-30 | AWS Open Data COG copy. The GeoTIFF carries no release tag or date, so we do not claim a specific delivery. Acquisition, from the tile's own metadata files (see below): the 12 TanDEM-X scenes whose footprints cover this square were taken 2010-12-26 to 2013-02-28 (source-scene layer); the tile as a whole covers 2010-12-15 to 2013-04-21 (XML metadata `tsxx_startTime` / `tsxx_stopTime`). The producer states the whole TanDEM-X/WorldDEM acquisition ran from December 2010 to January 2015 (Copernicus DEM Product Handbook v5.0, section 2.1, page 30; section 1.3.1, page 28 gives "2011-2015"). Tile file last modified 2022-05-09 (HTTP `Last-Modified`, a copy date, not an acquisition date). Not all of it is TanDEM-X: the tile's Filling Mask shows that 52 of the 43,263 DEM pixels in the square were void-filled by the producer from ASTER GDEM (see "Producer void fills" below). | Free licence with attribution. DOI [10.5270/ESA-c5d3d65](https://doi.org/10.5270/ESA-c5d3d65) | Elevation |
| ESA WorldCover 10 m 2021 | v200 (COG tags `product_version` and `algorithm_version` V2.0.0, `time_start` 2021-01-01, `time_end` 2021-12-31) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Cite Zanaga et al. 2022, DOI [10.5281/zenodo.7254221](https://doi.org/10.5281/zenodo.7254221) | Land cover, built-up share |
| OpenStreetMap via the Overpass API | Snapshot `2026-10-25T01:27:50Z` | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) | Main roads, minor roads used for links, place names |

Exact files read (through HTTP range requests; GDAL fetches whole 1024 x 1024 internal COG tiles, not just the window):

- `https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_S02_00_E037_00_DEM/Copernicus_DSM_COG_10_S02_00_E037_00_DEM.tif`
- `https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_S02_00_E037_00_DEM/Copernicus_DSM_10_S02_00_E037_00.xml` (the tile's ISO 19115 XML metadata, about 45 KB, read for the tile's TanDEM-X start and stop time)
- `https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_S02_00_E037_00_DEM/PREVIEW/Copernicus_DSM_10_S02_00_E037_00_SRC.kml` (the tile's source-scene layer, about 56 KB: every TanDEM-X scene used, with its date and footprint; `amoria_geo/demdates.py` keeps the scenes whose footprint covers any point of an 11 x 11 lattice over the square)
- `https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_S02_00_E037_00_DEM/AUXFILES/Copernicus_DSM_COG_10_S02_00_E037_00_FLM.tif` (the tile's Filling Mask: which pixels were edited or void-filled, and from which source)
- `https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_S02_00_E037_00_DEM/AUXFILES/Copernicus_DSM_COG_10_S02_00_E037_00_EDM.tif` (the tile's Editing Mask: the last editing step applied to each pixel)
- `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_S03E036_Map.tif`
- `https://overpass-api.de/api/interpreter` (queries for `way["highway"]` and `node["place"]` in the grid's bounding box)

### Source file fingerprints

So a reviewer without our local cache can check which bytes were used, the pipeline records for each source (in the world file under `meta.generated.sourceFiles`, and in a `.provenance.json` sidecar next to each cached window) the server's `Last-Modified` and `ETag`, the COG metadata tags, how many bytes a fresh window read fetches, and SHA-256 hashes of the cached window, both of the GeoTIFF file and of the decoded pixel values (the second is stable across GDAL versions, which may encode the same pixels differently).

| | Copernicus DEM tile | WorldCover tile |
|---|---|---|
| HTTP `Last-Modified` | 2022-05-09T14:52:46Z | 2022-10-26T12:47:55Z |
| HTTP `ETag` | `7b02bcf4b7d1796b5a599adb70da223d` | `5912f043128a6370f5d949ffc1d3ce4b-17` |
| File size | 39,043,864 bytes | 135,162,419 bytes |
| COG tags | `AREA_OR_POINT=Point` only | `product_version` V2.0.0, `algorithm_version` V2.0.0, `time_start` 2021-01-01T00:00:00Z, `time_end` 2021-12-31T23:59:59Z, `creation_time` 2022-10-21 |
| Internal tiles read, bytes fetched | 1 tile, 2,401,670 bytes | 2 tiles, 239,097 bytes |
| Cached window | 243 x 245 px float32, 195,204 bytes | 811 x 815 px uint8, 82,671 bytes |
| SHA-256 of cached GeoTIFF | `21ca183bc1ba8970711bab0d383edb6fd9c926d95d2d387bfe435bf8008d9563` | `ecc49a4701fb7c216f8815ae985a695c83d0338a836e8cdd4fe562252ef2a42f` |
| SHA-256 of pixel values (little-endian) | `e4a3ebebd40caf52b19891d8ec6548181365655f9412c4735ff1f1c1f7e81527` | `4bbfcd47067ee6b5ee437b5314df39ea8dbab914c161606b1efef7ed55f64a81` |

The two DEM quality masks are fingerprinted the same way:

| | Filling Mask (FLM) | Editing Mask (EDM) |
|---|---|---|
| HTTP `Last-Modified` | 2022-05-09T14:52:46Z | 2022-05-09T14:52:46Z |
| HTTP `ETag` | `40ef791190fc39837e1f4fbeff52fc78` | `1b512ec8b0467a2ef0e5abdf91d9eb07` |
| File size | 153,695 bytes | 164,715 bytes |
| Internal tiles read, bytes fetched | 1 tile, 8,260 bytes | 1 tile, 8,899 bytes |
| SHA-256 of cached GeoTIFF | `6cd492a87a9883913cd355945abe6da33081d1477630359854153e2e44c92980` | `13d34ba1cd4bd7de8b2533173a410571339e5e8069d4b1d6c89f3d7d62af8616` |
| SHA-256 of pixel values | `393df00cf7a9fe6e1ef700d9db242321ebfa15153ed5819d75ba86d60a295e7b` | `36df2112f9cf688951e4d4397048ad67247721cd705e9059cdbc0d84b93786dd` |

The full scene list is in the world file under `meta.generated.demAcquisition`, together with the Handbook statement and its page references.

### Producer void fills in the DEM

The Copernicus DEM is mostly TanDEM-X radar elevation, but where the radar left gaps the producer filled them from other elevation models, and the DEM file itself does not show this. The tile's Filling Mask does (pixel values from the Copernicus DEM Product Handbook v5.0, Table 7, page 19: 1 edited, 2 not edited or filled, 3 ASTER, 4 SRTM90 and so on; the Editing Mask values are in Table 6, page 18). The pipeline counts every mask pixel into the 100 m cell that holds its centre. Over this square:

- 52 of the 43,263 DEM pixels (0.12%) were void-filled from ASTER GDEM, an optical stereo elevation model built from imagery taken on other dates. Heights there are not TanDEM-X measurements and do not share its acquisition dates.
- They fall in 14 cells, in two patches in the north-west (rows 1 to 4, columns 12 and 13, and rows 13 to 16, columns 14 and 15). The most affected cell has 92% of its DEM pixels filled.
- The Filling Mask also flags 40 pixels as edited without being filled; the Editing Mask counts 18 interpolated and 22 smoothed pixels, and 52 pixels of "infill of external elevation data", which are the ASTER fills.

The per-cell filled share is exported as the `demFilledPct` layer, each affected cell is listed in `meta.generated.demQualityMasks.voidFilledCells`, and the totals are in `meta.stats` (`demVoidFilledPixels`, `demVoidFilledPixelsBySource`, `demVoidFilledCells`, `demVoidFilledMaxCellPct`). The export prints a warning whenever any pixel is void-filled and stops if more than 5% of the square's DEM pixels are.

Documents we read by hand (not fetched by the pipeline):

- Copernicus DEM Product Handbook v5.0: https://dataspace.copernicus.eu/sites/default/files/media/files/2024-06/geo1988-copernicusdem-spe-002_producthandbook_i5.0.pdf
- WorldCover Product Validation Report v2.0 (SHA-256 `05700af5f1462beebf3007ead5b68bccc5f4c016a7bdb26d5c9b6e3db4a1f4a9`): https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/docs/WorldCover_PVR_V2.0.pdf. The figures we quote from it are in `amoria_geo/config.py` (`WORLDCOVER_VALIDATION`) and in the world file under `meta.generated.worldCoverValidation`.

Licence pages and documentation:

- Copernicus DEM: https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM and https://copernicus-dem-30m.s3.amazonaws.com/readme.html
- ESA WorldCover: https://esa-worldcover.org/en/data-access
- OpenStreetMap: https://www.openstreetmap.org/copyright

### Required attribution text

Anywhere the real-data map is shown, show these lines (they are also in the world file as `meta.attribution`):

> Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.
>
> © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium.
>
> © OpenStreetMap contributors, data available under the Open Database License.

The Copernicus wording is the "adapted or modified" notice from the Copernicus DEM licence page. The WorldCover wording is the attribution format from the WorldCover data access page, with the year set to 2021 as that page asks for the 2021 map.

Because the road and place layers in `kaani-machakos.json` are derived from OpenStreetMap, that part of the file is a derived database under ODbL. The OSM extract the file was built from is kept in `scripts/geodata/snapshots/`.

## How the pipeline works

All of it is in `scripts/geodata/`. Heavy raster work happens offline, never in the browser.

1. **Grid.** Project the region centre to UTM 37S, put a 6.4 km square around it and snap the corner to 100 m (`amoria_geo/sources.py`).
2. **Fetch.** Read the needed window of each source COG over HTTPS and cache it as a local GeoTIFF in `scripts/geodata/cache/` (the cached windows are about 200 KB for the DEM and 80 KB for WorldCover). Record the server headers, COG tags, bytes fetched and hashes described above. Fetch the DEM tile's XML metadata and source-scene KML (about 100 KB together, cached beside the windows) and work out which TanDEM-X scenes cover the square (`amoria_geo/demdates.py`). Fetch the same window of the DEM's Filling Mask and Editing Mask from the tile's `AUXFILES` folder (about 17 KB of COG tiles). Query Overpass once for roads and places and keep the result as a snapshot in `scripts/geodata/snapshots/`.
3. **Reproject and resample.** Warp the DEM to the 100 m UTM grid with area averaging. A DEM pixel is 1 arc-second, about 30.9 m east-west by 30.7 m north-south here, so a cell averages about 11 of them (10.6 on average by pixel centre). WorldCover is not warped: its native pixel is 1/12000 degree, about 9.3 m by 9.2 m here (nominally 10 m), and the pipeline projects the centre of every native pixel to UTM and counts it in the 100 m cell that contains it. That gives 100 to 121 native pixels per cell, 117.0 on average, and every pixel in the square is counted exactly once. (Up to pipeline v1.1.0 WorldCover was warped onto a 10 m grid with nearest neighbour, which sampled only 100 pixels per cell and dropped about 15% of the native pixels.) The DEM Filling and Editing Masks are counted per cell the same way.
4. **Aggregate land cover.** Map each counted WorldCover pixel to a game cover (table below), then take the majority per cell. Ties go to water, wetland, forest, cropland, grassland, urban, bare, in that order. One exception protects observed open water: a cell stays water when WorldCover 80 (permanent water bodies) is its most common native class, or when at least 30% of its valid pixels are water (`WATER_KEEP_MIN_SHARE` in `amoria_geo/config.py`). Without it, pooled shrubland and grassland pixels can outvote the water: a cell that is 38% water, 35% shrub and 27% grass would become grassland. Open water is rare in this square (4 cells have it as their most common class) and it matters to a water game, so we keep it. On this map the rule keeps 2 cells as water that the vote alone would have made grassland: row 43, column 51 (43% water, already a channel by contributing area) and row 43, column 52 (38% water; WorldCover maps open water here, perhaps a pond or small dam beside the stream, which the data cannot say; it now joins the channel network through the rule in step 5). Also record the share of built-up pixels per cell.
5. **Hydrology.** Round elevation to 1 cm, fill closed pits with Priority-Flood plus a 5 cm per cell gradient (Barnes, Lehman and Mulla 2014). Here that raises 97 cells: 91 cells in pits (the cells a zero-gradient fill also raises, by at most 7.06 m) and 6 cells nudged up by the gradient although they are not in a depression (by at most 0.25 m). Then route with D8 steepest descent and compute flow accumulation. This is the same routing rule the simulation uses, so the channels line up with where the game sends water; a test in `src/data/__tests__/registry.test.ts` runs the engine's `deriveTerrain` on the exported file and checks it finds the same outlet, the same catchment size, no further pit filling and the same channel cells. (Slope is the exception: the pipeline uses the steepest drop to any neighbour, only as a cost when routing link roads, while the engine uses Horn's 3 x 3 method.) Cells with at least 150 ha upstream become channel cells. A cell whose observed cover is water (step 4) joins the channels only if its D8 receiver is a channel cell (directly, or through other such water cells), so the network always drains continuously; any other water cell is kept as a water body (water cover, not a channel). On this map that gives 187 channel cells by contributing area, 1 joined water cell (row 43, column 52) and 1 water body (row 45, column 63).
6. **Settlement and roads.** Cells with at least 15% built-up pixels become urban. OSM trunk, primary, secondary and tertiary roads are drawn into cells with 8-connected lines. Densely built cells (30% or more built-up) stay housing even where a main road crosses them. Each cluster of 3 or more settled cells is then linked to a road that leaves the map, using the cheapest path along OSM minor roads (unclassified, residential, track, service); only where OSM has a gap does the link cross open land. Housing level is 1, 2 or 3 for built-up shares below 40%, 40 to 70% and above 70%.
7. **Protection and slope.** The one-cell ring around the map edge (252 cells) is marked protected. This is a game rule that keeps a margin at the map edge, not a mapped protected area: no protected-area data was used. Existing OSM roads and housing in the ring (21 cells) are kept. The world file says this to players in `meta.disclosures` and `meta.provenance`, and records the counts as `meta.stats.protectedCells` and `meta.stats.protectedCellsWithStructure`. Slope is computed with Horn's (1981) 3 x 3 method, exactly as `src/simulation/engine/terrain.ts` does it (edge cells repeat their neighbours), once on the exported 100 m elevation and once on every native DEM pixel inside the square (with its real east-west and north-south spacing, before any filling). The summaries go to `meta.stats.slope`; a test in `src/data/__tests__/registry.test.ts` checks that the engine's mean slope on the file equals the recorded 100 m figure.
8. **Validate.** The export stops if any of these fail: every grid cell has DEM coverage; the DEM Filling Mask covers every cell and no more than 5% of the DEM pixels are producer void fills (any fill at all is printed as a warning and disclosed); heights are finite and in Earth's range; no cell has more than 50% WorldCover nodata; after export rounding, no interior cell lacks a downhill neighbour and D8 routing is unchanged; every channel cell drains into another channel cell or off the map (no channel cell drains into a non-channel cell); the main outlet is on the edge and is a channel cell; at least 25% of the map drains to it; there is housing and a road; at least 30% of cells are developable (open land outside the protected edge ring).
9. **Export.** Write `public/world-data/<id>.json`, `public/world-data/index.json`, the TypeScript registry `src/data/realWorlds.generated.ts` and the text preview.

### WorldCover to game cover

| WorldCover class | Game cover | Note |
|---|---|---|
| 10 Tree cover | forest | |
| 20 Shrubland | grassland | The game has no shrub class. Open bushland behaves more like grassland than closed forest for runoff and grazing. This is 48% of the square, so it matters. |
| 30 Grassland | grassland | |
| 40 Cropland | cropland | |
| 50 Built-up | urban | Plus the 15% built-up rule above. |
| 60 Bare / sparse vegetation | bare | |
| 70 Snow and ice | bare | Not present; mapped so the table is complete. |
| 80 Permanent water bodies | water | |
| 90 Herbaceous wetland | wetland | Not present here. |
| 95 Mangroves | wetland | Not present here. |
| 100 Moss and lichen | bare | Not present; mapped so the table is complete. |

### Rerunning it

From the repo root:

```sh
python3 -m venv scripts/geodata/.venv
scripts/geodata/.venv/bin/pip install -r scripts/geodata/requirements.txt

# Rebuild from the cached rasters and the committed OSM snapshot (no network for OSM):
scripts/geodata/.venv/bin/python scripts/geodata/build_world.py --region kaani-machakos

# Fully offline, once the cache exists:
scripts/geodata/.venv/bin/python scripts/geodata/build_world.py --offline

# Check without writing anything (reads the same committed OSM snapshot as the export), or try another centre
# (an exploratory centre has no committed snapshot, so its OSM reply is cached under scripts/geodata/cache/):
scripts/geodata/.venv/bin/python scripts/geodata/build_world.py --preview-only
scripts/geodata/.venv/bin/python scripts/geodata/build_world.py --lat=-1.57 --lon=37.46

# Reproduce the candidate table above (needs the network the first time, about 2.6 MB per candidate):
scripts/geodata/.venv/bin/python scripts/geodata/check_candidates.py

# Re-query OpenStreetMap (the result will differ as OSM is edited). A reply carrying an Overpass
# runtime-error remark (timeout, out of memory) is rejected instead of saved as a partial snapshot.
# With --preview-only the fresh reply goes to the cache and the committed snapshot is left alone:
scripts/geodata/.venv/bin/python scripts/geodata/build_world.py --refresh-osm

# Tests and lint:
scripts/geodata/.venv/bin/python -m pytest scripts/geodata/tests -q
scripts/geodata/.venv/bin/ruff check scripts/geodata
```

The raster cache is not committed (it is in `.gitignore`). The cached windows are only about 200 KB and 80 KB, but the first run downloads about 2.6 MB, because COGs are read in whole internal tiles (one 1024 x 1024 DEM tile and two WorldCover tiles here); the pipeline prints the bytes each read fetches. A fresh fetch can be compared with the hashes above. The first run also downloads the DEM tile's XML metadata and source-scene KML, about 100 KB more, and about 17 KB of the Filling and Editing Mask COGs; they are cached beside the windows, so `--offline` reruns need them in the cache. Every run prints which OSM file it reads, with its path from the repo root. With the same cache and snapshot, two runs produce byte-identical world files except for `meta.generated.date`, the UTC build timestamp (so `index.json`, `realWorlds.generated.ts` and the text preview, which do not carry it, come out byte-identical). Versions are pinned in `requirements.txt` (rasterio 1.5.2 with GDAL 3.12, numpy 2.5.4, pyproj 3.8.0, tested on Python 3.14).

To add another region, register a `Region` in `scripts/geodata/amoria_geo/regions.py` (centre, UTM EPSG code, and any threshold you want to change) and run the pipeline with `--region <id>`. The registry and tests pick the new file up automatically.

## World file format

`public/world-data/<id>.json`, format `amoria-world`, `formatVersion` 1, written by pipeline v1.4.0 (`meta.generated.pipeline`; 1.1.0 added the native WorldCover layers, `sources[].acquired`, `generated.demAcquisition`, water bodies and the UTC timestamp; 1.2.0 counts every native WorldCover pixel and adds `layers.demFilledPct`, `generated.demQualityMasks` and the slope and pixel-size stats; 1.3.0 adds the water rule in step 4 and `meta.stats.worldCoverWaterKeptCells`; 1.4.0 keeps road cells that cross a channel or open water as bridges, which keep their water cover, and adds `bridges` to the road counts; all of it is optional for the loader, so the format version did not change). All layers are flat arrays of 4096 integers, row 0 north.

| Field | Meaning |
|---|---|
| `meta` | `WorldMeta` (id, name, kind, description, provenance, bbox, crs, sources) plus `attribution`, `disclosures`, `places`, `grid`, `stats`, `generated` |
| `meta.sources[].acquired` | When each source was observed: ISO date or `start/end` range. DEM: the scenes over the square (`2010-12-26/2013-02-28`); WorldCover: `2021-01-01/2021-12-31`; OSM: the snapshot time |
| `meta.stats` | Counts quoted in this document (channel cells, water bodies, filled cells split into pit cells and gradient nudges, cover adjustments, shrub plurality cells, merged-winner cells, road sources, WorldCover pixels per cell, native pixel sizes, DEM void fills, slope summaries and so on) |
| `meta.stats.slope` | Horn slope summaries (`mean`, `median`, `p90`, `pctAbove15`, `pctAbove30`) for the 100 m grid (`grid100m`) and the native DEM pixels (`native30m`) |
| `meta.generated.demQualityMasks` | Filling and Editing Mask URLs, value counts over the square, every cell with void-filled pixels, and the validation warnings |
| `meta.generated.date` | UTC timestamp of the build, for example `2026-10-25T03:26:43Z` |
| `meta.generated.demAcquisition` | Per DEM tile: XML and KML URLs, the tile's TanDEM-X coverage, every scene over the square with its date, and the Handbook statement with page references |
| `meta.generated.worldCoverValidation` | The accuracy figures quoted from the WorldCover validation report, with page references |
| `width`, `height`, `cellSizeM` | 64, 64, 100 |
| `coverLegend`, `structureLegend` | Names behind the codes, checked against the game's lists when loading |
| `worldCoverLegend` | WorldCover class code to name (for example `"20": "Shrubland"`) |
| `layers.elevationCm` | Elevation in whole centimetres (depression-filled) |
| `layers.cover` | Game cover code used to start the game |
| `layers.observedCover` | Game cover that wins the majority vote after WorldCover pixels are mapped to game covers (so shrubland and grassland pixels are pooled), before the channel, road and settlement rules, except that cells where water is the most common native class or at least 30% of pixels stay water (step 4). It is not the WorldCover class itself |
| `layers.worldCoverClass` | The most common native WorldCover class in the cell (10 to 100), before any mapping |
| `layers.worldCoverSharePct` | Share of the cell's valid pixels in that class, 1 to 100 |
| `layers.structure`, `layers.structureLevel` | Starting housing and roads |
| `layers.protected`, `layers.channel` | Map edge ring; derived stream cells |
| `layers.roadSource` | 0 none, 1 OSM main road, 2 OSM minor road used as a link, 3 link added by the pipeline |
| `layers.builtPct` | Share of WorldCover built-up pixels in the cell, 0 to 100 |
| `layers.demFilledPct` | Share of the cell's DEM pixels the producer void-filled from another elevation source (here ASTER GDEM), 0 to 100 |

The browser side (`src/data/worldFile.ts`) checks the format and version, the legends, every layer's length, type and range, that housing levels match structures, that channel cells are water with no structures, that housing and roads sit only on urban cover and that no structure other than a reservoir sits on water or wetland (the same rules the game follows when it builds), that the bbox is valid, and that a real-data world lists its sources and carries attribution lines, disclosures, a bbox and a CRS (the licences require attribution wherever the map is shown). Any failure gives a short message for players and a full list of problems for developers, and `loadWorldWithFallback` then starts the Amoria Valley instead.

## Assumptions and limitations

- **Scale.** Each 100 m cell averages about 11 DEM pixels (about 30.9 m by 30.7 m) and counts about 117 native WorldCover pixels (about 9.3 m by 9.2 m, nominally 10 m). Single homesteads, narrow gullies, terraces and field edges disappear. Slopes come out gentler than in the source: the mean Horn slope is 0.13 (rise over run) on the 100 m grid against 0.18 on the native 30 m DEM pixels, and 7.9% of game cells are steeper than 30% against 14.3% of native pixels. The ground itself is steeper still in places, since even the 30 m DEM smooths out terraces and gullies.
- **WorldCover is a classification of 2021 imagery, not a forecast, and it can be wrong.** It says how ESA's algorithm classified that year's Sentinel-1 and Sentinel-2 data. It says nothing about what happens after a player changes the land; that is the game's model. Changes between WorldCover versions (2020 v100 and 2021 v200) are partly algorithm changes, so we do not use them as measured change.
- **WorldCover accuracy.** ESA's validation report gives an overall accuracy of 76.7% worldwide (section 3.1, page 15) and 76.5% for Africa (Table 3, page 16). Shrubland is the weakest class that matters here: in Africa only 48.5% of validation samples mapped as shrubland were judged shrubland (user's accuracy; grassland 70.7%, cropland 71.3%, tree cover 80.3%, built-up 47.1%, Table A2.1, page 27), and shrubland, grassland and cropland are often confused with each other. These are continental figures from the report, not an accuracy measured for this square. Since this square is 48% shrubland pixels, the split between grassland and cropland at the start of the game carries that uncertainty.
- **The elevation and the land cover come from different years.** The radar scenes behind the DEM over this square were taken from 2010-12-26 to 2013-02-28 (except the void-filled pixels in the next point); the land cover is 2021. Terrain changes in between (new terraces, dams, quarries, road cuts) are not in the elevation.
- **Not all of the elevation is TanDEM-X.** 52 of the 43,263 DEM pixels in the square (14 cells in the north-west, up to 92% of one cell) were void-filled by the producer from ASTER GDEM, which has other dates and comes from optical stereo imagery rather than radar. The `demFilledPct` layer marks those cells.
- **The DEM is a surface model.** Tree canopy and buildings can add a few metres. Heights are relative to the EGM2008 geoid.
- **Pit filling.** 97 cells were raised so that water always reaches the edge: 91 cells in pits, by at most 7.06 m, and 6 cells nudged by the 5 cm per cell gradient although they were not in a depression, by at most 0.25 m. Small real depressions (for example farm ponds or sand dams) are therefore not represented as stores.
- **Channels are derived, not mapped.** They come from flow accumulation on the DEM. In a semi-arid area like this they are likely seasonal streams, but the DEM and WorldCover cannot show whether or when water flows; the game treats channel cells as permanent water. All 188 channel cells are water cover: 187 because of their contributing area, and 1 because it is observed water that drains into them. The one WorldCover water cell off the network stays water but is not a channel.
- **Cover adjustments.** 495 of 4096 cells start with a different cover from `observedCover` (the mapped majority): channel cells set to water, road cells on land set to urban (bridges stay water), and cells with 15% or more built-up pixels set to urban. `observedCover` keeps the mapped majority before these rules and `worldCoverClass` keeps the native WorldCover class.
- **Shrubland as grassland.** 48% of the square's pixels are WorldCover shrubland, and shrubland is the most common class in 2196 cells. Treating it as grassland is a game simplification. Because pixels are mapped to game covers before the majority vote, shrubland and grassland pixels count together, and that changes the winner of some cells. In 71 cells the cell comes out as grassland although its most common WorldCover class is something else: cropland in 48 cells, tree cover in 19 and built-up in 4. Water is exempt (step 4): 2 cells whose most common class is permanent water would also have become grassland, and stay water instead. (Channel, road and settlement rules then change some of these.) The `worldCoverClass` layer lets anyone see the native class for every cell.
- **Housing is a representation, not a census.** Housing cells and their levels come from built-up pixel shares (60 cells became settled through the 15% rule). WorldCover's built-up class is one of its least reliable here: in Africa only 47.1% (+/- 9.7) of validation samples mapped as built-up were built-up (user's accuracy; producer's accuracy 84.0%, Table A2.1, page 27). The rest were mostly grassland, bare ground or trees, so some settled cells may have no buildings at all. The game's population and housing capacity are model values.
- **Roads.** Main roads are real OSM roads, but a 100 m road cell is much wider than the real road. 40 link cells follow real OSM minor roads, 2 were added by the pipeline. Where a main road crosses a channel the cell stays water and carries the road as a bridge (4 cells in Kaani); a bridge does not change the river's flow in the model.
- **The protected edge ring is a game rule.** The 252 cells around the map edge are closed to new building so the map has a margin. They are not a reserve or any mapped protected area (no protected-area data was used), so an edge cell marked protected in the game says nothing about its legal status. 21 of them already carry OSM roads or housing, which are kept.
- **Soil health is not measured from satellites.** Nothing in this file says anything about soil condition, soil moisture or yields. The game estimates those with its own model rules.
- **OSM changes over time.** The snapshot is dated. A refreshed query will give slightly different roads.

## 3D assets

The rendering team records third-party 3D assets and their licences in [`public/assets/LICENSES.md`](../public/assets/LICENSES.md). At the time of writing that is the Kenney Nature Kit 2.1 (CC0 1.0) for trees, bushes, stumps, rocks and lily pads; houses, roads, crops, terrain and water are procedural geometry written for Amoria.
