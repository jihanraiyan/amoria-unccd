"""OpenStreetMap roads and place names via the Overpass API (cached JSON)."""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from itertools import pairwise
from pathlib import Path

import numpy as np
from pyproj import Transformer

from .config import OVERPASS_URL, USER_AGENT
from .sources import TargetGrid


def check_reply(reply: dict) -> dict:
    """Reject partial Overpass results.

    Overpass answers HTTP 200 even when a query times out or runs out of memory;
    it then returns whatever elements it had plus a 'remark' describing the
    runtime error. Such a reply must never be snapshotted as the OSM extract.
    """
    remark = reply.get("remark")
    if remark and any(word in str(remark).lower() for word in ("error", "runtime")):
        raise RuntimeError(f"Overpass returned an incomplete result: {remark}")
    return reply


def _overpass(query: str, attempts: int = 5) -> dict:
    """POST a query, backing off on the public server's rate limit (429) or overload (504)."""
    body = urllib.parse.urlencode({"data": query}).encode()
    for attempt in range(attempts):
        req = urllib.request.Request(OVERPASS_URL, data=body, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                return check_reply(json.loads(resp.read().decode("utf-8")))
        except urllib.error.HTTPError as err:
            if err.code not in (429, 502, 503, 504) or attempt == attempts - 1:
                raise RuntimeError(f"Overpass request failed with HTTP {err.code}") from err
            wait = 15 * (attempt + 1)
            print(f"  Overpass busy (HTTP {err.code}), retrying in {wait} s")
            time.sleep(wait)
    raise RuntimeError("Overpass request failed")


def fetch_osm(grid: TargetGrid, path: Path, offline: bool, refresh: bool = False) -> dict:
    """Return {'roads': [...], 'places': [...], 'timestamp': str} for the grid bbox.

    OSM changes daily, so the extract is kept as a snapshot file (committed with
    the repo) and reused unless refresh is requested.
    """
    if path.exists() and not refresh:
        print(f"  using OSM snapshot {path.name}")
        return json.loads(path.read_text())
    if offline:
        raise FileNotFoundError(f"{path} missing and --offline set")
    w, s, e, n = grid.lonlat_bbox()
    bb = f"{s:.5f},{w:.5f},{n:.5f},{e:.5f}"
    print("  querying Overpass for highways and places")
    roads = _overpass(f'[out:json][timeout:120];way["highway"]({bb});out geom tags;')
    places = _overpass(f'[out:json][timeout:60];node["place"]({bb});out;')
    data = {
        "timestamp": roads.get("osm3s", {}).get("timestamp_osm_base", "unknown"),
        "query_bbox_s_w_n_e": bb,
        "roads": [
            {
                "id": el["id"],
                "highway": el.get("tags", {}).get("highway"),
                "name": el.get("tags", {}).get("name"),
                "geometry": [[p["lon"], p["lat"]] for p in el.get("geometry", [])],
            }
            for el in roads.get("elements", [])
            if el.get("type") == "way"
        ],
        "places": [
            {
                "id": el["id"],
                "place": el.get("tags", {}).get("place"),
                "name": el.get("tags", {}).get("name"),
                "lon": el["lon"],
                "lat": el["lat"],
            }
            for el in places.get("elements", [])
        ],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    return data


def rasterize_roads(osm: dict, grid: TargetGrid, classes: tuple[str, ...]) -> np.ndarray:
    """Mark grid cells along OSM ways of the given highway classes.

    Vertices are converted to fractional cell coordinates in UTM metres and
    joined with 8-connected lines (diagonal steps allowed), so a diagonal road
    is one cell wide instead of a two-cell staircase.
    """
    t = Transformer.from_crs(4326, grid.epsg, always_xy=True)
    mask = np.zeros((grid.size, grid.size), dtype=np.uint8)
    for way in osm["roads"]:
        if way["highway"] not in classes or len(way["geometry"]) < 2:
            continue
        cells = []
        for lon, lat in way["geometry"]:
            x, y = t.transform(lon, lat)
            cells.append((int((grid.north - y) // grid.cell_m), int((x - grid.west) // grid.cell_m)))
        for (r0, c0), (r1, c1) in pairwise(cells):
            steps = max(abs(r1 - r0), abs(c1 - c0), 1)
            for k in range(steps + 1):
                r = round(r0 + (r1 - r0) * k / steps)
                c = round(c0 + (c1 - c0) * k / steps)
                if 0 <= r < grid.size and 0 <= c < grid.size:
                    mask[r, c] = 1
    return mask


# Which OSM place node represents a name when several nodes share it. Settlement
# types come before area labels such as locality (an administrative or
# traditional area name, often placed near the village of the same name).
PLACE_RANK = ("city", "town", "village", "hamlet", "suburb", "neighbourhood", "isolated_dwelling", "farm",
              "locality")
# Nodes with the same name at most this many cells apart (Chebyshev) are one place.
PLACE_MERGE_CELLS = 3


def _rank(place: str | None) -> int:
    return PLACE_RANK.index(place) if place in PLACE_RANK else len(PLACE_RANK)


def merge_places(places: list[dict], radius: int = PLACE_MERGE_CELLS) -> list[dict]:
    """Collapse nodes that share a name and sit within radius cells into one place.

    The kept entry is the highest-ranked node (village over locality, for
    example). Every merged node id stays in 'ids' and every OSM place type in
    'types', so attribution and the record of what OSM says are not lost.
    """
    groups: list[list[dict]] = []
    for p in sorted(places, key=lambda q: (_rank(q.get("place")), q["id"])):
        for g in groups:
            head = g[0]
            if (p.get("name") and p.get("name") == head.get("name")
                    and max(abs(p["row"] - head["row"]), abs(p["col"] - head["col"])) <= radius):
                g.append(p)
                break
        else:
            groups.append([p])
    merged = []
    for g in groups:
        head = g[0]
        merged.append({**head, "ids": sorted(q["id"] for q in g),
                       "types": [q.get("place") for q in g]})
    return sorted(merged, key=lambda q: (q["row"], q["col"], q["id"]))


def places_in_grid(osm: dict, grid: TargetGrid) -> list[dict]:
    t = Transformer.from_crs(4326, grid.epsg, always_xy=True)
    out = []
    for p in osm["places"]:
        x, y = t.transform(p["lon"], p["lat"])
        col = int((x - grid.west) // grid.cell_m)
        row = int((grid.north - y) // grid.cell_m)
        if 0 <= row < grid.size and 0 <= col < grid.size:
            out.append({**p, "row": row, "col": col})
    return merge_places(out)
