"""World validators plus checks on the exported world file and the docs that quote it."""
from __future__ import annotations

import json

import numpy as np
import pytest
from helpers import DOCS, WORLD, run_check, tilted_world

from amoria_geo import derive, hydro, validate
from amoria_geo.config import (
    COVER,
    LAND_COVERS,
    STRUCT,
    STRUCTURES,
    WORLDCOVER_TO_GAME,
    WORLDCOVER_VALIDATION,
)


class TestValidators:
    def test_clean_sources_pass(self):
        dem = np.full((8, 8), 1500.0)
        assert validate.check_sources(dem, -9999.0, np.zeros((8, 8))) == []

    def test_dem_gap_is_reported(self):
        dem = np.full((8, 8), 1500.0)
        dem[3, 3] = -9999.0
        errs = validate.check_sources(dem, -9999.0, np.zeros((8, 8)))
        assert any("1 grid cells without source coverage" in e for e in errs)

    def test_dem_nan_is_reported(self):
        dem = np.full((8, 8), 1500.0)
        dem[1, 1] = np.nan
        errs = validate.check_sources(dem, -9999.0, np.zeros((8, 8)))
        assert any("non-finite" in e for e in errs)

    def test_dem_out_of_earth_range(self):
        dem = np.full((8, 8), 1500.0)
        dem[0, 0] = 9500.0
        assert any("outside Earth" in e for e in validate.check_sources(dem, -9999.0, np.zeros((8, 8))))

    def test_high_worldcover_nodata(self):
        frac = np.zeros((8, 8))
        frac[4, 4] = 0.6
        errs = validate.check_sources(np.full((8, 8), 1500.0), -9999.0, frac)
        assert any("WorldCover nodata" in e for e in errs)

    def test_valid_world_passes(self):
        errs, stats = run_check(*tilted_world())
        assert errs == []
        assert stats["housingCells"] == 2 and stats["roadCells"] == 3

    def test_interior_pit_is_reported(self):
        elev, cover, structure, channel, to, acc, outlet = tilted_world()
        pitted = elev.copy()
        pitted[5, 4] = 100.0
        errs, _ = run_check(pitted, cover, structure, channel, to, acc, outlet)
        assert any("no downhill neighbour" in e for e in errs)
        assert any("D8 routing differs" in e for e in errs)

    def test_outlet_off_the_edge_is_reported(self):
        elev, cover, structure, channel, to, acc, _ = tilted_world()
        n = elev.shape[0]
        interior = 5 * n + 5
        channel = channel.copy()
        channel.ravel()[interior] = 1
        errs, _ = run_check(elev, cover, structure, channel, to, acc, interior)
        assert any("not on the map edge" in e for e in errs)

    def test_outlet_must_be_channel(self):
        elev, cover, structure, channel, to, acc, outlet = tilted_world()
        errs, _ = run_check(elev, cover, structure, np.zeros_like(channel), to, acc, outlet)
        assert any("not a channel cell" in e for e in errs)

    def test_missing_village_and_road(self):
        elev, cover, _s, channel, to, acc, outlet = tilted_world()
        errs, _ = run_check(elev, cover, np.zeros_like(_s), channel, to, acc, outlet)
        assert any("no housing cells" in e for e in errs)
        assert any("no road cells" in e for e in errs)

    def test_developable_excludes_protected_edge(self):
        world = tilted_world()
        _, unprotected = run_check(*world, protected=np.zeros((10, 10), dtype=np.uint8))
        _, ringed = run_check(*world)
        structure, channel = world[2], world[3]
        edge_open = int(((derive.edge_protection(10) == 1) & (channel == 0) & (structure == 0)).sum())
        assert unprotected["developableCells"] - ringed["developableCells"] == edge_open > 0

    def test_too_little_developable_land(self):
        world = tilted_world()
        everything = np.ones((10, 10), dtype=np.uint8)
        errs, _ = run_check(*world, protected=everything)
        assert any("developable cells" in e for e in errs)




@pytest.mark.skipif(not WORLD.exists(), reason="world not exported yet")
class TestExportedWorld:
    def test_shape_and_legends(self, world):
        n = world["width"] * world["height"]
        assert world["coverLegend"] == list(LAND_COVERS)
        assert world["structureLegend"] == list(STRUCTURES)
        for name, layer in world["layers"].items():
            assert len(layer) == n, name

    def test_routing_reaches_edge_everywhere(self, world):
        n = world["width"]
        e = np.array(world["layers"]["elevationCm"], dtype=np.float64).reshape(n, n) / 100
        to = hydro.d8_receivers(e, world["cellSizeM"])
        assert hydro.interior_pits(e, to) == []

    def test_main_channel_drains_to_edge_outlet(self, world):
        n = world["width"]
        e = np.array(world["layers"]["elevationCm"], dtype=np.float64).reshape(n, n) / 100
        ch = np.array(world["layers"]["channel"]).reshape(n, n)
        to = hydro.d8_receivers(e, world["cellSizeM"])
        acc = hydro.flow_accumulation(e, to)
        outlet = int(np.flatnonzero(to < 0)[np.argmax(acc[to < 0])])
        z, x = divmod(outlet, n)
        assert z in (0, n - 1) or x in (0, n - 1)
        assert ch.ravel()[outlet] == 1
        assert acc[outlet] / e.size > 0.5

    def test_village_road_and_provenance(self, world):
        s = np.array(world["layers"]["structure"])
        assert (s == STRUCT["housing"]).sum() > 10
        assert (s == STRUCT["road"]).sum() > 10
        meta = world["meta"]
        assert meta["kind"] == "real-data-derived"
        names = " ".join(src["name"] for src in meta["sources"])
        assert "Copernicus DEM" in names and "WorldCover" in names and "OpenStreetMap" in names
        assert any("CC BY 4.0" in src["license"] for src in meta["sources"])
        assert any("not" in d and "satellite" in d.lower() for d in meta["disclosures"])

    def test_provenance_counts_water_joined_channels(self, world):
        meta = world["meta"]
        joined = meta["stats"]["channelCellsByWater"]
        if joined > 0:
            noun = "cell that drains" if joined == 1 else "cells that drain"
            assert f"plus {joined} WorldCover water {noun} into them" in meta["provenance"]
        else:
            assert "WorldCover water cell" not in meta["provenance"]

    def test_water_join_note_wording(self):
        import build_world
        assert build_world.water_join_note(0) == ""
        assert build_world.water_join_note(1) == " (plus 1 WorldCover water cell that drains into them)"
        assert build_world.water_join_note(3) == " (plus 3 WorldCover water cells that drain into them)"

    def test_observed_water_cells_stay_water(self, world):
        lay = world["layers"]
        water = COVER["water"]
        for i, code in enumerate(lay["worldCoverClass"]):
            if code == 80:
                assert lay["observedCover"][i] == water and lay["cover"][i] == water, divmod(i, world["width"])
        # the 38% pond beside the stream (row 43, column 52) is kept and joins the channel network
        i = 43 * world["width"] + 52
        assert lay["worldCoverClass"][i] == 80 and lay["cover"][i] == water and lay["channel"][i] == 1
        assert world["meta"]["stats"]["worldCoverWaterKeptCells"] >= 1

    def test_source_files_are_recorded(self, world):
        files = world["meta"]["generated"]["sourceFiles"]
        for kind in ("dem", "worldcover"):
            for rec in files[kind]:
                assert len(rec["cachedWindowSha256"]) == 64 and len(rec["windowDataSha256"]) == 64
                assert rec["lastModified"] and rec["etag"]
        wc = files["worldcover"][0]["cogTags"]
        assert wc["time_start"].startswith("2021-01-01") and wc["time_end"].startswith("2021-12-31")
        assert "2021 release" not in json.dumps(world["meta"]["sources"])

    def test_developable_excludes_protected_ring(self, world):
        L = world["layers"]
        open_cells = sum(
            1 for c, s, ch, p in zip(L["cover"], L["structure"], L["channel"], L["protected"], strict=True)
            if s == 0 and ch == 0 and c != COVER["water"] and p == 0
        )
        assert world["meta"]["stats"]["developableCells"] == open_cells

    def test_channels_are_continuous_and_disclosed_from_data(self, world):
        n = world["width"]
        L = world["layers"]
        e = np.array(L["elevationCm"], dtype=np.float64).reshape(n, n) / 100
        ch = np.array(L["channel"])
        to = hydro.d8_receivers(e, world["cellSizeM"])
        acc = hydro.flow_accumulation(e, to)
        assert not [i for i in np.flatnonzero(ch) if to[i] >= 0 and not ch[to[i]]]
        stats = world["meta"]["stats"]
        p = world["meta"]["generated"]["parameters"]["channelMinCells"]
        assert stats["channelBreaks"] == 0
        assert stats["channelCellsByArea"] == int((acc >= p).sum())
        assert stats["channelCellsByArea"] + stats["channelCellsByWater"] == int(ch.sum())
        cover = np.array(L["cover"])
        bodies = int(((cover == COVER["water"]) & (ch == 0)).sum())
        assert stats["waterBodyCells"] == bodies
        text = " ".join(world["meta"]["disclosures"])
        assert f"River channels: {stats['channelCellsByArea']} cells have at least {p} ha upstream" in text
        if bodies:
            assert "off the derived stream network" in text

    def test_native_worldcover_layer_and_legend(self, world):
        L = world["layers"]
        assert set(L["worldCoverClass"]) <= set(WORLDCOVER_TO_GAME)
        assert set(world["worldCoverLegend"]) == {str(k) for k in WORLDCOVER_TO_GAME}
        assert all(0 < v <= 100 for v in L["worldCoverSharePct"])
        stats = world["meta"]["stats"]
        assert sum(1 for v in L["worldCoverClass"] if v == 20) == stats["worldCoverShrubPluralityCells"]
        merged = sum(1 for c, o in zip(L["worldCoverClass"], L["observedCover"], strict=True)
                     if COVER[WORLDCOVER_TO_GAME[c]] != o)
        assert merged == stats["worldCoverMergedWinnerCells"]

    def test_places_are_unique_and_dem_dates_recorded(self, world):
        names = [p["name"] for p in world["meta"]["places"]]
        assert len(names) == len(set(names))
        acq = world["meta"]["generated"]["demAcquisition"]
        assert acq["productHandbook"]["acquisitionPeriodStated"] == "December 2010 to January 2015"
        assert acq["tiles"][0]["boxAcquisitionPeriod"]["first"].startswith("2010-12")
        assert world["meta"]["sources"][0]["acquired"].startswith("2010-12")

    def test_no_em_dashes_in_prose(self, world):
        text = json.dumps(world["meta"], ensure_ascii=False)
        assert "\u2014" not in text

    def test_fill_split_and_disclosure_match(self, world):
        stats = world["meta"]["stats"]
        assert stats["filledPitCells"] + stats["gradientNudgedCells"] == stats["filledCells"]
        text = " ".join(world["meta"]["disclosures"])
        assert f"{stats['filledPitCells']} cells sat in small pits" in text
        assert f"at most {stats['filledPitMaxRaiseM']:.2f} m" in text
        if stats["gradientNudgedCells"]:
            assert f"{stats['gradientNudgedCells']} more cells were not in a pit" in text

    def test_worldcover_is_presented_as_a_classification(self, world):
        from amoria_geo.config import WORLDCOVER_VALIDATION as V
        meta = world["meta"]
        assert "can be wrong, especially between shrubland, grassland and cropland" in meta["provenance"]
        assert "shows what satellites saw" not in meta["provenance"]
        text = " ".join(meta["disclosures"])
        assert f"overall accuracy of {V['overallAccuracyAfricaPct']}% for Africa" in text
        assert f"{V['africaUsersAccuracyPct']['Shrubland']}%" in text
        assert meta["generated"]["worldCoverValidation"]["url"].endswith("WorldCover_PVR_V2.0.pdf")

    def test_generation_stamp_is_utc_and_versioned(self, world):
        import re

        import build_world
        gen = world["meta"]["generated"]
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", gen["date"])
        assert gen["pipeline"].endswith(f"v{build_world.PIPELINE_VERSION}")
        assert build_world.PIPELINE_VERSION != "1.0.0"
        iso = re.compile(r"\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2})?Z?)?)?)?")
        for src in world["meta"]["sources"]:
            assert all(iso.fullmatch(part) for part in src["acquired"].split("/")), src["acquired"]


@pytest.mark.skipif(not (WORLD.exists() and DOCS.exists()), reason="world or docs missing")
class TestDocsMatchExport:
    """docs/DATA_SOURCES.md quotes numbers from the export; fail if they drift."""

    def test_numbers_in_docs_match_the_world_file(self, world):
        doc = DOCS.read_text(encoding="utf-8")
        st = world["meta"]["stats"]
        gen = world["meta"]["generated"]
        tile = gen["demAcquisition"]["tiles"][0]
        sl = st["slope"]
        ua = WORLDCOVER_VALIDATION["africaUsersAccuracyPct"]
        expected = [
            f"{st['channelCells']} channel cells",
            f"{st['waterBodyCells']} WorldCover water cell",
            f"({st['mainCatchmentCells']} cells) drains to one outlet at row {st['mainOutletCell'][0]}, "
            f"column {st['mainOutletCell'][1]}",
            f"{st['housingCells']} housing cells, {st['roadCells']} road cells, {st['developableCells']} cells open",
            f"{st['filledPitCells']} cells in pits",
            f"{st['gradientNudgedCells']} cells nudged",
            f"{st['coverCellsAdjusted']} of 4096 cells",
            f"In {st['worldCoverMergedWinnerCells']} cells",
            f"the rule keeps {st['worldCoverWaterKeptCells']} cells as water",
            f"{st['worldCoverShrubPluralityCells']} cells",
            f"Snapshot `{gen['osmTimestamp']}`",
            tile["boxAcquisitionPeriod"]["first"][:10],
            tile["boxAcquisitionPeriod"]["last"][:10],
            tile["tileTemporalCoverage"]["start"][:10],
            tile["tileTemporalCoverage"]["stop"][:10],
            tile["metadataXmlUrl"],
            tile["sourceSceneLayerUrl"],
            f"`formatVersion` {world['formatVersion']}",
            gen["pipeline"].rsplit(" ", 1)[1],
            # round 4: native pixel counts, DEM void fills, slope, built-up accuracy
            f"{st['worldCoverPixelsPerCell']['min']} to {st['worldCoverPixelsPerCell']['max']} native pixels per "
            f"cell, {st['worldCoverPixelsPerCell']['mean']} on average",
            f"about {st['worldCoverPixelsPerCell']['mean']:.0f} native WorldCover pixels",
            f"{st['demVoidFilledPixels']} of the {st['demPixelsInGrid']:,} DEM pixels",
            f"They fall in {st['demVoidFilledCells']} cells",
            f"{round(st['demVoidFilledMaxCellPct'])}% of its DEM pixels filled",
            f"{st['demEditedPixels']} pixels as edited",
            f"mean {sl['grid100m']['mean']} and median {sl['grid100m']['median']} on the 100 m grid",
            f"{sl['grid100m']['pctAbove15']}% of cells steeper than 15% and {sl['grid100m']['pctAbove30']}% steeper",
            f"the mean is {sl['native30m']['mean']} and the median {sl['native30m']['median']}",
            f"{sl['native30m']['pctAbove15']}% steeper than 15% and {sl['native30m']['pctAbove30']}% steeper than 30%",
            f"mean Horn slope is {sl['grid100m']['mean']:.2f} (rise over run) on the 100 m grid against "
            f"{sl['native30m']['mean']:.2f}",
            f"{st['urbanCellsByThreshold']} cells became settled",
            f"{ua['Built-up']}% (+/- {WORLDCOVER_VALIDATION['africaUsersAccuracyConfidencePct']['Built-up']})",
            *[rec["etag"] for kind in ("demFillMask", "demEditMask") for rec in gen["sourceFiles"][kind]],
            f"({st['protectedCells']} cells)",
            f"({st['protectedCellsWithStructure']} cells)",
        ]
        missing = [e for e in expected if e not in doc]
        assert not missing, f"docs/DATA_SOURCES.md is out of date; missing: {missing}"
        if st["protectedCells"] > 0:
            assert any("not a mapped protected area" in d for d in world["meta"]["disclosures"]), (
                "export has protected cells but no edge-ring disclosure; re-run build_world.py"
            )
        assert "\u2014" not in doc




@pytest.mark.skipif(not WORLD.exists(), reason="world not exported yet")
class TestExportedRound4:
    def test_worldcover_pixel_density_recorded(self, world):
        st = world["meta"]["stats"]
        ppc = st["worldCoverPixelsPerCell"]
        x, y = st["pixelSizeM"]["worldCoverPixelM"]
        assert ppc["mean"] == pytest.approx(1e4 / (x * y), rel=0.01)
        assert ppc["min"] >= 100
        text = " ".join(world["meta"]["disclosures"])
        assert f"about {ppc['mean']:.0f} native WorldCover pixels" in text
        assert "100 WorldCover pixels" not in json.dumps(world["meta"])

    def test_dem_fill_layer_stats_and_disclosure_agree(self, world):
        meta = world["meta"]
        st = meta["stats"]
        layer = np.array(world["layers"]["demFilledPct"])
        assert int((layer > 0).sum()) == st["demVoidFilledCells"]
        assert layer.max() == round(st["demVoidFilledMaxCellPct"])
        cells = meta["generated"]["demQualityMasks"]["voidFilledCells"]
        assert sum(c["filledPixels"] for c in cells) == st["demVoidFilledPixels"] == sum(
            st["demVoidFilledPixelsBySource"].values())
        if st["demVoidFilledPixels"]:
            text = " ".join(meta["disclosures"])
            assert f"{st['demVoidFilledPixels']} of {st['demPixelsInGrid']:,} Copernicus DEM pixels" in text
            assert "except" in meta["provenance"] and "void-filled" in meta["provenance"]
            assert "void-filled" in meta["sources"][0]["version"]

    def test_slope_stats_match_the_exported_elevation(self, world):
        n = world["width"]
        e = np.array(world["layers"]["elevationCm"], dtype=np.float64).reshape(n, n) / 100
        s = hydro.horn_slope(e, world["cellSizeM"], world["cellSizeM"])
        rec = world["meta"]["stats"]["slope"]
        assert rec["grid100m"] == derive.slope_summary(s)
        assert rec["native30m"]["mean"] > rec["grid100m"]["mean"]
        text = " ".join(world["meta"]["disclosures"])
        assert f"mean Horn slope is {rec['grid100m']['mean']:.2f}" in text

    def test_built_up_accuracy_is_quoted(self, world):
        ua = WORLDCOVER_VALIDATION["africaUsersAccuracyPct"]["Built-up"]
        assert ua == 47.1 and WORLDCOVER_VALIDATION["africaProducersAccuracyPct"]["Built-up"] == 84.0
        assert world["meta"]["generated"]["worldCoverValidation"]["africaUsersAccuracyPct"]["Built-up"] == ua
        housing = next(d for d in world["meta"]["disclosures"] if d.startswith("Housing"))
        assert f"only {ua}% (+/- 9.7)" in housing and "Table A2.1, page 27" in housing
