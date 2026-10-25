"""Source raster access: windowed reads over HTTP from the public COG buckets,
cached to local GeoTIFFs so reruns are reproducible and work offline.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import urllib.request
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.warp import reproject
from rasterio.windows import from_bounds

from .config import USER_AGENT, Region, dem_aux_url, dem_tile_url, worldcover_tile_url


@dataclass(frozen=True)
class TargetGrid:
    """A square grid in the local UTM zone. Row 0 is the northern edge."""

    epsg: int
    west: float
    north: float
    size: int
    cell_m: float

    @property
    def east(self) -> float:
        return self.west + self.size * self.cell_m

    @property
    def south(self) -> float:
        return self.north - self.size * self.cell_m

    def transform(self, factor: int = 1):
        return from_origin(self.west, self.north, self.cell_m / factor, self.cell_m / factor)

    def lonlat_bbox(self) -> tuple[float, float, float, float]:
        """Envelope of the grid in WGS84 as [west, south, east, north]."""
        t = Transformer.from_crs(self.epsg, 4326, always_xy=True)
        xs, ys = [], []
        for k in range(11):
            f = k / 10
            for x, y in (
                (self.west + f * (self.east - self.west), self.north),
                (self.west + f * (self.east - self.west), self.south),
                (self.west, self.south + f * (self.north - self.south)),
                (self.east, self.south + f * (self.north - self.south)),
            ):
                lon, lat = t.transform(x, y)
                xs.append(lon)
                ys.append(lat)
        return (min(xs), min(ys), max(xs), max(ys))


def target_grid(region: Region) -> TargetGrid:
    t = Transformer.from_crs(4326, region.utm_epsg, always_xy=True)
    cx, cy = t.transform(region.center_lon, region.center_lat)
    half = region.grid * region.cell_m / 2
    # Snap the north-west corner to the cell size so reruns land on the same grid.
    west = math.floor((cx - half) / region.cell_m) * region.cell_m
    north = math.ceil((cy + half) / region.cell_m) * region.cell_m
    return TargetGrid(region.utm_epsg, west, north, region.grid, region.cell_m)


def _tiles(bbox: tuple[float, float, float, float], step: int) -> list[tuple[int, int]]:
    w, s, e, n = bbox
    lats = range(math.floor(s / step) * step, math.floor(n / step) * step + 1, step)
    lons = range(math.floor(w / step) * step, math.floor(e / step) * step + 1, step)
    return [(la, lo) for la in lats for lo in lons]


# COG metadata tags worth keeping as provenance (WorldCover carries these; the
# Copernicus DEM COGs on AWS carry only AREA_OR_POINT).
PROVENANCE_TAGS = ("product_version", "algorithm_version", "time_start", "time_end", "creation_time",
                   "product_tile", "AREA_OR_POINT")


def _cog_env() -> rasterio.Env:
    return rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif")


def _window(src, bbox: tuple[float, float, float, float], url: str) -> rasterio.windows.Window:
    win = from_bounds(*bbox, transform=src.transform)
    win = win.round_offsets().round_lengths()
    col_off = max(0, int(win.col_off))
    row_off = max(0, int(win.row_off))
    width = min(src.width - col_off, int(win.width))
    height = min(src.height - row_off, int(win.height))
    if width <= 0 or height <= 0:
        raise RuntimeError(f"bbox {bbox} does not intersect {url}")
    return rasterio.windows.Window(col_off, row_off, width, height)


def _bytes_for_window(src, win: rasterio.windows.Window) -> tuple[int, int]:
    """Compressed bytes of the internal COG tiles a window read has to fetch.

    GDAL reads whole internal tiles (1024 x 1024 here), so this is the real
    download size of a window read, not the size of the window itself.
    """
    by, bx = src.block_shapes[0]
    r0, r1 = int(win.row_off) // by, (int(win.row_off) + int(win.height) - 1) // by
    c0, c1 = int(win.col_off) // bx, (int(win.col_off) + int(win.width) - 1) // bx
    total = sum(src.block_size(1, r, c) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1))
    return total, (r1 - r0 + 1) * (c1 - c0 + 1)


def _http_headers(url: str) -> dict:
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        h = resp.headers
    last = h.get("Last-Modified")
    return {
        "lastModified": parsedate_to_datetime(last).strftime("%Y-%m-%dT%H:%M:%SZ") if last else None,
        "etag": (h.get("ETag") or "").strip('"') or None,
        "contentLength": int(h["Content-Length"]) if h.get("Content-Length") else None,
    }


def _remote_record(url: str, bbox: tuple[float, float, float, float]) -> dict:
    """What the server says about the source file, plus the bytes a window read fetches."""
    with _cog_env(), rasterio.open(url) as src:
        win = _window(src, bbox, url)
        nbytes, ntiles = _bytes_for_window(src, win)
        tags = {k: v for k, v in src.tags().items() if k in PROVENANCE_TAGS}
    return {
        "url": url,
        **_http_headers(url),
        "cogTags": dict(sorted(tags.items())),
        "internalTilesRead": ntiles,
        "bytesFetched": nbytes,
        "checkedOn": dt.date.today().isoformat(),
    }


def sidecar_path(out: Path) -> Path:
    return out.with_suffix(".provenance.json")


def _fetch_window(url: str, bbox: tuple[float, float, float, float], out: Path) -> Path:
    """Read only the bbox window of a remote COG and save it as a local GeoTIFF."""
    record = _remote_record(url, bbox)
    print(f"  reading {record['internalTilesRead']} internal tile(s), {record['bytesFetched'] / 1e6:.2f} MB")
    with _cog_env(), rasterio.open(url) as src:
        win = _window(src, bbox, url)
        data = src.read(1, window=win)
        profile = src.profile.copy()
        profile.update(
            driver="GTiff",
            width=int(win.width),
            height=int(win.height),
            transform=src.window_transform(win),
            tiled=False,
            compress="deflate",
        )
        for k in ("blockxsize", "blockysize", "interleave"):
            profile.pop(k, None)
    out.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(out, "w", **profile) as dst:
        dst.write(data, 1)
    sidecar_path(out).write_text(json.dumps(record, indent=2) + "\n")
    return out


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def describe_cached(url: str, path: Path, bbox: tuple[float, float, float, float], offline: bool) -> dict:
    """Provenance record for one cached source window.

    HTTP Last-Modified / ETag and the COG tags are captured when the window is
    fetched (sidecar JSON next to the cache file). For a cache made before
    sidecars existed, they are looked up now if the network is allowed. The
    SHA-256 of the cached GeoTIFF and of its decoded pixel array are always
    computed from the bytes the pipeline actually reads.
    """
    side = sidecar_path(path)
    if side.exists():
        record = json.loads(side.read_text())
    elif not offline:
        record = _remote_record(url, bbox)
        side.write_text(json.dumps(record, indent=2) + "\n")
    else:
        record = {"url": url, "note": "HTTP headers not recorded (cache predates provenance sidecars, run online once)"}
    with rasterio.open(path) as src:
        arr = src.read(1)
        shape = [src.height, src.width]
        dtype = str(arr.dtype)
    return {
        **record,
        "cachedWindowFile": path.name,
        "cachedWindowBytes": path.stat().st_size,
        "cachedWindowSha256": _sha256_file(path),
        "windowPixels": shape,
        "windowDtype": dtype,
        # Hash of the little-endian pixel values: stable across GeoTIFF encoders.
        "windowDataSha256": hashlib.sha256(arr.astype(arr.dtype.newbyteorder("<")).tobytes()).hexdigest(),
    }


def source_bbox(grid: TargetGrid) -> tuple[float, float, float, float]:
    w, s, e, n = grid.lonlat_bbox()
    margin = 0.005  # ~550 m, so resampling at the box edge has source pixels
    return (w - margin, s - margin, e + margin, n + margin)


# (cache prefix, tile step in degrees, URL builder). The DEM's Filling Mask (FLM)
# and Editing Mask (EDM) sit beside the DEM COG in its AUXFILES folder, on the
# same 1 arc-second grid; they say which DEM pixels the producer edited or
# void-filled from other elevation sources.
SOURCE_KINDS = (
    ("dem", 1, dem_tile_url),
    ("demFillMask", 1, lambda la, lo: dem_aux_url(la, lo, "FLM")),
    ("demEditMask", 1, lambda la, lo: dem_aux_url(la, lo, "EDM")),
    ("worldcover", 3, worldcover_tile_url),
)


def fetch_sources(grid: TargetGrid, cache: Path, offline: bool) -> dict[str, list[tuple[str, Path]]]:
    """Ensure cached source windows exist for every tile the grid touches."""
    bbox = source_bbox(grid)
    result: dict[str, list[tuple[str, Path]]] = {kind: [] for kind, _, _ in SOURCE_KINDS}
    for kind, step, urlfn in SOURCE_KINDS:
        for la, lo in _tiles(bbox, step):
            url = urlfn(la, lo)
            path = cache / f"{kind}_{la}_{lo}.tif"
            if not path.exists():
                if offline:
                    raise FileNotFoundError(f"{path} missing and --offline set")
                print(f"  fetching window of {url}")
                _fetch_window(url, bbox, path)
            else:
                print(f"  using cached {path.name}")
            result[kind].append((url, path))
    return result


def warp_to_grid(paths: list[Path], grid: TargetGrid, factor: int, resampling: Resampling,
                 dtype: str, nodata: float) -> np.ndarray:
    """Reproject one or more cached tiles into the target grid (mosaicking by first-valid)."""
    shape = (grid.size * factor, grid.size * factor)
    out = np.full(shape, nodata, dtype=dtype)
    for p in paths:
        with rasterio.open(p) as src:
            tmp = np.full(shape, nodata, dtype=dtype)
            reproject(
                source=rasterio.band(src, 1),
                destination=tmp,
                src_nodata=src.nodata,
                dst_transform=grid.transform(factor),
                dst_crs=f"EPSG:{grid.epsg}",
                dst_nodata=nodata,
                resampling=resampling,
            )
            fill = (out == nodata) & (tmp != nodata)
            out[fill] = tmp[fill]
    return out


@dataclass(frozen=True)
class PixelCells:
    """Every source pixel of a cached geographic window, assigned to the grid cell
    that contains its centre (after projecting the centre to the grid's UTM CRS)."""

    values: np.ndarray  # (k,) pixel values of the pixels whose centre is inside the grid
    cell: np.ndarray  # (k,) flat cell index row * size + col of each of those pixels
    inside: np.ndarray  # (h, w) bool: pixel centre falls inside the grid


def pixel_cells(path: Path, grid: TargetGrid) -> PixelCells:
    """Assign each native pixel of a cached window to the 100 m cell holding its centre.

    Unlike warping onto a regular sub-grid, this counts every native pixel exactly
    once, so per-cell shares use all the source pixels (for WorldCover about 117 per
    cell here, since a 1/12000 degree pixel is about 9.3 x 9.2 m at this latitude).
    """
    with rasterio.open(path) as src:
        values = src.read(1)
        tr = src.transform
        crs = src.crs
    h, w = values.shape
    cols, rows = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
    xs, ys = tr @ (cols, rows)
    t = Transformer.from_crs(crs, grid.epsg, always_xy=True)
    east, north = t.transform(xs, ys)
    col = np.floor((east - grid.west) / grid.cell_m).astype(np.int64)
    row = np.floor((grid.north - north) / grid.cell_m).astype(np.int64)
    inside = (row >= 0) & (row < grid.size) & (col >= 0) & (col < grid.size)
    return PixelCells(values=values[inside], cell=(row * grid.size + col)[inside], inside=inside)


def cell_value_counts(parts: list[PixelCells], size: int, nvalues: int = 256) -> np.ndarray:
    """(size, size, nvalues) count of native pixels of each value per cell, over all tiles."""
    counts = np.zeros(size * size * nvalues, dtype=np.int64)
    for p in parts:
        np.add.at(counts, p.cell * nvalues + p.values.astype(np.int64), 1)
    return counts.reshape(size, size, nvalues)


def pixel_spacing_m(path: Path) -> tuple[np.ndarray, float]:
    """Ground size of the pixels of a cached geographic window: east-west spacing per
    row (it shrinks with latitude) and the north-south spacing, in metres (WGS84 ellipsoid)."""
    from pyproj import Geod

    geod = Geod(ellps="WGS84")
    with rasterio.open(path) as src:
        tr = src.transform
        h = src.height
    lon0 = tr.c + tr.a * 0.5
    lats = tr.f + tr.e * (np.arange(h) + 0.5)
    _, _, dx = geod.inv(np.full(h, lon0), lats, np.full(h, lon0 + tr.a), lats)
    mid = float(lats[h // 2])
    _, _, dy = geod.inv(lon0, mid - abs(tr.e) / 2, lon0, mid + abs(tr.e) / 2)
    return np.asarray(dx, dtype=np.float64), float(dy)
