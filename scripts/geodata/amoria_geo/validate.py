"""Completeness and playability checks. Any failure aborts the export."""
from __future__ import annotations

import numpy as np

from . import hydro
from .config import COVER, DEM_FILL_MASK_VALUES, STRUCT


class ValidationError(Exception):
    pass


def check_sources(dem: np.ndarray, dem_nodata: float, nodata_frac: np.ndarray) -> list[str]:
    errors = []
    missing = int((dem == dem_nodata).sum())
    if missing:
        errors.append(f"DEM has {missing} grid cells without source coverage")
    if not np.isfinite(dem[dem != dem_nodata]).all():
        errors.append("DEM has non-finite values")
    valid = dem[dem != dem_nodata]
    if valid.size and (valid.min() < -450 or valid.max() > 8900):
        errors.append(f"DEM range {valid.min():.1f}..{valid.max():.1f} m is outside Earth's surface range")
    worst = float(nodata_frac.max())
    if worst > 0.5:
        errors.append(f"a grid cell has {worst:.0%} WorldCover nodata (limit 50%)")
    return errors


def check_dem_fill(pixels: np.ndarray, filled: np.ndarray, by_source: dict[int, int],
                   max_frac: float) -> tuple[list[str], list[str]]:
    """Producer void fills in the DEM (Filling Mask). Returns (errors, warnings).

    The DEM provenance calls the elevation TanDEM-X; pixels the producer filled
    from other sources (ASTER, SRTM and so on) are not. Any fill is a warning (and
    is disclosed in the export); a fill share above max_frac stops the export.
    Cells without any mask pixel mean the mask does not cover the grid.
    """
    errors: list[str] = []
    warnings: list[str] = []
    total = int(pixels.sum())
    if total == 0 or (pixels == 0).any():
        errors.append(f"DEM filling mask does not cover {int((pixels == 0).sum())} grid cells")
        return errors, warnings
    nfilled = int(filled.sum())
    if nfilled:
        names = ", ".join(f"{DEM_FILL_MASK_VALUES.get(v, v)} {k}" for v, k in sorted(by_source.items()))
        share = filled / pixels
        warnings.append(f"{nfilled} of {total} DEM pixels ({nfilled / total:.2%}) were void-filled by the producer "
                        f"({names}); {int((filled > 0).sum())} cells affected, at most {share.max():.0%} of a cell")
    if nfilled > max_frac * total:
        errors.append(f"{nfilled / total:.1%} of DEM pixels are producer void fills (limit {max_frac:.0%})")
    return errors, warnings


def check_world(elev: np.ndarray, cover: np.ndarray, structure: np.ndarray, channel: np.ndarray,
                receivers: np.ndarray, accumulation: np.ndarray, main_outlet: int,
                cell_m: float, protected: np.ndarray) -> tuple[list[str], dict]:
    """Checks the browser simulation relies on. Returns (errors, stats)."""
    n = elev.shape[0]
    errors: list[str] = []
    # Re-derive routing from the rounded export values, like the engine will.
    to = hydro.d8_receivers(elev, cell_m)
    pits = hydro.interior_pits(elev, to)
    if pits:
        errors.append(f"{len(pits)} interior cells have no downhill neighbour")
    if not np.array_equal(to, receivers):
        errors.append("D8 routing differs after export rounding")
    oz, ox = divmod(main_outlet, n)
    if not (oz in (0, n - 1) or ox in (0, n - 1)):
        errors.append("main outlet is not on the map edge")
    if not channel.ravel()[main_outlet]:
        errors.append("main outlet is not a channel cell")
    # The channel network must drain continuously: each channel cell's receiver
    # is a channel cell or the basin exit. Observed water that is off the network
    # must be exported as a water body (water cover, channel 0), never as a channel.
    broken = [
        int(i) for i in np.flatnonzero(channel.ravel())
        if to[i] >= 0 and not channel.ravel()[to[i]]
    ]
    if broken:
        cells = ", ".join(f"({i // n}, {i % n})" for i in broken[:5])
        errors.append(f"{len(broken)} channel cells drain into a non-channel cell: {cells}")
    housing = int((structure == STRUCT["housing"]).sum())
    roads = int((structure == STRUCT["road"]).sum())
    # Open land a player can build on: not a channel, no structure, not water,
    # and not in the protected edge ring.
    developable = int(((channel == 0) & (structure == 0) & (cover != COVER["water"]) & (protected == 0)).sum())
    stats = {
        "mainOutletCell": [int(oz), int(ox)],
        "mainCatchmentCells": int(accumulation[main_outlet]),
        "mainCatchmentFraction": round(float(accumulation[main_outlet]) / elev.size, 3),
        "channelCells": int(channel.sum()),
        "channelBreaks": len(broken),
        "housingCells": housing,
        "roadCells": roads,
        "developableCells": developable,
        "elevationMinM": round(float(elev.min()), 2),
        "elevationMaxM": round(float(elev.max()), 2),
    }
    if housing == 0:
        errors.append("no housing cells: the world needs a starting village")
    if roads == 0:
        errors.append("no road cells")
    if developable < 0.3 * elev.size:
        errors.append(f"only {developable} developable cells")
    if stats["mainCatchmentFraction"] < 0.25:
        errors.append("main catchment drains less than 25% of the map")
    return errors, stats
