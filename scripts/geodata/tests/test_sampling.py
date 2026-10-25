"""Source reading and sampling.

Overpass replies, cache provenance, DEM dates, WorldCover pixel counting, DEM fill masks, slope and
OSM snapshot paths.
"""
from __future__ import annotations

import json

import numpy as np
import pytest
from helpers import CACHE, HERE, covering_window, geotiff, small_grid

from amoria_geo import demdates, derive, hydro, osm, sources, validate
from amoria_geo.config import (
    COVER,
)


def _placemark(name: str, desc: str | None, coords: str) -> str:
    d = f"<description>{desc}</description>" if desc else ""
    return (f"<Placemark><name>{name}</name>{d}<Polygon><outerBoundaryIs><LinearRing><coordinates>{coords}"
            "</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>")


KML = "<kml><Document><Folder>" + "".join([
    _placemark("TDM1_DEM__04_S02E037", None, "37,-2 38,-2 38,-1 37,-1 37,-2"),
    _placemark("A_01", "First acquisition\n2010-12-26T03:13", "37.3,-1.6 37.5,-1.6 37.5,-1.4 37.3,-1.4 37.3,-1.6"),
    _placemark("B_01", "Second acquisition\n2013-02-28T15:46",
               "37.35,-1.55 37.36,-1.55 37.36,-1.45 37.35,-1.45 37.35,-1.55"),
    _placemark("C_01", "First acquisition\n2011-06-01T03:13", "37.8,-1.9 37.9,-1.9 37.9,-1.8 37.8,-1.8 37.8,-1.9"),
]) + "</Folder></Document></kml>"



XML = """<root xmlns:tsxx="http://example.org/tsxx"><tsxx:temporalCoverage>
<tsxx:tsxx_startTime>2010-12-15T03:12:47Z</tsxx:tsxx_startTime>
<tsxx:tsxx_stopTime>2013-04-21T03:15:56Z</tsxx:tsxx_stopTime></tsxx:temporalCoverage></root>"""


class TestDemDates:
    def test_metadata_urls_follow_the_aws_layout(self):
        u = demdates.metadata_urls(
            "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_S02_00_E037_00_DEM/"
            "Copernicus_DSM_COG_10_S02_00_E037_00_DEM.tif")
        assert u["xml"].endswith("Copernicus_DSM_COG_10_S02_00_E037_00_DEM/Copernicus_DSM_10_S02_00_E037_00.xml")
        assert u["src"].endswith("/PREVIEW/Copernicus_DSM_10_S02_00_E037_00_SRC.kml")

    def test_scene_dates_over_the_box(self, tmp_path):
        url = "https://x/T/Copernicus_DSM_COG_10_S02_00_E037_00_DEM.tif"
        (tmp_path / "Copernicus_DSM_COG_10_S02_00_E037_00_DEM_meta.xml").write_text(XML)
        (tmp_path / "Copernicus_DSM_COG_10_S02_00_E037_00_DEM_SRC.kml").write_text(KML)
        rec = demdates.dem_acquisition(url, tmp_path, (37.33, -1.52, 37.39, -1.47), offline=True)
        assert rec["tileTemporalCoverage"] == {"start": "2010-12-15T03:12:47Z", "stop": "2013-04-21T03:15:56Z"}
        assert [s["scene"] for s in rec["scenesOverBox"]] == ["A_01", "B_01"]  # C_01 is elsewhere
        assert rec["boxAcquisitionPeriod"] == {"first": "2010-12-26T03:13", "last": "2013-02-28T15:46"}

    def test_offline_without_cache_says_so(self, tmp_path):
        rec = demdates.dem_acquisition("https://x/T/a_DEM.tif", tmp_path, (0, 0, 1, 1), offline=True)
        assert "offline" in rec["note"] and "boxAcquisitionPeriod" not in rec




class TestOverpass:
    def test_clean_reply_passes(self):
        reply = {"osm3s": {"timestamp_osm_base": "x"}, "elements": []}
        assert osm.check_reply(reply) is reply

    def test_runtime_error_remark_is_rejected(self):
        reply = {
            "elements": [{"type": "way", "id": 1}],
            "remark": "runtime error: Query timed out in \"query\" at line 1 after 120 seconds.",
        }
        with pytest.raises(RuntimeError, match="incomplete"):
            osm.check_reply(reply)

    def test_memory_error_remark_is_rejected(self):
        with pytest.raises(RuntimeError):
            osm.check_reply({"elements": [], "remark": "runtime error: Query run out of memory using about 2048 MB"})

    def test_overpass_rejects_partial_reply_end_to_end(self, monkeypatch):
        body = json.dumps({"elements": [], "remark": "runtime error: Query timed out"}).encode()

        class Resp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return body

        monkeypatch.setattr(osm.urllib.request, "urlopen", lambda *a, **k: Resp())
        with pytest.raises(RuntimeError, match="incomplete"):
            osm._overpass("[out:json];node(1);out;")


class TestProvenance:
    def test_describe_cached_hashes_offline(self, tmp_path):
        import rasterio
        from rasterio.transform import from_origin

        path = tmp_path / "dem_0_0.tif"
        data = np.arange(12, dtype=np.float32).reshape(3, 4)
        with rasterio.open(path, "w", driver="GTiff", width=4, height=3, count=1, dtype="float32",
                           crs="EPSG:4326", transform=from_origin(0, 1, 0.1, 0.1)) as dst:
            dst.write(data, 1)
        rec = sources.describe_cached("https://example.org/x.tif", path, (0, 0, 1, 1), offline=True)
        import hashlib

        assert rec["cachedWindowSha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
        assert rec["windowDataSha256"] == hashlib.sha256(data.astype("<f4").tobytes()).hexdigest()
        assert rec["windowPixels"] == [3, 4]
        assert "not recorded" in rec["note"]
        # a sidecar written at fetch time is preferred
        sources.sidecar_path(path).write_text(json.dumps({"url": "u", "lastModified": "2022-05-09T14:52:46Z"}))
        rec2 = sources.describe_cached("u", path, (0, 0, 1, 1), offline=True)
        assert rec2["lastModified"] == "2022-05-09T14:52:46Z"




class TestNativeWorldCoverCounting:
    """Every native WorldCover pixel is counted once, in the cell holding its centre."""

    RES = 1 / 12000  # WorldCover pixel, degrees

    def test_pixels_per_cell_match_native_density(self, tmp_path):
        grid = small_grid(4)
        west, north, h, w = covering_window(grid, self.RES)
        path = geotiff(tmp_path / "wc.tif", np.full((h, w), 40, dtype=np.uint8), west, north, self.RES)
        cells = sources.pixel_cells(path, grid)
        counts = sources.cell_value_counts([cells], grid.size)
        per_cell = counts.sum(axis=-1)
        assert per_cell.sum() == cells.inside.sum() == cells.values.size  # each pixel counted exactly once
        dx, dy = sources.pixel_spacing_m(path)
        expected = 100 * 100 / (float(np.median(dx)) * dy)
        assert 9.2 < dy < 9.25 and 9.25 < float(np.median(dx)) < 9.3
        assert per_cell.mean() == pytest.approx(expected, rel=0.02)
        assert per_cell.min() >= 100  # more than the 100 a 10 m nearest-neighbour warp would sample
        agg = derive.aggregate_counts(counts)
        assert (agg.pixels == per_cell).all() and (agg.observed == COVER["cropland"]).all()
        assert agg.nodata_frac.max() == 0

    def test_counts_drive_shares_and_built_fraction(self, tmp_path):
        grid = small_grid(2)
        west, north, h, w = covering_window(grid, self.RES)
        data = np.full((h, w), 20, dtype=np.uint8)
        data[::5, :] = 50  # every fifth row of native pixels built-up
        path = geotiff(tmp_path / "wc.tif", data, west, north, self.RES)
        cells = sources.pixel_cells(path, grid)
        agg = derive.aggregate_counts(sources.cell_value_counts([cells], grid.size))
        built = (cells.values == 50).sum() / cells.values.size
        assert float((agg.built_frac * agg.pixels).sum() / agg.pixels.sum()) == pytest.approx(built)
        assert 0.15 < agg.built_frac.mean() < 0.25

    def test_unmapped_value_is_rejected(self):
        counts = np.zeros((1, 1, 256), dtype=np.int64)
        counts[0, 0, 40] = 100
        counts[0, 0, 77] = 1
        with pytest.raises(ValueError, match="77"):
            derive.aggregate_counts(counts)

    @pytest.mark.skipif(not (CACHE / "worldcover_-3_36.tif").exists(), reason="raster cache not present")
    def test_cached_window_gives_about_117_pixels_per_cell(self):
        from amoria_geo import regions  # noqa: F401
        from amoria_geo.config import REGIONS

        grid = sources.target_grid(REGIONS["kaani-machakos"])
        path = CACHE / "worldcover_-3_36.tif"
        agg = derive.aggregate_counts(sources.cell_value_counts([sources.pixel_cells(path, grid)], grid.size))
        dx, dy = sources.pixel_spacing_m(path)
        assert agg.pixels.mean() == pytest.approx(1e4 / (float(np.median(dx)) * dy), rel=0.01)
        assert agg.pixels.min() >= 100 and agg.pixels.max() <= 125


class TestDemFillMask:
    def counts(self):
        flm = np.zeros((3, 3, 256), dtype=np.int64)
        flm[..., 2] = 10  # not edited
        flm[0, 0, 2], flm[0, 0, 3] = 2, 8  # mostly ASTER
        flm[0, 1, 2], flm[0, 1, 3] = 9, 1
        flm[2, 2, 2], flm[2, 2, 1] = 9, 1  # edited, not filled
        edm = np.zeros((3, 3, 256), dtype=np.int64)
        edm[..., 1] = 10
        edm[0, 0, 1], edm[0, 0, 2] = 2, 8
        return flm, edm

    def test_summary_counts_fills_by_source_and_cell(self):
        fill = derive.dem_fill_summary(*self.counts())
        assert fill.by_source == {3: 9} and fill.edited == 1
        assert int(fill.filled.sum()) == 9 and int((fill.filled > 0).sum()) == 2
        assert fill.edit_counts == {1: 82, 2: 8}
        assert fill.mask_counts == {1: 1, 2: 80, 3: 9}
        first = fill.cells[0]
        assert (first["row"], first["col"], first["filledPixels"], first["sharePct"]) == (0, 0, 8, 80.0)
        assert first["sources"] == {"ASTER GDEM": 8}
        assert derive.fill_patches(fill, 3) == [[(0, 0), (0, 1)]]
        assert derive.compass(0, 0.5, 3) == "north-west"

    def test_fill_warns_and_threshold_stops_export(self):
        fill = derive.dem_fill_summary(*self.counts())
        errs, warns = validate.check_dem_fill(fill.pixels, fill.filled, fill.by_source, 0.5)
        assert errs == [] and warns and "ASTER GDEM 9" in warns[0] and "2 cells affected" in warns[0]
        errs, _ = validate.check_dem_fill(fill.pixels, fill.filled, fill.by_source, 0.05)
        assert any("producer void fills" in e for e in errs)

    def test_no_fill_no_warning_and_gaps_are_errors(self):
        flm = np.zeros((2, 2, 256), dtype=np.int64)
        flm[..., 2] = 10
        fill = derive.dem_fill_summary(flm, flm)
        assert validate.check_dem_fill(fill.pixels, fill.filled, fill.by_source, 0.05) == ([], [])
        flm[1, 1, 2] = 0
        fill = derive.dem_fill_summary(flm, flm)
        errs, _ = validate.check_dem_fill(fill.pixels, fill.filled, fill.by_source, 0.05)
        assert any("does not cover 1 grid cells" in e for e in errs)

    def test_mask_pixels_land_in_the_right_cell(self, tmp_path):
        grid = small_grid(3)
        res = 1 / 3600
        west, north, h, w = covering_window(grid, res, margin=0.001)
        data = np.full((h, w), 2, dtype=np.uint8)
        path = geotiff(tmp_path / "flm.tif", data, west, north, res)
        cells = sources.pixel_cells(path, grid)
        # mark every pixel that falls in cell (0, 0) as an ASTER fill
        rows, cols = np.nonzero(cells.inside)
        target = cells.cell == 0
        data[rows[target], cols[target]] = 3
        geotiff(path, data, west, north, res)
        counts = sources.cell_value_counts([sources.pixel_cells(path, grid)], grid.size)
        fill = derive.dem_fill_summary(counts, counts)
        assert fill.filled[0, 0] == fill.pixels[0, 0] > 0
        assert int(fill.filled.sum()) == int(fill.filled[0, 0])

    def test_aux_urls_follow_the_aws_layout(self):
        from amoria_geo.config import dem_aux_url

        assert dem_aux_url(-2, 37, "FLM") == (
            "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_S02_00_E037_00_DEM/AUXFILES/"
            "Copernicus_DSM_COG_10_S02_00_E037_00_FLM.tif")


class TestSlope:
    def test_horn_on_a_plane_gives_its_gradient(self):
        _z, x = np.mgrid[0:6, 0:6]
        e = 100.0 + x * 12.0  # 12 m per 100 m cell eastward
        s = hydro.horn_slope(e, 100.0, 100.0)
        assert s[1:-1, 1:-1] == pytest.approx(np.full((4, 4), 0.12))
        # edge cells use clamped neighbours like the engine: half the difference at the west edge
        assert s[2, 0] == pytest.approx(0.06)

    def test_per_row_spacing(self):
        _z, x = np.mgrid[0:5, 0:5]
        e = x * 3.0
        s = hydro.horn_slope(e, np.array([30.0, 30.0, 15.0, 30.0, 30.0]), 30.0)
        assert s[2, 2] == pytest.approx(0.2) and s[1, 2] == pytest.approx(0.1)

    def test_summary(self):
        st = derive.slope_summary(np.array([0.1, 0.2, 0.4, 0.05]))
        assert st["mean"] == pytest.approx(0.1875) and st["pctAbove15"] == 50.0 and st["pctAbove30"] == 25.0


class TestOsmSnapshotPath:
    def test_preview_and_export_read_the_same_committed_snapshot(self):
        import build_world

        key = "kaani-machakos_-1.4967_37.3605"
        cache = HERE.parent / "cache" / key
        export = build_world.osm_snapshot_path(key, cache, preview_only=False, refresh_osm=False)
        preview = build_world.osm_snapshot_path(key, cache, preview_only=True, refresh_osm=False)
        assert export == preview == HERE.parent / "snapshots" / f"{key}_osm.json"
        assert export.exists()

    def test_exploratory_centre_and_preview_refresh_use_the_cache(self, tmp_path):
        import build_world

        key = "kaani-machakos_-1.5700_37.4600"
        assert build_world.osm_snapshot_path(key, tmp_path, True, False) == tmp_path / f"{key}_osm.json"
        registered = "kaani-machakos_-1.4967_37.3605"
        # a preview that re-queries Overpass must not overwrite the committed snapshot
        assert build_world.osm_snapshot_path(registered, tmp_path, True, True).parent == tmp_path
