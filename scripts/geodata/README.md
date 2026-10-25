# Geodata pipeline

Builds Amoria's real-data map (`public/world-data/<id>.json`) from Copernicus DEM GLO-30, ESA WorldCover 2021 v200 and OpenStreetMap.

```sh
python3 -m venv scripts/geodata/.venv
scripts/geodata/.venv/bin/pip install -r scripts/geodata/requirements.txt
scripts/geodata/.venv/bin/python scripts/geodata/build_world.py --region kaani-machakos
scripts/geodata/.venv/bin/python -m pytest scripts/geodata/tests -q
```

Layout:

- `build_world.py`: command line entry, runs every step and writes the outputs
- `check_candidates.py`: reruns the candidate squares compared when choosing the region and prints the table in the docs
- `amoria_geo/config.py`: sources, licences, the WorldCover mapping, derivation thresholds
- `amoria_geo/regions.py`: registered regions (add one here to build another map)
- `amoria_geo/sources.py`: grid definition, windowed COG reads, reprojection, native-pixel-to-cell counting (WorldCover and the DEM quality masks), pixel ground sizes, source fingerprints
- `amoria_geo/demdates.py`: when the DEM was acquired, from the tile's XML metadata and TanDEM-X source-scene KML
- `amoria_geo/hydro.py`: pit filling, D8 routing, flow accumulation, Horn slope (same method as the engine)
- `amoria_geo/derive.py`: land cover aggregation from per-cell pixel counts (game covers and native WorldCover classes), DEM void-fill summary, slope summaries, channels and off-network water bodies, settlement and roads
- `amoria_geo/osm.py`: Overpass queries and road rasterisation
- `amoria_geo/validate.py`: checks that stop a bad export
- `snapshots/`: dated OpenStreetMap extracts used for the committed map (export and `--preview-only` both read these for a registered region)
- `cache/` (not committed): source windows plus a `.provenance.json` sidecar each (HTTP Last-Modified, ETag, COG tags, bytes fetched), the DEM tile's `*_meta.xml` and `*_SRC.kml` metadata files (about 100 KB together) and its Filling and Editing Mask windows (`demFillMask_*.tif`, `demEditMask_*.tif`); `--offline` needs all of them
- `tests/`: pytest suite, including a check that the numbers quoted in `docs/DATA_SOURCES.md` match the exported world
- `out/`: text previews of each exported grid

`PIPELINE_VERSION` in `build_world.py` is recorded in each world file; bump it when the export gains or changes fields.

Full documentation, licences and limitations: [docs/DATA_SOURCES.md](../../docs/DATA_SOURCES.md).
