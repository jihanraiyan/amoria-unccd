"""WorldCover to game cover aggregation."""
from __future__ import annotations

import numpy as np
import pytest

from amoria_geo import derive
from amoria_geo.config import (
    COVER,
    LAND_COVERS,
    WATER_KEEP_MIN_SHARE,
    WORLDCOVER_TO_GAME,
)


class TestLandcover:
    def test_mapping_is_total_and_valid(self):
        assert set(WORLDCOVER_TO_GAME) == {10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100}
        assert all(v in LAND_COVERS for v in WORLDCOVER_TO_GAME.values())
        assert WORLDCOVER_TO_GAME[10] == "forest" and WORLDCOVER_TO_GAME[40] == "cropland"
        assert WORLDCOVER_TO_GAME[95] == "wetland" and WORLDCOVER_TO_GAME[80] == "water"

    def test_majority_vote_on_mapped_classes(self):
        wc = np.full((20, 20), 40, dtype=np.uint8)  # 2x2 game cells of 10x10 pixels
        # top-left game cell: 40 grass + 30 shrub pixels (both grassland) beat 30 trees
        wc[:10, :4] = 30
        wc[:10, 4:7] = 10
        wc[:10, 7:10] = 20
        agg = derive.aggregate_worldcover(wc, 2)
        assert agg.observed[0, 0] == COVER["grassland"]
        assert agg.observed[1, 1] == COVER["cropland"]

    def test_tie_prefers_priority_order(self):
        wc = np.full((10, 10), 40, dtype=np.uint8)
        wc[:5] = 10
        agg = derive.aggregate_worldcover(wc, 1)
        assert agg.observed[0, 0] == COVER["forest"]

    def test_nodata_and_built_fraction(self):
        wc = np.full((10, 10), 40, dtype=np.uint8)
        wc[0] = 0
        wc[1:4] = 50
        agg = derive.aggregate_worldcover(wc, 1)
        assert agg.nodata_frac[0, 0] == pytest.approx(0.1)
        assert agg.built_frac[0, 0] == pytest.approx(30 / 90)

    def test_native_plurality_keeps_the_satellite_class(self):
        wc = np.full((10, 10), 20, dtype=np.uint8)  # one game cell
        wc[:4] = 40  # 40 cropland, 35 shrub, 25 grass
        wc[4:6, :] = 30
        wc[6, :5] = 30
        agg = derive.aggregate_worldcover(wc, 1)
        assert agg.native[0, 0] == 40
        assert agg.native_share[0, 0] == pytest.approx(0.4)
        # pooled shrub + grass (60) beats cropland (40) after mapping to game covers
        assert agg.observed[0, 0] == COVER["grassland"]
        assert derive.merged_winner_cells(agg)[0, 0]
        assert derive.merged_winner_breakdown(agg) == {(40, "grassland"): 1}

    def test_shrub_plurality_is_not_a_merged_winner(self):
        wc = np.full((10, 10), 20, dtype=np.uint8)
        agg = derive.aggregate_worldcover(wc, 1)
        assert agg.native[0, 0] == 20 and agg.observed[0, 0] == COVER["grassland"]
        assert not derive.merged_winner_cells(agg).any()

    def test_native_tie_and_nodata_share(self):
        wc = np.full((10, 10), 40, dtype=np.uint8)
        wc[:5] = 10
        wc[0, 0] = 0  # nodata pixel is not counted in the share
        agg = derive.aggregate_worldcover(wc, 1)
        assert agg.native[0, 0] == 40  # 50 cropland vs 49 tree pixels
        assert agg.native_share[0, 0] == pytest.approx(50 / 99)
        wc2 = np.full((10, 10), 40, dtype=np.uint8)
        wc2[:5] = 10
        assert derive.aggregate_worldcover(wc2, 1).native[0, 0] == 10  # exact tie: tree cover first

    def test_observed_water_survives_pooling(self):
        # 38% water, 35% shrub, 27% grass: pooled grassland (62) would win, water is kept
        wc = np.full((10, 10), 20, dtype=np.uint8)
        wc[:3] = 80
        wc[3, :8] = 80
        wc[4:6] = 30
        wc[6, :7] = 30
        agg = derive.aggregate_worldcover(wc, 1)
        assert (wc == 80).sum() == 38 and (wc == 20).sum() == 35 and (wc == 30).sum() == 27
        assert agg.native[0, 0] == 80
        assert agg.observed[0, 0] == COVER["water"]
        assert agg.water_kept[0, 0]
        assert not derive.merged_winner_cells(agg)[0, 0]

    def test_water_share_threshold_without_plurality(self):
        # 30% water is not the plurality (40% cropland) but meets WATER_KEEP_MIN_SHARE
        wc = np.full((10, 10), 40, dtype=np.uint8)
        wc[:3] = 80
        wc[3:6] = 20
        agg = derive.aggregate_worldcover(wc, 1)
        assert pytest.approx(0.30) == WATER_KEEP_MIN_SHARE
        assert agg.native[0, 0] == 40
        assert agg.observed[0, 0] == COVER["water"] and agg.water_kept[0, 0]

    def test_little_water_is_still_outvoted(self):
        wc = np.full((10, 10), 40, dtype=np.uint8)
        wc[:2] = 80  # 20% water, 80% cropland
        agg = derive.aggregate_worldcover(wc, 1)
        assert agg.observed[0, 0] == COVER["cropland"] and not agg.water_kept.any()

    def test_water_majority_is_not_counted_as_kept(self):
        wc = np.full((10, 10), 80, dtype=np.uint8)
        agg = derive.aggregate_worldcover(wc, 1)
        assert agg.observed[0, 0] == COVER["water"] and not agg.water_kept.any()

    def test_legend_lists_every_worldcover_code(self):
        assert derive.worldcover_legend()["20"] == "Shrubland"
        assert set(derive.worldcover_legend()) == {str(k) for k in WORLDCOVER_TO_GAME}

    def test_unknown_class_rejected(self):
        wc = np.full((10, 10), 40, dtype=np.uint8)
        wc[0, 0] = 77
        with pytest.raises(ValueError, match="77"):
            derive.aggregate_worldcover(wc, 1)
