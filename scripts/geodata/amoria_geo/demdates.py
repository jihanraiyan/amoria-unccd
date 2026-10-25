"""When the Copernicus DEM elevation over the box was acquired.

The DEM GeoTIFF carries no date. Each tile folder on the AWS bucket also holds
the tile's ISO 19115 XML metadata (with the TanDEM-X temporal coverage of the
tile) and a source-scene layer (SRC kml) listing every TanDEM-X scene used, with
its acquisition date and footprint. Both are small text files; they are cached
next to the raster windows and parsed here.
"""
from __future__ import annotations

import re
import urllib.request
import xml.etree.ElementTree as ET
from itertools import pairwise
from pathlib import Path

from .config import USER_AGENT

_TSX_START = "{*}tsxx_startTime"
_TSX_STOP = "{*}tsxx_stopTime"


def metadata_urls(tile_url: str) -> dict[str, str]:
    """XML metadata and SRC kml URLs that sit beside a GLO-30 COG on AWS."""
    folder, file = tile_url.rsplit("/", 1)
    # Copernicus_DSM_COG_10_S02_00_E037_00_DEM.tif -> Copernicus_DSM_10_S02_00_E037_00
    stem = file.removesuffix("_DEM.tif").replace("_COG_", "_")
    return {"xml": f"{folder}/{stem}.xml", "src": f"{folder}/PREVIEW/{stem}_SRC.kml"}


def _fetch(url: str, path: Path, offline: bool) -> Path | None:
    if path.exists():
        return path
    if offline:
        return None
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return path


def tile_temporal_coverage(xml_text: str) -> dict | None:
    """TanDEM-X start and stop time recorded in the tile's XML metadata."""
    root = ET.fromstring(xml_text)
    start = root.find(f".//{_TSX_START}")
    stop = root.find(f".//{_TSX_STOP}")
    if start is None or stop is None or not start.text or not stop.text:
        return None
    return {"start": start.text.strip(), "stop": stop.text.strip()}


def _inside(x: float, y: float, ring: list[tuple[float, float]]) -> bool:
    """Ray-casting point-in-polygon test."""
    hit = False
    for (x1, y1), (x2, y2) in pairwise(ring):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            hit = not hit
    return hit


def scenes(kml_text: str) -> list[dict]:
    """Every TanDEM-X scene in the SRC layer: id, acquisition set, date, footprint ring."""
    out = []
    for block in re.findall(r"<Placemark>(.*?)</Placemark>", kml_text, re.S):
        desc = re.search(r"<description>(.*?)</description>", block, re.S)
        coords = re.search(r"<coordinates>(.*?)</coordinates>", block, re.S)
        name = re.search(r"<name>(.*?)</name>", block, re.S)
        if not (desc and coords and name):
            continue  # the tile outline placemark has no acquisition
        lines = [ln.strip() for ln in desc.group(1).strip().splitlines() if ln.strip()]
        if len(lines) < 2:
            continue
        ring = [tuple(float(v) for v in c.split(",")[:2]) for c in coords.group(1).split()]
        out.append({"scene": name.group(1).strip(), "set": lines[0], "date": lines[1], "ring": ring})
    return out


def scenes_over_box(all_scenes: list[dict], bbox: tuple[float, float, float, float], samples: int = 11) -> list[dict]:
    """Scenes whose footprint contains any point of a samples x samples lattice over the box."""
    w, s, e, n = bbox
    pts = [(w + (e - w) * i / (samples - 1), s + (n - s) * j / (samples - 1))
           for i in range(samples) for j in range(samples)]
    return [sc for sc in all_scenes if any(_inside(x, y, sc["ring"]) for x, y in pts)]


def dem_acquisition(tile_url: str, cache_dir: Path, bbox: tuple[float, float, float, float],
                    offline: bool) -> dict:
    """Acquisition record for one DEM tile, read from its own metadata files."""
    urls = metadata_urls(tile_url)
    stem = tile_url.rsplit("/", 1)[1].removesuffix(".tif")
    xml_path = _fetch(urls["xml"], cache_dir / f"{stem}_meta.xml", offline)
    kml_path = _fetch(urls["src"], cache_dir / f"{stem}_SRC.kml", offline)
    record: dict = {"metadataXmlUrl": urls["xml"], "sourceSceneLayerUrl": urls["src"]}
    if xml_path is None or kml_path is None:
        record["note"] = "tile metadata not cached and --offline set; run online once"
        return record
    record["tileTemporalCoverage"] = tile_temporal_coverage(xml_path.read_text(encoding="utf-8"))
    over = scenes_over_box(scenes(kml_path.read_text(encoding="utf-8")), bbox)
    dates = sorted(sc["date"] for sc in over)
    record["scenesOverBox"] = [{"scene": sc["scene"], "set": sc["set"], "date": sc["date"]}
                               for sc in sorted(over, key=lambda sc: (sc["date"], sc["scene"]))]
    record["boxAcquisitionPeriod"] = {"first": dates[0], "last": dates[-1]} if dates else None
    return record
