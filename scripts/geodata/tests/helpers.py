"""Shared constants and fixture builders for the geodata pipeline tests."""
from __future__ import annotations

from pathlib import Path

import numpy as np

from amoria_geo import derive, hydro, validate
from amoria_geo.config import COVER, STRUCT, Region
from amoria_geo.sources import TargetGrid

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent.parent
WORLD = REPO / "public" / "world-data" / "kaani-machakos.json"
DOCS = REPO / "docs" / "DATA_SOURCES.md"
REGION = Region(id="t", name="t", description="t", center_lat=0, center_lon=0, utm_epsg=32737)
CACHE = HERE.parent / "cache" / "kaani-machakos_-1.4967_37.3605"


def geotiff(path: Path, data: np.ndarray, west: float, north: float, res: float) -> Path:
    """Write a single-band EPSG:4326 GeoTIFF with square pixels of res degrees."""
    import rasterio
    from rasterio.transform import from_origin

    with rasterio.open(path, "w", driver="GTiff", width=data.shape[1], height=data.shape[0], count=1,
                       dtype=str(data.dtype), crs="EPSG:4326", transform=from_origin(west, north, res, res)) as dst:
        dst.write(data, 1)
    return path


def small_grid(size: int = 4) -> TargetGrid:
    """A UTM 37S grid near Kaani, 100 m cells, snapped like the real one."""
    from pyproj import Transformer

    x, y = Transformer.from_crs(4326, 32737, always_xy=True).transform(37.36, -1.5)
    return TargetGrid(epsg=32737, west=float(np.floor(x / 100) * 100), north=float(np.ceil(y / 100) * 100),
                      size=size, cell_m=100.0)


def covering_window(grid: TargetGrid, res: float, margin: float = 0.002) -> tuple[float, float, int, int]:
    w, s, e, n = grid.lonlat_bbox()
    west, north = w - margin, n + margin
    return west, north, int(np.ceil((n - s + 2 * margin) / res)), int(np.ceil((e - w + 2 * margin) / res))


def bowl(n: int = 9) -> np.ndarray:
    """A plane tilted east with a closed pit in the middle."""
    _z, x = np.mgrid[0:n, 0:n]
    e = 100.0 - x * 2.0
    e[n // 2, n // 2] = 50.0
    return e


def tilted_world(n: int = 10):
    """A small valid world: plane tilted east, a channel row draining to the east edge, a village."""
    _z, x = np.mgrid[0:n, 0:n]
    elev = 200.0 - x * 2.0 - np.abs(_z - n // 2) * 0.5
    to = hydro.d8_receivers(elev, 100.0)
    acc = hydro.flow_accumulation(elev, to)
    outlets = np.flatnonzero(to < 0)
    outlet = int(outlets[np.argmax(acc[outlets])])
    channel = (acc.reshape(n, n) >= 12).astype(np.uint8)
    cover = np.full((n, n), COVER["grassland"], dtype=np.uint8)
    cover[channel == 1] = COVER["water"]
    structure = np.zeros((n, n), dtype=np.uint8)
    structure[2, 2:4] = STRUCT["housing"]
    structure[2, 4:7] = STRUCT["road"]
    return elev, cover, structure, channel, to, acc, outlet


def run_check(elev, cover, structure, channel, to, acc, outlet, protected=None):
    n = elev.shape[0]
    prot = derive.edge_protection(n) if protected is None else protected
    return validate.check_world(elev, cover, structure, channel, to, acc, outlet, 100.0, prot)
