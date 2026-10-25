"""Turn source rasters and per-cell source pixel counts into the game's 64x64 world layers."""
from __future__ import annotations

import heapq
from dataclasses import dataclass

import numpy as np

from . import hydro
from .config import (
    COVER,
    DEM_FILL_EDITED,
    DEM_FILL_MASK_VALUES,
    DEM_FILL_NOT_EDITED,
    LAND_COVERS,
    STRUCT,
    WATER_KEEP_MIN_SHARE,
    WORLDCOVER_CLASSES,
    WORLDCOVER_NODATA,
    WORLDCOVER_TIE_PRIORITY,
    WORLDCOVER_TO_GAME,
    Region,
)

# When two game covers get the same number of WorldCover pixels in a cell, the earlier
# entry wins. Water and wetland first (rare, hydrologically important), then the
# more structurally protective covers.
TIE_PRIORITY = ("water", "wetland", "forest", "cropland", "grassland", "urban", "bare", "agroforestry")


@dataclass(frozen=True)
class CoverAggregate:
    # (n, n) game cover code: pixels mapped to game covers first, then majority per cell
    observed: np.ndarray
    # (n, n) native WorldCover code with the most pixels in the cell (plurality), and its
    # share of the cell's valid pixels. This is the satellite class, before any mapping.
    native: np.ndarray
    native_share: np.ndarray
    built_frac: np.ndarray  # (n, n) share of valid pixels that are WorldCover 50
    nodata_frac: np.ndarray  # (n, n) share of pixels without a WorldCover class
    class_counts: dict[int, int]  # WorldCover class -> pixel count over the box
    pixels: np.ndarray  # (n, n) source pixels counted in each cell, nodata included
    # (n, n) cells kept as water by the water rule that the pooled vote alone would
    # have given to another cover
    water_kept: np.ndarray


def aggregate_worldcover(wc: np.ndarray, size: int) -> CoverAggregate:
    """Majority vote over square blocks of an already gridded WorldCover array.

    Used by the unit tests; the pipeline counts native pixels per cell instead
    (sources.pixel_cells and aggregate_counts), so no pixel is dropped.
    """
    f = wc.shape[0] // size
    blocks = wc.reshape(size, f, size, f).transpose(0, 2, 1, 3).reshape(size, size, f * f)
    counts = np.stack([(blocks == v).sum(axis=2) for v in range(256)], axis=-1)
    return aggregate_counts(counts)


def aggregate_counts(counts: np.ndarray) -> CoverAggregate:
    """Majority vote of mapped game covers from per-cell WorldCover pixel counts.

    counts is (n, n, 256): how many native pixels of each WorldCover value fall
    in each cell (value 0 is nodata). One exception to the vote: a cell whose most
    common native class is WorldCover 80, or whose valid pixels are at least
    WATER_KEEP_MIN_SHARE water, stays water (see config.py).
    """
    present = np.flatnonzero(counts.sum(axis=(0, 1)))
    unknown = [int(v) for v in present if v != WORLDCOVER_NODATA and v not in WORLDCOVER_TO_GAME]
    if unknown:
        raise ValueError(f"WorldCover values without a mapping: {unknown}")
    game_counts = np.zeros((*counts.shape[:2], len(LAND_COVERS)), dtype=np.int64)
    for wc_code, game in WORLDCOVER_TO_GAME.items():
        game_counts[..., COVER[game]] += counts[..., wc_code]
    order = [COVER[c] for c in TIE_PRIORITY]
    # argmax over covers in tie-priority order, then map back to cover codes
    ranked = game_counts[..., order]
    observed = np.array(order, dtype=np.uint8)[ranked.argmax(axis=-1)]
    native_codes = list(WORLDCOVER_TIE_PRIORITY)
    native_counts = counts[..., native_codes]
    best = native_counts.argmax(axis=-1)
    native = np.array(native_codes, dtype=np.uint8)[best]
    total = counts.sum(axis=-1)
    nvalid = total - counts[..., WORLDCOVER_NODATA]
    native_share = np.take_along_axis(native_counts, best[..., None], axis=-1)[..., 0] / np.maximum(nvalid, 1)
    # Water rule (config.WATER_KEEP_MIN_SHARE): observed open water survives pooling.
    water_share = counts[..., 80] / np.maximum(nvalid, 1)
    keep_water = (counts[..., 80] > 0) & ((native == 80) | (water_share >= WATER_KEEP_MIN_SHARE))
    water_kept = keep_water & (observed != COVER["water"])
    observed = np.where(keep_water, np.uint8(COVER["water"]), observed).astype(np.uint8)
    built = counts[..., 50] / np.maximum(nvalid, 1)
    box = counts.sum(axis=(0, 1))
    return CoverAggregate(
        observed=observed,
        native=native,
        native_share=native_share,
        built_frac=built,
        nodata_frac=np.where(total > 0, 1 - nvalid / np.maximum(total, 1), 1.0),
        class_counts={int(v): int(box[v]) for v in np.flatnonzero(box)},
        pixels=total,
        water_kept=water_kept,
    )


def merged_winner_cells(agg: CoverAggregate) -> np.ndarray:
    """Cells where pooling WorldCover classes into game covers changes the winner.

    True where the game cover that wins after mapping (observed) is not the game
    cover of the most common native class. Pooling shrubland with grassland is the
    main cause: e.g. 40% cropland, 35% shrub, 25% grass is cropland natively but
    grassland after pooling.
    """
    lut = np.full(256, 255, dtype=np.uint8)
    for wc_code, game in WORLDCOVER_TO_GAME.items():
        lut[wc_code] = COVER[game]
    return lut[agg.native] != agg.observed


def merged_winner_breakdown(agg: CoverAggregate) -> dict[tuple[int, str], int]:
    """(native WorldCover code, game cover that won instead) -> cell count, largest first."""
    mask = merged_winner_cells(agg)
    pairs: dict[tuple[int, str], int] = {}
    for code, game in zip(agg.native[mask].tolist(), agg.observed[mask].tolist(), strict=True):
        key = (int(code), LAND_COVERS[game])
        pairs[key] = pairs.get(key, 0) + 1
    return dict(sorted(pairs.items(), key=lambda kv: (-kv[1], kv[0])))


def worldcover_legend() -> dict[str, str]:
    return {str(k): v for k, v in sorted(WORLDCOVER_CLASSES.items())}


@dataclass(frozen=True)
class Hydrology:
    filled: np.ndarray
    receivers: np.ndarray
    accumulation: np.ndarray
    slope: np.ndarray
    channel: np.ndarray
    # Observed WorldCover water cells that are not on the derived stream network
    # (ponds, small dams). They stay water cover but are not channels.
    water_body: np.ndarray
    channel_by_area: int
    channel_by_water: int
    main_outlet: int
    # Cells the fill raised in total, split into cells that sit in a real
    # depression (raised even with a zero gradient) and cells only nudged up by
    # the epsilon gradient across filled or flat ground.
    filled_cells: int
    max_fill_m: float
    pit_cells: int
    max_pit_fill_m: float
    nudged_cells: int
    max_nudge_m: float


def derive_hydrology(elev: np.ndarray, observed: np.ndarray, region: Region) -> Hydrology:
    n = elev.shape[0]
    # Round to 1 cm first so the export rounding cannot undo the fill gradient.
    base = np.round(elev.astype(np.float64), 2)
    filled = np.round(hydro.fill_depressions(base, region.fill_epsilon_m), 2)
    receivers = hydro.d8_receivers(filled, region.cell_m)
    pits = hydro.interior_pits(filled, receivers)
    if pits:
        raise ValueError(f"{len(pits)} interior pits remain after filling")
    acc = hydro.flow_accumulation(filled, receivers)
    outlets = np.flatnonzero(receivers < 0)
    main_outlet = int(outlets[np.argmax(acc[outlets])])
    channel, water_body = channel_network(acc.reshape(n, n), receivers, observed, region.channel_min_cells)
    by_area = acc.reshape(n, n) >= region.channel_min_cells
    rise = filled - base
    raised = rise > 0.005
    # With a zero gradient Priority-Flood raises only cells inside depressions.
    in_pit = raised & (hydro.fill_depressions(base, 0.0) - base > 0.005)
    nudged = raised & ~in_pit
    return Hydrology(
        filled=filled,
        receivers=receivers,
        accumulation=acc,
        slope=hydro.slope_max(filled, region.cell_m),
        channel=channel.astype(np.uint8),
        water_body=water_body.astype(np.uint8),
        channel_by_area=int(by_area.sum()),
        channel_by_water=int((channel & ~by_area).sum()),
        main_outlet=main_outlet,
        filled_cells=int(raised.sum()),
        max_fill_m=float(rise.max()),
        pit_cells=int(in_pit.sum()),
        max_pit_fill_m=float(rise[in_pit].max()) if in_pit.any() else 0.0,
        nudged_cells=int(nudged.sum()),
        max_nudge_m=float(rise[nudged].max()) if nudged.any() else 0.0,
    )


def channel_network(acc: np.ndarray, receivers: np.ndarray, observed: np.ndarray,
                    min_cells: int) -> tuple[np.ndarray, np.ndarray]:
    """Split cells into stream channels and off-network water bodies.

    A cell is a channel if its contributing area reaches min_cells. An observed
    WorldCover water cell below that area joins the channel network only if its
    D8 receiver is a channel (directly or through other such water cells), so
    the network always drains continuously. Remaining observed water cells are
    water bodies: open water, but not part of any stream.
    """
    n = acc.shape[0]
    flat_channel = (acc >= min_cells).ravel().copy()
    water = (observed == COVER["water"]).ravel()
    changed = True
    while changed:
        changed = False
        for i in np.flatnonzero(water & ~flat_channel):
            j = receivers[i]
            if j >= 0 and flat_channel[j]:
                flat_channel[i] = True
                changed = True
    water_body = water & ~flat_channel
    return flat_channel.reshape(n, n), water_body.reshape(n, n)


def _components(mask: np.ndarray) -> list[list[int]]:
    """8-connected components of a boolean grid, as flat index lists."""
    n = mask.shape[0]
    seen = np.zeros_like(mask, dtype=bool)
    comps = []
    for start in np.flatnonzero(mask):
        z0, x0 = divmod(int(start), n)
        if seen[z0, x0]:
            continue
        stack, comp = [(z0, x0)], []
        seen[z0, x0] = True
        while stack:
            z, x = stack.pop()
            comp.append(z * n + x)
            for dz, dx in hydro.NEIGHBOURS:
                nz, nx = z + dz, x + dx
                if 0 <= nz < n and 0 <= nx < n and mask[nz, nx] and not seen[nz, nx]:
                    seen[nz, nx] = True
                    stack.append((nz, nx))
        comps.append(sorted(comp))
    return comps


def _least_cost_path(starts: set[int], targets: set[int], cost: np.ndarray) -> list[int]:
    """Dijkstra over the 8-neighbour grid; returns cells from a start to a target."""
    n = cost.shape[0]
    dist = {s: 0.0 for s in starts}
    prev: dict[int, int] = {}
    pq = [(0.0, s) for s in sorted(starts)]
    heapq.heapify(pq)
    while pq:
        d, i = heapq.heappop(pq)
        if d > dist.get(i, np.inf):
            continue
        if i in targets:
            path = [i]
            while path[-1] in prev:
                path.append(prev[path[-1]])
            return path[::-1]
        z, x = divmod(i, n)
        for dz, dx in hydro.NEIGHBOURS:
            nz, nx = z + dz, x + dx
            if 0 <= nz < n and 0 <= nx < n:
                j = nz * n + nx
                nd = d + np.hypot(dz, dx) * cost[nz, nx]
                if nd < dist.get(j, np.inf):
                    dist[j] = nd
                    prev[j] = i
                    heapq.heappush(pq, (nd, j))
    return []


ROAD_NONE, ROAD_OSM_MAIN, ROAD_OSM_MINOR, ROAD_SYNTHETIC = 0, 1, 2, 3


@dataclass(frozen=True)
class Settlement:
    cover: np.ndarray
    structure: np.ndarray
    structure_level: np.ndarray
    # 0 none, 1 OSM main road, 2 OSM minor road used to link a settlement,
    # 3 synthetic connector where OSM has no road (game simplification)
    road_source: np.ndarray
    urban_by_threshold: int
    road_counts: dict[str, int]
    clusters: list[list[int]]


def _edge_mask(n: int) -> np.ndarray:
    edge = np.zeros((n, n), dtype=bool)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True
    return edge


def _edge_connected(network: np.ndarray) -> set[int]:
    """Cells of the road network that belong to a component touching the map edge."""
    flat_edge = _edge_mask(network.shape[0]).ravel()
    out: set[int] = set()
    for comp in _components(network):
        if any(flat_edge[i] for i in comp):
            out.update(comp)
    return out


def _touches(cluster: list[int], cells: set[int], n: int) -> bool:
    for i in cluster:
        z, x = divmod(i, n)
        for dz, dx in hydro.NEIGHBOURS:
            if 0 <= z + dz < n and 0 <= x + dx < n and (z + dz) * n + (x + dx) in cells:
                return True
    return False


def build_settlement(observed: np.ndarray, built_frac: np.ndarray, channel: np.ndarray,
                     slope: np.ndarray, osm_main: np.ndarray, osm_minor: np.ndarray,
                     region: Region) -> Settlement:
    n = observed.shape[0]
    cover = observed.copy()
    # Channels and off-network water bodies are both open water: no houses. A road that
    # crosses them stays on the map as a bridge: the cell keeps its water cover.
    wet = (channel == 1) | (observed == COVER["water"])
    urban_rule = (built_frac >= region.urban_min_built_frac) & (observed != COVER["urban"]) & ~wet
    cover[urban_rule] = COVER["urban"]
    cover[channel == 1] = COVER["water"]
    urban = cover == COVER["urban"]

    # Dense built-up cells stay housing even where a road crosses them; the road
    # is read as a street between the houses and still counts for connectivity.
    dense = urban & (built_frac >= region.housing_over_road_built_frac)
    road_source = np.where((osm_main == 1) & ~dense, ROAD_OSM_MAIN, ROAD_NONE).astype(np.uint8)
    streets = (osm_main == 1) & dense

    clusters = [c for c in _components(urban & (road_source == 0)) if len(c) >= region.connector_min_cluster]

    # Link every settlement cluster to a road that leaves the map. Prefer the
    # OSM minor road network (cheap to travel along); only where it has gaps
    # does the path cross open land, and those cells are flagged synthetic.
    # Water is expensive to cross, and where the path still crosses it, it bridges it.
    cost = (np.where(osm_minor == 1, 1.0, 20.0) + 25.0 * slope + np.where(wet, 60.0, 0.0))
    flat_edge = _edge_mask(n).ravel()
    for cluster in sorted(clusters, key=len, reverse=True):
        # Reachability leaves the bridges out, so a hamlet keeps the OSM minor road that links
        # it on its own bank instead of being counted as served by a detour over a bridge.
        reachable = _edge_connected(((road_source > 0) & ~wet) | streets)
        if _touches(cluster, reachable, n):
            continue
        targets = reachable or set(np.flatnonzero(flat_edge).tolist())
        members = set(cluster)
        for i in _least_cost_path(members, targets, cost):
            z, x = divmod(i, n)
            if i in members or road_source[z, x] or urban[z, x]:
                continue
            road_source[z, x] = ROAD_OSM_MINOR if osm_minor[z, x] else ROAD_SYNTHETIC

    structure = np.zeros((n, n), dtype=np.uint8)
    level = np.zeros((n, n), dtype=np.uint8)
    roads = road_source > 0
    bridges = roads & wet
    structure[roads] = STRUCT["road"]
    cover[roads & ~wet] = COVER["urban"]
    houses = (cover == COVER["urban"]) & ~roads
    structure[houses] = STRUCT["housing"]
    level[houses] = np.where(built_frac[houses] >= 0.7, 3, np.where(built_frac[houses] >= 0.4, 2, 1))
    return Settlement(
        cover=cover,
        structure=structure,
        structure_level=level,
        road_source=road_source,
        urban_by_threshold=int(urban_rule.sum()),
        road_counts={
            "osmMain": int((road_source == ROAD_OSM_MAIN).sum()),
            "osmMinorLink": int((road_source == ROAD_OSM_MINOR).sum()),
            "synthetic": int((road_source == ROAD_SYNTHETIC).sum()),
            "streetCellsKeptAsHousing": int(streets.sum()),
            "bridges": int(bridges.sum()),
        },
        clusters=clusters,
    )


def edge_protection(size: int) -> np.ndarray:
    p = np.zeros((size, size), dtype=np.uint8)
    p[0, :] = p[-1, :] = p[:, 0] = p[:, -1] = 1
    return p


@dataclass(frozen=True)
class DemFill:
    """Where the producer edited or void-filled the DEM, per 100 m cell."""

    pixels: np.ndarray  # (n, n) DEM pixels whose centre is in the cell
    filled: np.ndarray  # (n, n) of those, void-filled from an external source (FLM >= 3)
    by_source: dict[int, int]  # FLM value -> pixel count over the grid (fill sources only)
    edited: int  # FLM 1 pixels (edited, not filled)
    edit_counts: dict[int, int]  # EDM value -> pixel count over the grid
    mask_counts: dict[int, int]  # FLM value -> pixel count over the grid (every value)
    cells: list[dict]  # one entry per cell with any void-filled pixel


def dem_fill_summary(flm_counts: np.ndarray, edm_counts: np.ndarray) -> DemFill:
    """Summarise the Filling Mask and Editing Mask counted per cell.

    flm_counts and edm_counts are (n, n, 256) per-cell counts of each mask value
    (sources.cell_value_counts). FLM values 3 and above name a fill source.
    """
    pixels = flm_counts.sum(axis=-1)
    filled_by = flm_counts[..., DEM_FILL_NOT_EDITED + 1:]
    filled = filled_by.sum(axis=-1)
    grid_flm = flm_counts.sum(axis=(0, 1))
    grid_edm = edm_counts.sum(axis=(0, 1))
    cells = []
    for r, c in zip(*np.nonzero(filled), strict=True):
        per = {int(v): int(flm_counts[r, c, v]) for v in np.flatnonzero(flm_counts[r, c]) if v > DEM_FILL_NOT_EDITED}
        cells.append({"row": int(r), "col": int(c), "filledPixels": int(filled[r, c]), "pixels": int(pixels[r, c]),
                      "sharePct": round(100 * float(filled[r, c]) / max(int(pixels[r, c]), 1), 1),
                      "sources": {DEM_FILL_MASK_VALUES.get(v, str(v)): k for v, k in per.items()}})
    return DemFill(
        pixels=pixels,
        filled=filled,
        by_source={int(v): int(grid_flm[v]) for v in np.flatnonzero(grid_flm) if v > DEM_FILL_NOT_EDITED},
        edited=int(grid_flm[DEM_FILL_EDITED]),
        edit_counts={int(v): int(grid_edm[v]) for v in np.flatnonzero(grid_edm)},
        mask_counts={int(v): int(grid_flm[v]) for v in np.flatnonzero(grid_flm)},
        cells=cells,
    )


def fill_patches(fill: DemFill, n: int) -> list[list[tuple[int, int]]]:
    """8-connected groups of cells that hold void-filled DEM pixels."""
    mask = fill.filled > 0
    return [[divmod(i, n) for i in comp] for comp in _components(mask)]


def compass(row: float, col: float, n: int) -> str:
    """Rough part of the map a cell is in: north-west, centre, south and so on."""
    third = n / 3
    ns = "north" if row < third else "south" if row >= 2 * third else ""
    ew = "west" if col < third else "east" if col >= 2 * third else ""
    return f"{ns}-{ew}" if ns and ew else ns or ew or "centre"


def slope_summary(slope: np.ndarray) -> dict:
    """Mean, median, 90th percentile and share of steep pixels of a slope array (rise/run)."""
    v = np.asarray(slope, dtype=np.float64).ravel()
    return {
        "count": int(v.size),
        "mean": round(float(v.mean()), 4),
        "median": round(float(np.median(v)), 4),
        "p90": round(float(np.percentile(v, 90)), 4),
        "pctAbove15": round(100 * float((v > 0.15).mean()), 1),
        "pctAbove30": round(100 * float((v > 0.30).mean()), 1),
    }
