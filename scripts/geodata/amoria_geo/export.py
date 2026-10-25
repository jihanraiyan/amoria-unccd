"""Write the browser world JSON and a human-readable preview."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .config import LAND_COVERS, STRUCTURES

FORMAT = "amoria-world"
FORMAT_VERSION = 1

PREVIEW_SYMBOLS = {
    "forest": "T",
    "grassland": ",",
    "cropland": "c",
    "agroforestry": "a",
    "urban": "#",
    "wetland": "w",
    "water": "~",
    "bare": "_",
}


def ints(a: np.ndarray) -> list[int]:
    return [int(v) for v in a.ravel()]


def write_world(path: Path, meta: dict, size: int, cell_m: float, elev: np.ndarray,
                layers: dict[str, np.ndarray], legends: dict | None = None) -> int:
    doc = {
        "format": FORMAT,
        "formatVersion": FORMAT_VERSION,
        "meta": meta,
        "width": size,
        "height": size,
        "cellSizeM": cell_m,
        "coverLegend": list(LAND_COVERS),
        "structureLegend": list(STRUCTURES),
        **(legends or {}),
        "layers": {
            # Elevation in integer centimetres keeps the file compact and exact.
            "elevationCm": ints(np.round(elev * 100).astype(np.int64)),
            **{k: ints(v) for k, v in layers.items()},
        },
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(doc, separators=(",", ":"), ensure_ascii=False)
    path.write_text(text + "\n", encoding="utf-8")
    return len(text)


def preview(cover: np.ndarray, structure: np.ndarray, channel: np.ndarray) -> str:
    rows = []
    for z in range(cover.shape[0]):
        row = []
        for x in range(cover.shape[1]):
            if structure[z, x] == STRUCTURES.index("road"):
                row.append("=")
            elif structure[z, x] == STRUCTURES.index("housing"):
                row.append("H")
            elif channel[z, x]:
                row.append("~")
            else:
                row.append(PREVIEW_SYMBOLS[LAND_COVERS[cover[z, x]]])
        rows.append("".join(row))
    legend = "T forest  , grassland  c cropland  ~ channel/water  H housing  = road  # urban  _ bare  w wetland"
    return "row 0 = north, column 0 = west\n" + "\n".join(rows) + "\n" + legend + "\n"
