#!/usr/bin/env python3
"""Build an Amoria real-data world from Copernicus DEM, ESA WorldCover and OSM.

Usage (from the repo root):
    scripts/geodata/.venv/bin/python scripts/geodata/build_world.py --region kaani-machakos
    scripts/geodata/.venv/bin/python scripts/geodata/build_world.py --region kaani-machakos --offline
    scripts/geodata/.venv/bin/python scripts/geodata/build_world.py --region kaani-machakos --preview-only

Steps: fetch source windows (cached) -> reproject to local UTM -> resample DEM
to 100 m (area average) -> count every native WorldCover pixel into the cell
holding its centre and take the majority of game covers -> count the DEM's
producer void fills per cell -> fill depressions, D8 routing, flow
accumulation -> channels -> slope summaries -> settlement and roads ->
validate -> export public/world-data/<id>.json.
"""
from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from amoria_geo import (  # noqa: E402
    demdates,
    derive,
    export,
    hydro,
    osm,
    regions,  # noqa: F401  (registers regions)
    sources,
    validate,
)
from amoria_geo.config import (  # noqa: E402
    COPERNICUS_DEM,
    COPERNICUS_DEM_HANDBOOK,
    COVER,
    DEM_EDIT_MASK_VALUES,
    DEM_FILL_MASK_VALUES,
    DEM_MASK_TABLES,
    ESA_WORLDCOVER,
    LAND_COVERS,
    OSM,
    REGIONS,
    WATER_KEEP_MIN_SHARE,
    WORLDCOVER_CLASSES,
    WORLDCOVER_TO_GAME,
    WORLDCOVER_VALIDATION,
)

REPO = HERE.parent.parent
DEM_NODATA = -9999.0
# 1.1.0: worldCoverClass/worldCoverSharePct layers, worldCoverLegend, sources[].acquired,
# generated.demAcquisition, off-network water bodies, UTC generation timestamp.
# 1.2.0: every native WorldCover pixel counted (no nearest-neighbour subsample),
# DEM Filling/Editing Mask read (demFilledPct layer, generated.demQualityMasks),
# Horn slope summaries at 100 m and 30 m, built-up accuracy, preview uses the
# committed OSM snapshot.
PIPELINE_VERSION = "1.3.0"


def osm_snapshot_path(key: str, cache: Path, preview_only: bool, refresh_osm: bool) -> Path:
    """Which OSM extract a run reads.

    Export and preview both use the committed snapshot for a registered region,
    so a preview checks exactly what ships. Only exploratory centres (--lat/--lon,
    which have no committed snapshot) and a preview that re-queries Overpass use
    the local cache, so a preview never rewrites the committed snapshot.
    """
    committed = HERE / "snapshots" / f"{key}_osm.json"
    if not preview_only:
        return committed
    if committed.exists() and not refresh_osm:
        return committed
    return cache / f"{key}_osm.json"


def rel(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(REPO))
    except ValueError:
        return str(path)


def run(region_id: str, offline: bool, preview_only: bool, lat: float | None, lon: float | None,
        refresh_osm: bool = False, collect: dict | None = None) -> int:
    """Build (or preview) one world. If collect is given, it is filled with the
    validation stats, cover shares and named places (used by check_candidates.py)."""
    region = REGIONS[region_id]
    if lat is not None and lon is not None:
        region = dataclasses.replace(region, center_lat=lat, center_lon=lon)
        preview_only = True
    key = f"{region.id}_{region.center_lat:.4f}_{region.center_lon:.4f}"
    cache = HERE / "cache" / key
    grid = sources.target_grid(region)
    bbox = grid.lonlat_bbox()
    print(f"[1/7] grid {grid.size}x{grid.size} @ {grid.cell_m:.0f} m in EPSG:{grid.epsg}, "
          f"NW corner ({grid.west:.0f}, {grid.north:.0f}); WGS84 bbox {tuple(round(v, 5) for v in bbox)}")

    print("[2/7] source windows")
    src = sources.fetch_sources(grid, cache, offline)
    provenance = {
        kind: [sources.describe_cached(url, path, sources.source_bbox(grid), offline) for url, path in items]
        for kind, items in src.items()
    }
    for kind, items in provenance.items():
        for rec in items:
            fetched = rec.get("bytesFetched")
            print(f"  {kind}: cached window {rec['cachedWindowBytes'] / 1024:.0f} KiB, sha256 "
                  f"{rec['cachedWindowSha256'][:12]}...; a fresh fetch reads "
                  + (f"{fetched / 1e6:.2f} MB of whole COG tiles" if fetched else "an unrecorded amount"))
    dem_dates = [demdates.dem_acquisition(url, cache, bbox, offline) for url, _ in src["dem"]]
    for rec in dem_dates:
        period = rec.get("boxAcquisitionPeriod")
        print("  DEM acquisition over the box: "
              + (f"{len(rec['scenesOverBox'])} TanDEM-X scenes, {period['first']} to {period['last']}"
                 if period else rec.get("note", "unknown")))
    snapshot = osm_snapshot_path(key, cache, preview_only, refresh_osm)
    print(f"  OSM extract: {rel(snapshot)}")
    osm_data = osm.fetch_osm(grid, snapshot, offline, refresh_osm)

    print("[3/7] reproject and resample")
    dem = sources.warp_to_grid([p for _, p in src["dem"]], grid, 1, Resampling.average, "float64", DEM_NODATA)
    # Every native WorldCover pixel (1/12000 degree) is counted in the cell that
    # holds its centre, so no pixel is dropped or counted twice.
    agg = derive.aggregate_counts(sources.cell_value_counts(
        [sources.pixel_cells(p, grid) for _, p in src["worldcover"]], grid.size))
    res = resolutions(src)
    print(f"  WorldCover pixels per cell: min {int(agg.pixels.min())}, mean {agg.pixels.mean():.1f}, "
          f"max {int(agg.pixels.max())} (pixel {res['worldCoverPixelM'][0]:.2f} x {res['worldCoverPixelM'][1]:.2f} m)")
    fill = derive.dem_fill_summary(
        sources.cell_value_counts([sources.pixel_cells(p, grid) for _, p in src["demFillMask"]], grid.size),
        sources.cell_value_counts([sources.pixel_cells(p, grid) for _, p in src["demEditMask"]], grid.size))
    errors = validate.check_sources(dem, DEM_NODATA, agg.nodata_frac)
    fill_errors, fill_warnings = validate.check_dem_fill(fill.pixels, fill.filled, fill.by_source,
                                                         region.dem_max_void_filled_frac)
    for w in fill_warnings:
        print("  WARNING", w)
    errors += fill_errors
    if errors:
        for e in errors:
            print("  ERROR", e)
        return 1

    print("[4/7] hydrology")
    hyd = derive.derive_hydrology(dem, agg.observed, region)
    print(f"  channels: {hyd.channel_by_area} by contributing area, {hyd.channel_by_water} WorldCover water "
          f"cells joined to them; {int(hyd.water_body.sum())} water cells off the stream network kept as water bodies")
    print(f"  filled {hyd.filled_cells} cells (max raise {hyd.max_fill_m:.2f} m): {hyd.pit_cells} in pits, "
          f"{hyd.nudged_cells} nudged by the gradient (max {hyd.max_nudge_m:.2f} m); "
          f"channel cells {int(hyd.channel.sum())}; main outlet {divmod(hyd.main_outlet, grid.size)} "
          f"draining {int(hyd.accumulation[hyd.main_outlet])} cells")

    slopes = slope_stats(hyd.filled, grid, src["dem"])
    print(f"  Horn slope (rise/run): mean {slopes['grid100m']['mean']} on the 100 m grid, "
          f"{slopes['native30m']['mean']} in the native DEM pixels")

    print("[5/7] settlement and roads")
    main_roads = osm.rasterize_roads(osm_data, grid, region.road_classes)
    minor_roads = osm.rasterize_roads(osm_data, grid, region.minor_road_classes)
    st = derive.build_settlement(agg.observed, agg.built_frac, hyd.channel, hyd.slope, main_roads, minor_roads,
                                 region)
    places = osm.places_in_grid(osm_data, grid)
    print(f"  urban cells added by built-up threshold: {st.urban_by_threshold}; road cells {st.road_counts}; "
          f"clusters {len(st.clusters)}")
    for p in places:
        print(f"  place: {p['name']} ({p['place']}) at row {p['row']} col {p['col']}")

    print("[6/7] validate")
    protected = derive.edge_protection(grid.size)
    errs, stats = validate.check_world(hyd.filled, st.cover, st.structure, hyd.channel, hyd.receivers,
                                       hyd.accumulation, hyd.main_outlet, grid.cell_m, protected)
    if collect is not None:
        collect.update({
            "center": [region.center_lat, region.center_lon],
            "stats": stats,
            "coverShare": {c: round(float((st.cover == COVER[c]).mean()), 3) for c in LAND_COVERS},
            "places": [p["name"] for p in places if p.get("name")],
            "errors": errs,
        })
    print("  " + json.dumps(stats))
    text = export.preview(st.cover, st.structure, hyd.channel)
    print(text)
    if errs:
        for e in errs:
            print("  ERROR", e)
        return 1
    if preview_only:
        return 0

    print("[7/7] export")
    n = grid.size
    cover_changed = int((st.cover != agg.observed).sum())
    total_px = sum(v for k, v in agg.class_counts.items() if k != 0)
    merged = derive.merged_winner_cells(agg)
    meta = build_meta(region, grid, bbox, src, provenance, osm_data, places, stats, agg, st, hyd, cover_changed,
                      total_px, merged, dem_dates, fill, fill_warnings, slopes, res, protected)
    out = REPO / "public" / "world-data" / f"{region.id}.json"
    size = export.write_world(out, meta, n, grid.cell_m, hyd.filled, {
        "cover": st.cover,
        "observedCover": agg.observed,
        "structure": st.structure,
        "structureLevel": st.structure_level,
        "protected": protected,
        "channel": hyd.channel,
        "roadSource": st.road_source,
        "builtPct": np.round(agg.built_frac * 100).astype(np.uint8),
        "worldCoverClass": agg.native,
        "worldCoverSharePct": np.round(agg.native_share * 100).astype(np.uint8),
        # Share of the cell's DEM pixels the producer void-filled from another source.
        "demFilledPct": np.round(100 * fill.filled / np.maximum(fill.pixels, 1)).astype(np.uint8),
    }, {"worldCoverLegend": derive.worldcover_legend()})
    (HERE / "out").mkdir(exist_ok=True)
    (HERE / "out" / f"{region.id}_preview.txt").write_text(text)
    write_index()
    print(f"  wrote {out.relative_to(REPO)} ({size / 1024:.1f} KiB)")
    return 0


def resolutions(src: dict) -> dict:
    """Ground size of the native pixels (metres, east-west x north-south) at the grid."""
    out = {}
    for kind, key in (("dem", "demPixelM"), ("worldcover", "worldCoverPixelM")):
        dx, dy = sources.pixel_spacing_m(src[kind][0][1])
        out[key] = [round(float(np.median(dx)), 2), round(dy, 2)]
    return out


def slope_stats(filled: np.ndarray, grid, dem_src: list) -> dict:
    """Horn (1981) slope on the exported 100 m elevation and on the native DEM pixels.

    The 100 m figure uses the elevation exactly as exported (depression-filled,
    whole centimetres) and the engine's edge handling, so the engine's mean slope
    on the file equals it. The native figure uses every DEM pixel whose centre is
    in the grid, with the real pixel spacing (about 30.9 m) and its neighbours
    from the cached window (which extends past the grid), before any filling.
    """
    exported = np.round(filled * 100) / 100
    grid100 = hydro.horn_slope(exported, grid.cell_m, grid.cell_m)
    native = []
    for _, path in dem_src:
        dx, dy = sources.pixel_spacing_m(path)
        with rasterio.open(path) as ds:
            elev = ds.read(1).astype(np.float64)
        native.append(hydro.horn_slope(elev, dx, dy)[sources.pixel_cells(path, grid).inside])
    return {
        "method": "Horn (1981) 3x3, rise over run; same method as src/simulation/engine/terrain.ts",
        "grid100m": derive.slope_summary(grid100),
        "native30m": derive.slope_summary(np.concatenate(native)),
    }


def dem_box_period(dem_dates: list[dict]) -> tuple[str, str] | None:
    """First and last TanDEM-X scene date over the box, across all DEM tiles."""
    periods = [r["boxAcquisitionPeriod"] for r in dem_dates if r.get("boxAcquisitionPeriod")]
    if not periods:
        return None
    return min(p["first"] for p in periods)[:10], max(p["last"] for p in periods)[:10]


# How a fill source differs from the TanDEM-X radar elevation, for the disclosure.
FILL_SOURCE_NOTES = {
    3: "an optical stereo elevation model built from imagery taken on other dates",
}


def fill_sources_text(fill) -> str:
    names = {v: DEM_FILL_MASK_VALUES.get(v, str(v)) for v in fill.by_source}
    if len(names) == 1:
        return next(iter(names.values()))
    return join_and([f"{names[v]} ({k} pixels)" for v, k in sorted(fill.by_source.items())])


def px(size: list[float]) -> str:
    """Pixel ground size as 'W x H m', east-west by north-south."""
    return f"{size[0]:.1f} x {size[1]:.1f} m"


def join_and(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def dem_version(provenance: dict, dem_dates: list[dict], fill=None) -> str:
    """Version text for the DEM: what the files let us verify, plus the producer's stated period."""
    parts = [COPERNICUS_DEM.version]
    period = dem_box_period(dem_dates)
    if period:
        text = (f"TanDEM-X scenes over this square acquired {period[0]} to {period[1]} "
                "(tile source-scene layer)")
        if fill is not None and fill.by_source:
            text += (f", except {int(fill.filled.sum())} pixels void-filled by the producer from "
                     f"{fill_sources_text(fill)} (tile Filling Mask)")
        parts.append(text)
    parts.append(f"producer-stated acquisition period {COPERNICUS_DEM_HANDBOOK['acquisitionPeriodStated']} "
                 "(Copernicus DEM Product Handbook v5.0)")
    dates = sorted({r["lastModified"][:10] for r in provenance["dem"] if r.get("lastModified")})
    if dates:
        parts.append(f"tile file last modified {', '.join(dates)} (HTTP Last-Modified, a copy date)")
    return "; ".join(parts)


def water_kept_disclosure(kept: int) -> str:
    rule = (f"A cell stays open water when WorldCover permanent water is its most common class or covers at least "
            f"{WATER_KEEP_MIN_SHARE:.0%} of its pixels, even if pooled shrubland and grassland pixels outnumber it, "
            "because open water is rare here and matters to the game")
    if not kept:
        return rule + "; no cell needed this rule."
    return (rule + f". {kept} {'cell is' if kept == 1 else 'cells are'} water only because of this rule; the "
            "pooled vote alone would have made " + ("it" if kept == 1 else "them") + " dry land.")


def shrub_disclosure(shrub_cells: int, merged_cells: int, breakdown: dict[tuple[int, str], int]) -> str:
    text = ("WorldCover shrubland (class 20) is mapped to game grassland because the game has no shrub class; it is "
            f"the most common WorldCover class in {shrub_cells} cells. Pixels are mapped to game covers before the "
            "majority vote, so pixels of classes that share a game cover (here shrubland and grassland) count together")
    if not merged_cells:
        return text + "; in no cell does this change which cover wins."
    by_game: dict[str, list[str]] = {}
    for (code, game), k in breakdown.items():
        by_game.setdefault(game, []).append(f"{WORLDCOVER_CLASSES[code].lower()} ({k})")
    parts = [f"come out as {game} although their most common WorldCover class is {join_or(names)}"
             for game, names in by_game.items()]
    return (text + f". In {merged_cells} cells this changes which cover wins: they " + "; others ".join(parts)
            + " (the observedCover layer; channel, road and settlement rules then change some of them).")


def join_or(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " or " + items[-1]


def channel_disclosure(region, hyd) -> str:
    text = (f"River channels: {hyd.channel_by_area} cells have at least {region.channel_min_cells} ha upstream on "
            "the DEM")
    if hyd.channel_by_water:
        k = hyd.channel_by_water
        what = "is a WorldCover water cell that drains" if k == 1 else "are WorldCover water cells that drain"
        text += f", and {k} more {what} into those channels"
    return (text + ". They are derived, not mapped rivers. In this semi-arid area they are likely seasonal "
            "streams, which the DEM and WorldCover cannot confirm; the game treats channels as permanent water "
            "for simplicity.")


def fill_disclosure(hyd, region) -> str:
    text = (f"{hyd.pit_cells} cells sat in small pits on the DEM and were raised by at most "
            f"{hyd.max_pit_fill_m:.2f} m so every cell drains to the map edge")
    if not hyd.nudged_cells:
        return text + "."
    return (text + f"; {hyd.nudged_cells} more {'cell was' if hyd.nudged_cells == 1 else 'cells were'} not in a pit"
            f" but {'was' if hyd.nudged_cells == 1 else 'were'} nudged up by at most {hyd.max_nudge_m:.2f} m to keep"
            f" a small downhill gradient ({region.fill_epsilon_m * 100:.0f} cm per cell) across filled and flat"
            " ground.")


def worldcover_accuracy_disclosure() -> str:
    v = WORLDCOVER_VALIDATION
    ua = v["africaUsersAccuracyPct"]
    return ("WorldCover is a classification and can be wrong, especially between shrubland, grassland and "
            f"cropland. ESA's validation report gives an overall accuracy of {v['overallAccuracyAfricaPct']}% for "
            f"Africa, and in Africa only {ua['Shrubland']}% of validation samples mapped as shrubland were judged "
            f"shrubland (grassland {ua['Grassland']}%, cropland {ua['Cropland']}%, built-up {ua['Built-up']}%). "
            "These are continental figures "
            "from the WorldCover v2.0 validation report, not an accuracy measured for this square.")


def dem_fill_disclosure(fill, n: int) -> str | None:
    """Producer void fills in the DEM, from its Filling Mask."""
    nfilled = int(fill.filled.sum())
    if not nfilled:
        return None
    patches = derive.fill_patches(fill, n)
    places = sorted({derive.compass(float(np.mean([r for r, _ in p])), float(np.mean([c for _, c in p])), n)
                     for p in patches})
    where = (f"{'one patch' if len(patches) == 1 else f'{len(patches)} patches'} in the "
             + join_and(places))
    notes = [f"{DEM_FILL_MASK_VALUES[v]} is {FILL_SOURCE_NOTES[v]}" for v in sorted(fill.by_source)
             if v in FILL_SOURCE_NOTES]
    share = 100 * fill.filled / np.maximum(fill.pixels, 1)
    ncells = int((fill.filled > 0).sum())
    return (f"{nfilled} of {int(fill.pixels.sum()):,} Copernicus DEM pixels in the square were void-filled by the "
            f"producer from {fill_sources_text(fill)} instead of TanDEM-X radar ({ncells} cells, in {where}; at "
            f"most {share.max():.0f}% of one cell). " + (". ".join(notes) + ", so heights there are not TanDEM-X "
            "measurements and do not share its dates. " if notes else "")
            + f"The producer's Filling Mask also flags {fill.edited} pixels as edited. The demFilledPct layer gives "
            "the filled share of every cell.")


def slope_disclosure(slopes: dict) -> str:
    g, nat = slopes["grid100m"], slopes["native30m"]
    return (f"Slopes come out gentler on the 100 m grid than in the 30 m source: the mean Horn slope is {g['mean']:.2f}"
            f" (rise over run) on the game grid against {nat['mean']:.2f} in the native DEM pixels, and "
            f"{g['pctAbove30']:.0f}% of game cells are steeper than 30% against {nat['pctAbove30']:.0f}% of native "
            "pixels.")


def housing_disclosure() -> str:
    v = WORLDCOVER_VALIDATION
    return ("Housing on urban cells and their density level come from the share of built-up pixels; they are a game "
            "representation, not a building census. WorldCover's built-up class is uncertain in this kind of "
            f"landscape: in Africa only {v['africaUsersAccuracyPct']['Built-up']}% (+/- "
            f"{v['africaUsersAccuracyConfidencePct']['Built-up']}) of validation samples mapped as built-up were "
            "built-up (user's accuracy, WorldCover v2.0 validation report, Table A2.1, page 27); the rest were mostly "
            "grassland, bare ground or trees, so some settled cells may have no buildings.")


def edge_ring_counts(protected: np.ndarray, structure: np.ndarray) -> dict:
    """Size of the protected edge ring and how many of its cells already hold a road or housing."""
    ring = protected > 0
    return {"protectedCells": int(ring.sum()), "protectedCellsWithStructure": int((ring & (structure > 0)).sum())}


def edge_ring_disclosure(counts: dict) -> str:
    k = counts["protectedCellsWithStructure"]
    kept = (f" Existing OpenStreetMap roads and housing in it are kept ({k} of its cells)." if k
            else " Nothing is built in it at the start.")
    return (f"The one-cell ring around the map edge ({counts['protectedCells']} cells) is closed to new building by "
            "a game rule so the map has a margin; it is not a mapped protected area or reserve (no protected-area "
            f"data was used).{kept}")


def water_body_disclosure(hyd) -> str | None:
    k = int(hyd.water_body.sum())
    if not k:
        return None
    return (f"{k} WorldCover water {'cell lies' if k == 1 else 'cells lie'} off the derived stream network (for "
            "example a pond or small dam; the data does not say which). "
            f"{'It starts' if k == 1 else 'They start'} as open water but {'is' if k == 1 else 'are'} not a river "
            "channel.")


def water_join_note(n: int) -> str:
    """Provenance clause for WorldCover water cells joined to the channel network by the drain-into rule."""
    if n <= 0:
        return ""
    return f" (plus {n} WorldCover water cell{'' if n == 1 else 's'} that drain{'s' if n == 1 else ''} into them)"


def build_meta(region, grid, bbox, src, source_files, osm_data, places, stats, agg, st, hyd, cover_changed,
               total_px, merged, dem_dates, fill, fill_warnings, slopes, res, protected) -> dict:
    wc_share = {
        f"{code} {WORLDCOVER_CLASSES.get(code, 'nodata')}": round(cnt / total_px, 4)
        for code, cnt in sorted(agg.class_counts.items()) if code != 0
    }
    game_share = {c: round(float((st.cover == COVER[c]).mean()), 4) for c in LAND_COVERS}
    attribution = [COPERNICUS_DEM.attribution, ESA_WORLDCOVER.attribution, OSM.attribution]
    w, s, e, n = bbox
    rc = st.road_counts
    period = dem_box_period(dem_dates)
    dem_years = f"{period[0][:4]} to {period[1][:4]}" if period else "2010 to 2015 (producer-stated period)"
    shrub_cells = int((agg.native == 20).sum())
    merged_cells = int(merged.sum())
    water_kept = int(agg.water_kept.sum())
    breakdown = derive.merged_winner_breakdown(agg)
    nfilled = int(fill.filled.sum())
    fill_note = (f", except {nfilled} pixels the producer void-filled from {fill_sources_text(fill)}"
                 if nfilled else "")
    dem_ppc = float(fill.pixels.mean())
    ring = edge_ring_counts(protected, st.structure)
    wc_ppc = float(agg.pixels.mean())
    provenance = (
        f"Real-data-derived, not a survey. Elevation: Copernicus DEM GLO-30 (TanDEM-X radar, acquired "
        f"{dem_years}{fill_note}), resampled from 1 arc-second pixels (about {px(res['demPixelM'])}) to "
        f"100 m cells (area average) in {grid_crs(grid)}. Land cover: ESA WorldCover 2021 v200, every native pixel "
        f"(about {px(res['worldCoverPixelM'])}, nominally 10 m) mapped to a game cover and counted in the 100 m "
        "cell that holds its centre, then a majority vote per cell; cells with at least "
        f"{region.urban_min_built_frac:.0%} "
        f"built-up pixels count as settled, and cells where open water is the most common class or at least "
        f"{WATER_KEEP_MIN_SHARE:.0%} of pixels stay water. Roads: OpenStreetMap {'/'.join(region.road_classes)} roads "
        f"({rc['osmMain']} cells), plus {rc['osmMinorLink']} cells of OSM minor roads and {rc['synthetic']} "
        f"cells added by the pipeline to link hamlets to them. River channels come from flow accumulation on the DEM"
        f"{water_join_note(hyd.channel_by_water)}, not from a river map. "
        "The protected ring along the map edge is a game rule, not a mapped reserve. "
        f"Area: {fmt_lon(w)} to {fmt_lon(e)}, {fmt_lat(n)} to {fmt_lat(s)} (WGS84). "
        "WorldCover is a classification of 2021 satellite imagery and can be wrong, especially between "
        "shrubland, grassland and cropland; it does not predict anything. "
        "Soil health, soil moisture and yields in the game are model values, not satellite measurements."
    )
    return {
        "id": region.id,
        "name": region.name,
        "kind": "real-data-derived",
        "description": region.description,
        "provenance": provenance,
        "bbox": [round(w, 6), round(s, 6), round(e, 6), round(n, 6)],
        "crs": grid_crs(grid),
        "sources": [
            {"name": COPERNICUS_DEM.name, "version": dem_version(source_files, dem_dates, fill),
             "license": COPERNICUS_DEM.license, "url": COPERNICUS_DEM.url,
             "acquired": f"{period[0]}/{period[1]}" if period else "2010-12/2015-01"},
            {"name": ESA_WORLDCOVER.name, "version": ESA_WORLDCOVER.version, "license": ESA_WORLDCOVER.license,
             "url": ESA_WORLDCOVER.url, "acquired": "2021-01-01/2021-12-31"},
            {"name": OSM.name, "version": f"Overpass snapshot {osm_data['timestamp']}", "license": OSM.license,
             "url": OSM.url, "acquired": osm_data["timestamp"]},
        ],
        "attribution": attribution,
        "disclosures": [
            f"Each 100 m game cell averages about {dem_ppc:.0f} Copernicus DEM pixels (about {px(res['demPixelM'])}, "
            f"1 arc-second) and counts about {wc_ppc:.0f} native WorldCover pixels (about "
            f"{px(res['worldCoverPixelM'])}, nominally 10 m). Small features such as single homesteads, narrow "
            "gullies and field edges are smoothed away.",
            slope_disclosure(slopes),
            "ESA WorldCover 2021 is a satellite-based classification of conditions observed during 2021. "
            "It does not predict what happens after the player changes the land.",
            worldcover_accuracy_disclosure(),
            "Copernicus DEM is a surface model: tree canopy and buildings can raise the measured height slightly.",
            "Heights are relative to the EGM2008 geoid, as published.",
            f"The elevation and the land cover come from different years: the radar scenes behind the DEM over "
            f"this square were taken {dem_years}"
            + (" (except the producer's void fills described next)" if nfilled else "")
            + ", the land cover in 2021. Terrain changes in between (new terraces, "
            "dams, quarries, road cuts) are not in the elevation.",
            *([d] if (d := dem_fill_disclosure(fill, grid.size)) else []),
            fill_disclosure(hyd, region),
            channel_disclosure(region, hyd),
            *([d] if (d := water_body_disclosure(hyd)) else []),
            f"{cover_changed} of {grid.size * grid.size} cells start with a game cover different from the mapped "
            "WorldCover majority: channel cells set to water, road cells set to urban, and cells with enough "
            "built-up pixels set to urban. The observedCover layer keeps the mapped majority before these changes, "
            "and the worldCoverClass layer keeps the most common WorldCover class itself.",
            shrub_disclosure(shrub_cells, merged_cells, breakdown),
            water_kept_disclosure(water_kept),
            housing_disclosure(),
            edge_ring_disclosure(ring),
            f"Road cells: {rc['osmMain']} follow OpenStreetMap main roads, {rc['osmMinorLink']} follow OSM minor roads "
            f"used to link hamlets to them, and {rc['synthetic']} were added where OSM has no road (game "
            f"simplification). {rc['streetCellsKeptAsHousing']} densely built cells crossed by a main road stay as "
            "housing. A 100 m road cell is far wider than the real road. Roads stop at channel cells; the game "
            "assumes a crossing there.",
            "Soil health is not measured from satellites. The game estimates starting soil condition with its "
            "own model rules, so treat it as a teaching value.",
        ],
        "grid": {
            "orientation": "row 0 is the northern edge, column 0 the western edge; index = row * width + column",
            "originUtm": [grid.west, grid.north],
            "cellSizeM": grid.cell_m,
            "verticalDatum": "EGM2008",
        },
        "places": [
            {"name": p["name"], "place": p["place"], "row": p["row"], "col": p["col"], "osmNodeId": p["id"],
             **({"osmNodeIds": p["ids"], "osmPlaceTypes": p["types"]} if len(p.get("ids", [])) > 1 else {})}
            for p in places if p.get("name")
        ],
        "stats": {**stats, "worldCoverShare": wc_share, "gameCoverShare": game_share,
                  "coverCellsAdjusted": cover_changed, "urbanCellsByThreshold": st.urban_by_threshold,
                  "roadCellsBySource": rc, **ring,
                  "channelCellsByArea": hyd.channel_by_area, "channelCellsByWater": hyd.channel_by_water,
                  "waterBodyCells": int(hyd.water_body.sum()),
                  "filledCells": hyd.filled_cells, "filledPitCells": hyd.pit_cells,
                  "filledPitMaxRaiseM": round(hyd.max_pit_fill_m, 2), "gradientNudgedCells": hyd.nudged_cells,
                  "gradientNudgeMaxM": round(hyd.max_nudge_m, 2),
                  "worldCoverShrubPluralityCells": shrub_cells, "worldCoverMergedWinnerCells": merged_cells,
                  "worldCoverWaterKeptCells": water_kept,
                  "pixelSizeM": res,
                  "worldCoverPixelsPerCell": {"min": int(agg.pixels.min()), "mean": round(wc_ppc, 1),
                                              "max": int(agg.pixels.max())},
                  "demPixelsInGrid": int(fill.pixels.sum()), "demPixelsPerCellMean": round(dem_ppc, 1),
                  "demVoidFilledPixels": nfilled,
                  "demVoidFilledPixelsBySource": {DEM_FILL_MASK_VALUES.get(v, str(v)): k
                                                  for v, k in sorted(fill.by_source.items())},
                  "demVoidFilledCells": int((fill.filled > 0).sum()),
                  "demVoidFilledMaxCellPct": round(float((100 * fill.filled / np.maximum(fill.pixels, 1)).max()), 1),
                  "demEditedPixels": fill.edited,
                  "slope": slopes},
        "generated": {
            "pipeline": f"scripts/geodata/build_world.py v{PIPELINE_VERSION}",
            # UTC, so it compares directly with osmTimestamp. The only field that
            # differs between two runs on the same cache and snapshot.
            "date": dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "demTiles": [u for u, _ in src["dem"]],
            "worldCoverTiles": [u for u, _ in src["worldcover"]],
            # The DEM tile's Filling Mask and Editing Mask (AUXFILES), counted per
            # cell by pixel centre: which pixels the producer edited or void-filled.
            "demQualityMasks": {
                "valueTables": DEM_MASK_TABLES,
                "fillMaskTiles": [u for u, _ in src["demFillMask"]],
                "editMaskTiles": [u for u, _ in src["demEditMask"]],
                "pixelsInGrid": int(fill.pixels.sum()),
                "fillMaskCounts": {f"{v} {DEM_FILL_MASK_VALUES.get(v, '?')}": k for v, k in fill.mask_counts.items()},
                "editMaskCounts": {f"{v} {DEM_EDIT_MASK_VALUES.get(v, '?')}": k
                                   for v, k in sorted(fill.edit_counts.items())},
                "voidFilledCells": fill.cells,
                "warnings": fill_warnings,
            },
            # HTTP Last-Modified/ETag and COG tags of each source file, the bytes a
            # fresh window read fetches, and SHA-256 of the cached windows used.
            "sourceFiles": source_files,
            # When the elevation was measured: the tile's own XML metadata and
            # source-scene layer, plus the producer's handbook statement.
            "demAcquisition": {"tiles": dem_dates, "productHandbook": COPERNICUS_DEM_HANDBOOK},
            "osmTimestamp": osm_data["timestamp"],
            "worldCoverValidation": WORLDCOVER_VALIDATION,
            "mapping": {f"{k} {WORLDCOVER_CLASSES[k]}": v for k, v in WORLDCOVER_TO_GAME.items()},
            "parameters": {
                "urbanMinBuiltFrac": region.urban_min_built_frac,
                "channelMinCells": region.channel_min_cells,
                "roadClasses": list(region.road_classes),
                "minorRoadClasses": list(region.minor_road_classes),
                "housingOverRoadBuiltFrac": region.housing_over_road_built_frac,
                "connectorMinCluster": region.connector_min_cluster,
                "fillEpsilonM": region.fill_epsilon_m,
            },
        },
    }


def fmt_lat(v: float) -> str:
    return f"{abs(v):.4f}\u00b0 {'S' if v < 0 else 'N'}"


def fmt_lon(v: float) -> str:
    return f"{abs(v):.4f}\u00b0 {'W' if v < 0 else 'E'}"


def grid_crs(grid) -> str:
    return f"EPSG:{grid.epsg}"


META_KEYS = ("id", "name", "kind", "description", "provenance", "bbox", "crs", "sources")


def write_index() -> None:
    """Write public/world-data/index.json and the TypeScript registry the game reads.

    src/data/realWorlds.generated.ts carries each world's WorldMeta so the game can
    list worlds without downloading them; a unit test checks it matches the files.
    """
    folder = REPO / "public" / "world-data"
    worlds = []
    for f in sorted(folder.glob("*.json")):
        if f.name == "index.json":
            continue
        meta = json.loads(f.read_text())["meta"]
        worlds.append({"file": f.name, "meta": {k: meta[k] for k in META_KEYS if k in meta}})
    index = {"worlds": [{"id": w["meta"]["id"], "name": w["meta"]["name"], "kind": w["meta"]["kind"],
                         "file": w["file"]} for w in worlds]}
    (folder / "index.json").write_text(json.dumps(index, indent=2) + "\n")
    body = json.dumps(worlds, indent=2, ensure_ascii=False)
    ts = (
        "// GENERATED by scripts/geodata/build_world.py. Do not edit by hand; rerun the pipeline.\n"
        "// Metadata of every real-data world exported to public/world-data/.\n"
        "import type { WorldMeta } from '../simulation/types'\n\n"
        "export interface RealWorldRecord {\n  /** File name under public/world-data/. */\n  file: string\n"
        "  meta: WorldMeta\n}\n\n"
        f"export const REAL_WORLDS: readonly RealWorldRecord[] = {body}\n"
    )
    (REPO / "src" / "data" / "realWorlds.generated.ts").write_text(ts, encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--region", default="kaani-machakos", choices=sorted(REGIONS))
    ap.add_argument("--offline", action="store_true", help="use cached sources only")
    ap.add_argument("--preview-only", action="store_true", help="validate and print, do not export")
    ap.add_argument("--refresh-osm", action="store_true", help="re-query Overpass instead of the snapshot")
    ap.add_argument("--lat", type=float, help="explore another centre (implies --preview-only)")
    ap.add_argument("--lon", type=float)
    a = ap.parse_args()
    return run(a.region, a.offline, a.preview_only, a.lat, a.lon, a.refresh_osm)


if __name__ == "__main__":
    sys.exit(main())
