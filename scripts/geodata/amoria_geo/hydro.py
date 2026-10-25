"""Grid hydrology helpers: depression filling, D8 routing, flow accumulation.

These mirror what the browser simulation does with the exported elevation
(steepest-descent D8 over the 8 neighbours, distance-weighted), so that the
channel network we derive here is the same one the game routes water along.
"""
from __future__ import annotations

import heapq

import numpy as np

NEIGHBOURS = [(dz, dx) for dz in (-1, 0, 1) for dx in (-1, 0, 1) if dz or dx]


def fill_depressions(elev: np.ndarray, epsilon: float) -> np.ndarray:
    """Priority-flood depression filling (Barnes et al. 2014 style, with epsilon).

    Every map-edge cell is a potential outlet. Cells are visited from the edge
    inwards in order of elevation, and each one is raised to at least
    (elevation of the cell it was reached from + epsilon), so every cell has a
    strictly lower neighbour on a path to the edge. That raises cells inside
    pits (to spill level plus a small gradient), and also nudges up any cell
    that is less than epsilon above the cell it was reached from, even when it
    is not in a depression (flats and very gentle ground). With epsilon = 0
    only cells inside depressions change. Other cells are left untouched.
    """
    h, w = elev.shape
    out = elev.astype(np.float64).copy()
    seen = np.zeros((h, w), dtype=bool)
    pq: list[tuple[float, int, int, int]] = []
    counter = 0
    for z in range(h):
        for x in range(w):
            if z in (0, h - 1) or x in (0, w - 1):
                heapq.heappush(pq, (out[z, x], counter, z, x))
                counter += 1
                seen[z, x] = True
    while pq:
        v, _, z, x = heapq.heappop(pq)
        for dz, dx in NEIGHBOURS:
            nz, nx = z + dz, x + dx
            if 0 <= nz < h and 0 <= nx < w and not seen[nz, nx]:
                seen[nz, nx] = True
                out[nz, nx] = max(out[nz, nx], v + epsilon)
                heapq.heappush(pq, (out[nz, nx], counter, nz, nx))
                counter += 1
    return out


def d8_receivers(elev: np.ndarray, cell_m: float) -> np.ndarray:
    """Steepest-descent receiver index per cell (z*w+x), -1 where no lower neighbour."""
    h, w = elev.shape
    to = np.full(h * w, -1, dtype=np.int64)
    for z in range(h):
        for x in range(w):
            best, best_drop = -1, 0.0
            for dz, dx in NEIGHBOURS:
                nz, nx = z + dz, x + dx
                if 0 <= nz < h and 0 <= nx < w:
                    drop = (elev[z, x] - elev[nz, nx]) / (np.hypot(dz, dx) * cell_m)
                    if drop > best_drop:
                        best_drop, best = drop, nz * w + nx
            to[z * w + x] = best
    return to


def flow_accumulation(elev: np.ndarray, to: np.ndarray) -> np.ndarray:
    """Upstream contributing cells including self, routed high to low."""
    acc = np.ones(elev.size, dtype=np.float64)
    for i in np.argsort(-elev.ravel(), kind="stable"):
        j = to[i]
        if j >= 0:
            acc[j] += acc[i]
    return acc


def slope_max(elev: np.ndarray, cell_m: float) -> np.ndarray:
    """Max absolute rise/run to any of the 8 neighbours.

    This is NOT the engine's slope: src/simulation/engine/terrain.ts uses Horn's
    (1981) 3x3 method. The pipeline uses this value only as a cost term when
    routing settlement link roads, so the difference does not reach the game.
    """
    h, w = elev.shape
    s = np.zeros((h, w))
    for z in range(h):
        for x in range(w):
            m = 0.0
            for dz, dx in NEIGHBOURS:
                nz, nx = z + dz, x + dx
                if 0 <= nz < h and 0 <= nx < w:
                    m = max(m, abs(elev[z, x] - elev[nz, nx]) / (np.hypot(dz, dx) * cell_m))
            s[z, x] = m
    return s


def horn_slope(elev: np.ndarray, dx: float | np.ndarray, dy: float) -> np.ndarray:
    """Horn (1981) 3x3 slope as rise/run, the same method as the engine.

    Matches computeSlope in src/simulation/engine/terrain.ts: edge cells use
    clamped (repeated) neighbours. dx is the east-west pixel spacing in metres,
    either one value or one per row (geographic grids narrow with latitude);
    dy is the north-south spacing.
    """
    e = np.pad(np.asarray(elev, dtype=np.float64), 1, mode="edge")
    a, b, c = e[:-2, :-2], e[:-2, 1:-1], e[:-2, 2:]
    d, f = e[1:-1, :-2], e[1:-1, 2:]
    g, h, k = e[2:, :-2], e[2:, 1:-1], e[2:, 2:]
    dxs = np.asarray(dx, dtype=np.float64)
    if dxs.ndim == 1:
        dxs = dxs[:, None]
    dzdx = (c + 2 * f + k - (a + 2 * d + g)) / (8 * dxs)
    dzdy = (g + 2 * h + k - (a + 2 * b + c)) / (8 * dy)
    return np.hypot(dzdx, dzdy)


def interior_pits(elev: np.ndarray, to: np.ndarray) -> list[int]:
    """Interior cells with no receiver (should be empty after filling)."""
    h, w = elev.shape
    pits = []
    for i in np.flatnonzero(to < 0):
        z, x = divmod(int(i), w)
        if 0 < z < h - 1 and 0 < x < w - 1:
            pits.append(int(i))
    return pits


def trace_to_outlet(start: int, to: np.ndarray) -> list[int]:
    path = [start]
    seen = {start}
    while to[path[-1]] >= 0:
        nxt = int(to[path[-1]])
        if nxt in seen:  # cycles are impossible on a strictly descending surface
            raise ValueError("cycle in D8 routing")
        seen.add(nxt)
        path.append(nxt)
    return path
