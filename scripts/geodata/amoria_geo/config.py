"""Static configuration for the Amoria geodata pipeline.

Everything that decides what the exported world looks like lives here, so a
reviewer can audit the choices in one place: the region box, the source URLs,
the WorldCover -> game cover mapping and the derivation thresholds.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# Game cover codes. Must match LAND_COVERS order in src/simulation/types.ts.
LAND_COVERS = (
    "forest",
    "grassland",
    "cropland",
    "agroforestry",
    "urban",
    "wetland",
    "water",
    "bare",
)
COVER = {name: i for i, name in enumerate(LAND_COVERS)}

# Structure codes. Must match STRUCTURES order in src/simulation/types.ts.
STRUCTURES = ("none", "road", "housing", "reservoir", "waterworks", "market")
STRUCT = {name: i for i, name in enumerate(STRUCTURES)}

# ESA WorldCover 2021 v200 class values -> game covers.
# 20 (shrubland) has no direct game class. The semi-arid bushland it describes
# behaves closer to grassland than to closed forest for runoff and grazing, so
# it maps to grassland. 70 (snow and ice) and 100 (moss and lichen) do not occur
# in the region; they map to bare so the table is total.
WORLDCOVER_CLASSES = {
    10: "Tree cover",
    20: "Shrubland",
    30: "Grassland",
    40: "Cropland",
    50: "Built-up",
    60: "Bare / sparse vegetation",
    70: "Snow and ice",
    80: "Permanent water bodies",
    90: "Herbaceous wetland",
    95: "Mangroves",
    100: "Moss and lichen",
}
WORLDCOVER_TO_GAME = {
    10: "forest",
    20: "grassland",
    30: "grassland",
    40: "cropland",
    50: "urban",
    60: "bare",
    70: "bare",
    80: "water",
    90: "wetland",
    95: "wetland",
    100: "bare",
}
WORLDCOVER_NODATA = 0
# When two WorldCover classes have the same pixel count in a cell, the earlier
# code wins. Same spirit as the game-cover tie order in derive.TIE_PRIORITY:
# water and wetland first, then trees, crops, grass, shrub, built-up, bare.
WORLDCOVER_TIE_PRIORITY = (80, 90, 95, 10, 40, 30, 20, 50, 60, 70, 100)
# Open water is rare in this dryland square and matters for the water game, so a
# cell stays water when WorldCover 80 (permanent water bodies) is its most common
# native class, or when at least this share of its valid pixels is water, even if
# pooled shrubland and grassland pixels would outvote it. The tie order alone
# cannot protect it: pooling 35% shrub with 27% grass beats 38% water.
WATER_KEEP_MIN_SHARE = 0.30


@dataclass(frozen=True)
class Source:
    name: str
    version: str
    license: str
    url: str
    attribution: str


# When the Copernicus DEM elevation was measured, as stated by its producer. The
# GeoTIFF on AWS carries no date tag; these statements are quoted from the
# Copernicus DEM Product Handbook (Airbus Defence and Space, version 5.0,
# 29 November 2022). The per-tile period and the scenes over the box are read
# separately from the tile's own XML metadata and source-scene layer
# (amoria_geo/demdates.py).
COPERNICUS_DEM_HANDBOOK = {
    "document": "Copernicus DEM Product Handbook, version 5.0, 29 November 2022 (GEO.2018-1988-2)",
    "url": (
        "https://dataspace.copernicus.eu/sites/default/files/media/files/2024-06/"
        "geo1988-copernicusdem-spe-002_producthandbook_i5.0.pdf"
    ),
    "acquisitionPeriodStated": "December 2010 to January 2015",
    "quotes": [
        "section 2.1, page 30: \"the TanDEM-X/WorldDEM has been acquired between December 2010 and January 2015\"",
        "section 1.3.1, page 28: \"The Copernicus DEM GLO-30 and GLO-90 instances cover the full global landmass "
        "of the time frame of data acquisition (2011-2015).\"",
    ],
    "statedBy": "producer (Airbus Defence and Space), not read from the elevation file",
}


# Pixel values of the GLO-30 quality layers, from the Copernicus DEM Product
# Handbook v5.0, Table 6 (Edit Data Mask, page 18) and Table 7 (Filling Mask,
# page 19). FLM values 3 and up name the external elevation source a void was
# filled from; EDM 2 is "infill of external elevation data".
DEM_FILL_MASK_VALUES = {
    0: "Void (no data)",
    1: "Edited (except filled pixels)",
    2: "Not edited / not filled",
    3: "ASTER GDEM",
    4: "SRTM90",
    5: "SRTM30",
    6: "GMTED2010",
    7: "SRTM30plus",
    8: "TerraSAR-X Radargrammetric DEM",
    9: "AW3D30",
    100: "Norway DEM",
    101: "DSM05 Spain",
    102: "Norway DEM v2",
}
DEM_FILL_NOT_EDITED = 2
DEM_FILL_EDITED = 1
DEM_EDIT_MASK_VALUES = {
    0: "Void (no data)",
    1: "Not edited",
    2: "Infill of external elevation data",
    3: "Interpolated pixels",
    4: "Smoothed pixels",
    5: "Airport editing",
    6: "Raised negative elevation pixels",
    7: "Flattened pixels",
    8: "Ocean pixels",
    9: "Lake pixels",
    10: "River pixels",
    11: "Shoreline pixels",
    12: "Morphed pixels (series of pixels manually set)",
    13: "Shifted pixels",
}
DEM_MASK_TABLES = "Copernicus DEM Product Handbook v5.0, Table 6 (page 18) and Table 7 (page 19)"


COPERNICUS_DEM = Source(
    name="Copernicus DEM GLO-30",
    # The AWS COG carries no release tag, so the version names only what can be
    # checked; build_world.py appends the tile file's HTTP Last-Modified date.
    version="GLO-30, AWS Open Data COG copy",
    license=(
        "Copernicus DEM GLO-30 free licence with attribution "
        "(https://dataspace.copernicus.eu/explore-data/data-collections/"
        "copernicus-contributing-missions/collections-description/COP-DEM); "
        "DOI 10.5270/ESA-c5d3d65"
    ),
    url="https://copernicus-dem-30m.s3.amazonaws.com/readme.html",
    attribution=(
        "Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and "
        "© Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS "
        "by the European Union and ESA; all rights reserved."
    ),
)

ESA_WORLDCOVER = Source(
    name="ESA WorldCover 10 m 2021",
    version="v200 (COG tags: product_version V2.0.0, algorithm_version V2.0.0, observation period 2021)",
    license=(
        "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); "
        "cite Zanaga et al. 2022, DOI 10.5281/zenodo.7254221"
    ),
    url="https://esa-worldcover.org/en/data-access",
    attribution=(
        "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel "
        "data (2021) processed by ESA WorldCover consortium."
    ),
)

# Accuracy figures for WorldCover 2021 v200, quoted from ESA's own validation
# report (downloaded and read; page numbers are the report's page footers).
# These are continental and global figures, not an accuracy for our square.
WORLDCOVER_VALIDATION = {
    "document": "WorldCover Product Validation Report (D12-PVR), version 2.0, last modified 2022-10-25",
    "url": "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/docs/WorldCover_PVR_V2.0.pdf",
    "sha256": "05700af5f1462beebf3007ead5b68bccc5f4c016a7bdb26d5c9b6e3db4a1f4a9",
    "overallAccuracyGlobalPct": 76.7,
    "overallAccuracyAfricaPct": 76.5,
    "africaUsersAccuracyPct": {"Shrubland": 48.5, "Grassland": 70.7, "Cropland": 71.3, "Tree cover": 80.3,
                               "Built-up": 47.1},
    "africaUsersAccuracyConfidencePct": {"Built-up": 9.7},
    "africaProducersAccuracyPct": {"Shrubland": 73.1, "Grassland": 62.7, "Cropland": 58.9, "Tree cover": 80.1,
                                   "Built-up": 84.0},
    "quotes": [
        "section 3.1, page 15: \"On a global scale, using 2.16 million SSUs at 21 624 PSU locations, the overall "
        "map accuracy was 76.7\u00b10.5%.\"",
        "Table 3, page 16: overall accuracy for Africa 76.5 +/- 1.3 (359,900 SSU, 3,599 PSU)",
        "Table A2.1, page 27 (Africa): user's accuracy shrubland 48.5, grassland 70.7, cropland 71.3, tree cover "
        "80.3; producer's accuracy shrubland 73.1, grassland 62.7, cropland 58.9, tree cover 80.1",
        "Table A2.1, page 27 (Africa): built-up user's accuracy 47.1 (confidence interval +/- 9.7), producer's "
        "accuracy 84.0",
        "section 3.1, page 15: \"shrubs, wetlands, and moss/lichen classes had relatively lower accuracies "
        "globally.\"",
    ],
}

OSM = Source(
    name="OpenStreetMap (roads and place names via Overpass API)",
    version="snapshot (see meta.generated.osmTimestamp)",
    license="ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/)",
    url="https://www.openstreetmap.org/copyright",
    attribution="© OpenStreetMap contributors, data available under the Open Database License.",
)


def dem_tile_url(lat_sw: int, lon_sw: int) -> str:
    """Copernicus GLO-30 1x1 degree tile named by its south-west corner."""
    ns = "N" if lat_sw >= 0 else "S"
    ew = "E" if lon_sw >= 0 else "W"
    name = f"Copernicus_DSM_COG_10_{ns}{abs(lat_sw):02d}_00_{ew}{abs(lon_sw):03d}_00_DEM"
    return f"https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif"


def dem_aux_url(lat_sw: int, lon_sw: int, layer: str) -> str:
    """A GLO-30 quality layer (FLM, EDM, HEM, WBM) from the tile's AUXFILES folder."""
    folder, file = dem_tile_url(lat_sw, lon_sw).rsplit("/", 1)
    return f"{folder}/AUXFILES/{file.removesuffix('_DEM.tif')}_{layer}.tif"


def worldcover_tile_url(lat_sw: int, lon_sw: int) -> str:
    """WorldCover 3x3 degree tile named by its south-west corner (multiples of 3)."""
    ns = "N" if lat_sw >= 0 else "S"
    ew = "E" if lon_sw >= 0 else "W"
    tile = f"{ns}{abs(lat_sw):02d}{ew}{abs(lon_sw):03d}"
    return (
        "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
        f"ESA_WorldCover_10m_2021_v200_{tile}_Map.tif"
    )


OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "amoria-geodata/1.0 (UNCCD Hack for Social Impact 2026 educational game)"


@dataclass(frozen=True)
class Region:
    id: str
    name: str
    description: str
    # Centre of the box in WGS84 degrees.
    center_lat: float
    center_lon: float
    utm_epsg: int
    grid: int = 64
    cell_m: float = 100.0
    # Derivation knobs (documented in docs/DATA_SOURCES.md).
    # Minimum share of WorldCover built-up pixels for a 100 m cell to count as urban.
    urban_min_built_frac: float = 0.15
    # Cells at least this built-up stay housing even where an OSM road crosses;
    # the road is treated as a village street running between the houses.
    housing_over_road_built_frac: float = 0.30
    # Settlement clusters with at least this many cells get a road connection.
    connector_min_cluster: int = 3
    # Contributing area (cells, 1 cell = 1 ha) above which a cell is a channel.
    channel_min_cells: int = 150
    # OSM highway classes rasterised as game roads.
    road_classes: tuple[str, ...] = ("trunk", "primary", "secondary", "tertiary")
    # OSM classes used only to route links from settlements to the main roads.
    minor_road_classes: tuple[str, ...] = ("unclassified", "residential", "track", "service")
    # Depression-filling gradient, metres per cell step. Must survive float32
    # and the 1 cm export rounding.
    fill_epsilon_m: float = 0.05
    # The export stops if more than this share of the DEM pixels in the grid were
    # void-filled by the producer from other elevation sources (the provenance
    # then could not call the elevation TanDEM-X). Any fill at all is disclosed.
    dem_max_void_filled_frac: float = 0.05
    notes: tuple[str, ...] = field(default_factory=tuple)


REGIONS: dict[str, Region] = {}


def register(region: Region) -> Region:
    REGIONS[region.id] = region
    return region
