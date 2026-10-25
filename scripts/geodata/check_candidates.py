#!/usr/bin/env python3
"""Reproduce the candidate-square table in docs/DATA_SOURCES.md.

Each candidate is run through the same pipeline as the real export
(build_world.run with --lat/--lon, which implies preview only: nothing is
written to public/). Source windows and the OSM place/road query for each
candidate are cached under scripts/geodata/cache/, so the first run needs the
network and about 2.6 MB per candidate.

This checks the four candidates we compared. It is not a systematic scan; the
exploratory scan used to find them in an earlier round was not kept.

Usage (from the repo root):
    scripts/geodata/.venv/bin/python scripts/geodata/check_candidates.py
    scripts/geodata/.venv/bin/python scripts/geodata/check_candidates.py --offline
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import sys

import build_world

# (label, centre latitude, centre longitude). Same order as the docs table.
CANDIDATES = (
    ("Tawa, Mbooni hills", -1.57, 37.46),
    ("Makabete, near Machakos", -1.561, 37.299),
    ("Unnamed square", -1.457, 37.357),
    ("Kaani (chosen)", -1.4967, 37.3605),
)


def check(lat: float, lon: float, offline: bool) -> dict:
    out: dict = {}
    log = io.StringIO()
    with contextlib.redirect_stdout(log):
        code = build_world.run("kaani-machakos", offline, True, lat, lon, collect=out)
    if not out:
        raise RuntimeError(f"candidate {lat}, {lon} did not reach validation:\n{log.getvalue()}")
    out["exitCode"] = code
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--offline", action="store_true", help="use cached windows and OSM extracts only")
    ap.add_argument("--json", action="store_true", help="print raw results as JSON")
    a = ap.parse_args()
    rows = []
    for label, lat, lon in CANDIDATES:
        r = check(lat, lon, a.offline)
        rows.append({"label": label, **r})
    if a.json:
        print(json.dumps(rows, indent=2))
        return 0
    print("| Candidate (centre) | One-outlet share | Forest | Cropland | Housing cells | OSM places | Passes checks |")
    print("|---|---|---|---|---|---|---|")
    for r in rows:
        s, c = r["stats"], r["coverShare"]
        places = ", ".join(sorted(set(r["places"]))) or "none"
        print(f"| {r['label']} ({abs(r['center'][0])} S, {r['center'][1]} E) | {s['mainCatchmentFraction']:.1%} "
              f"| {c['forest']:.0%} | {c['cropland']:.0%} | {s['housingCells']} | {places} "
              f"| {'yes' if not r['errors'] else 'no: ' + '; '.join(r['errors'])} |")
    return 0


if __name__ == "__main__":
    sys.exit(main())
