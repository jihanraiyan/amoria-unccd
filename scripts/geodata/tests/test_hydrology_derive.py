"""Hydrology and derived layers: fill, D8 routing, settlement, channels, places, roads."""
from __future__ import annotations

import numpy as np
import pytest
from helpers import REGION, bowl, run_check, tilted_world

from amoria_geo import derive, hydro, osm
from amoria_geo.config import (
    COVER,
    STRUCT,
)
from amoria_geo.sources import TargetGrid


class TestHydro:
    def test_fill_removes_interior_pits(self):
        e = bowl()
        assert hydro.interior_pits(e, hydro.d8_receivers(e, 100.0))
        f = hydro.fill_depressions(e, 0.05)
        assert hydro.interior_pits(f, hydro.d8_receivers(f, 100.0)) == []

    def test_fill_never_lowers(self):
        e = bowl()
        f = hydro.fill_depressions(e, 0.05)
        assert (f >= e - 1e-9).all()
        # only the pit was raised, the tilted plane is untouched
        assert (np.abs(f - e) > 1e-9).sum() == 1

    def test_epsilon_nudges_flat_cells_that_are_not_in_a_pit(self):
        # A perfectly flat square has no depression: a zero-gradient fill
        # changes nothing, but the epsilon gradient raises the interior.
        e = np.full((5, 5), 100.0)
        assert (hydro.fill_depressions(e, 0.0) == e).all()
        f = hydro.fill_depressions(e, 0.05)
        assert (f[1:-1, 1:-1] > e[1:-1, 1:-1]).all()
        assert hydro.interior_pits(f, hydro.d8_receivers(f, 100.0)) == []

    def test_hydrology_splits_pit_cells_from_gradient_nudges(self):
        # Tilted plane (2 cm per cell, below the 5 cm epsilon) with one deep pit.
        _z, x = np.mgrid[0:9, 0:9]
        e = 100.0 - x * 0.02
        e[4, 4] = 90.0
        hyd = derive.derive_hydrology(e, np.zeros((9, 9), dtype=np.uint8), REGION)
        assert hyd.pit_cells == 1
        assert hyd.max_pit_fill_m == pytest.approx(10.0, abs=0.5)
        assert hyd.nudged_cells > 0 and hyd.max_nudge_m < 1.0
        assert hyd.pit_cells + hyd.nudged_cells == hyd.filled_cells

    def test_d8_follows_steepest_descent_on_plane(self):
        _z, x = np.mgrid[0:5, 0:5]
        e = 100.0 - x * 3.0
        to = hydro.d8_receivers(e, 100.0)
        # interior cell (2,2) drains east to (2,3)
        assert to[2 * 5 + 2] == 2 * 5 + 3
        # eastern column has no lower neighbour: basin exit
        assert all(to[r * 5 + 4] == -1 for r in range(5))

    def test_accumulation_conserves_cells(self):
        f = hydro.fill_depressions(bowl(), 0.05)
        to = hydro.d8_receivers(f, 100.0)
        acc = hydro.flow_accumulation(f, to)
        outlets = np.flatnonzero(to < 0)
        assert acc[outlets].sum() == pytest.approx(f.size)

    def test_trace_reaches_edge(self):
        f = hydro.fill_depressions(bowl(), 0.05)
        to = hydro.d8_receivers(f, 100.0)
        path = hydro.trace_to_outlet(4 * 9 + 4, to)
        assert to[path[-1]] == -1




class TestSettlement:
    def test_isolated_village_gets_linked_to_edge_road(self):
        n = 12
        observed = np.full((n, n), COVER["grassland"], dtype=np.uint8)
        built = np.zeros((n, n))
        built[5:8, 5:8] = 0.5
        channel = np.zeros((n, n), dtype=np.uint8)
        slope = np.zeros((n, n))
        main = np.zeros((n, n), dtype=np.uint8)
        main[:, 0] = 1  # main road along the west edge
        minor = np.zeros((n, n), dtype=np.uint8)
        minor[6, 1:5] = 1  # an OSM track leading to the village
        st = derive.build_settlement(observed, built, channel, slope, main, minor, REGION)
        assert (st.structure[5:8, 5:8] == STRUCT["housing"]).all()
        assert st.road_counts["osmMinorLink"] >= 3
        assert st.road_counts["synthetic"] == 0
        assert (st.cover[st.structure == STRUCT["road"]] == COVER["urban"]).all()

    def test_roads_cross_channels_as_bridges_and_channels_stay_water(self):
        n = 6
        observed = np.full((n, n), COVER["cropland"], dtype=np.uint8)
        channel = np.zeros((n, n), dtype=np.uint8)
        channel[:, 3] = 1
        main = np.zeros((n, n), dtype=np.uint8)
        main[2, :] = 1
        st = derive.build_settlement(observed, np.zeros((n, n)), channel, np.zeros((n, n)), main,
                                     np.zeros((n, n), dtype=np.uint8), REGION)
        assert st.structure[2, 3] == STRUCT["road"]
        assert st.road_counts["bridges"] == 1
        assert (st.cover[:, 3] == COVER["water"]).all()


class TestChannels:
    """Observed water joins the stream network only if it drains into it."""

    def setup(self, n=10):
        _z, x = np.mgrid[0:n, 0:n]
        elev = 200.0 - x * 2.0 - np.abs(_z - n // 2) * 0.5
        to = hydro.d8_receivers(elev, 100.0)
        acc = hydro.flow_accumulation(elev, to).reshape(n, n)
        return elev, to, acc

    def test_isolated_water_cell_is_a_water_body_not_a_channel(self):
        _elev, to, acc = self.setup()
        observed = np.full((10, 10), COVER["grassland"], dtype=np.uint8)
        observed[5, 7] = COVER["water"]  # on the ridge row: small catchment, drains to a non-channel cell
        channel, body = derive.channel_network(acc, to, observed, 12)
        assert channel[5, 7] == 0 and body[5, 7] == 1
        assert channel.sum() == (acc >= 12).sum()

    def test_water_draining_into_a_channel_joins_it(self):
        _elev, to, acc = self.setup()
        observed = np.full((10, 10), COVER["grassland"], dtype=np.uint8)
        j = int(np.flatnonzero((acc >= 12).ravel())[0])
        upstream = [i for i in range(100) if to[i] == j and acc.ravel()[i] < 12]
        assert upstream
        for i in upstream:
            observed.ravel()[i] = COVER["water"]
        channel, body = derive.channel_network(acc, to, observed, 12)
        assert all(channel.ravel()[i] for i in upstream)
        assert body.sum() == 0

    def test_water_body_stays_water_without_houses_and_a_road_bridges_it(self):
        n = 6
        observed = np.full((n, n), COVER["cropland"], dtype=np.uint8)
        observed[2, 2] = COVER["water"]
        built = np.zeros((n, n))
        built[2, 2] = 0.5  # enough built-up pixels to count as settled
        main = np.zeros((n, n), dtype=np.uint8)
        main[2, :] = 1
        st = derive.build_settlement(observed, built, np.zeros((n, n), dtype=np.uint8), np.zeros((n, n)), main,
                                     np.zeros((n, n), dtype=np.uint8), REGION)
        assert st.cover[2, 2] == COVER["water"] and st.structure[2, 2] == STRUCT["road"]
        assert not (st.structure == STRUCT["housing"]).any()

    def test_check_world_fails_on_a_channel_break(self):
        elev, cover, structure, channel, to, acc, outlet = tilted_world()
        broken = channel.copy()
        broken[5, 7] = 1  # isolated cell flagged as channel, drains to grassland
        errs, stats = run_check(elev, cover, structure, broken, to, acc, outlet)
        assert stats["channelBreaks"] == 1
        assert any("drain into a non-channel cell: (5, 7)" in e for e in errs)


class TestPlaces:
    def test_same_name_nearby_is_merged_preferring_village(self):
        places = [
            {"id": 2, "name": "Kaseve", "place": "locality", "row": 61, "col": 3},
            {"id": 1, "name": "Kaseve", "place": "village", "row": 60, "col": 5},
            {"id": 3, "name": "Kaani", "place": "village", "row": 53, "col": 23},
        ]
        merged = osm.merge_places(places)
        assert [p["name"] for p in merged] == ["Kaani", "Kaseve"]
        kaseve = merged[1]
        assert kaseve["place"] == "village" and (kaseve["row"], kaseve["col"]) == (60, 5)
        assert kaseve["ids"] == [1, 2] and kaseve["types"] == ["village", "locality"]

    def test_same_name_far_apart_stays_separate(self):
        places = [
            {"id": 1, "name": "Mutituni", "place": "village", "row": 5, "col": 5},
            {"id": 2, "name": "Mutituni", "place": "village", "row": 40, "col": 40},
        ]
        assert len(osm.merge_places(places)) == 2




class TestRoads:
    def test_diagonal_road_is_one_cell_wide(self):
        grid = TargetGrid(epsg=32737, west=300000.0, north=9840000.0, size=10, cell_m=100.0)
        from pyproj import Transformer

        t = Transformer.from_crs(32737, 4326, always_xy=True)
        a = t.transform(300050.0, 9839950.0)  # centre of cell (0,0)
        b = t.transform(300950.0, 9839050.0)  # centre of cell (9,9)
        data = {"roads": [{"highway": "tertiary", "geometry": [list(a), list(b)]}]}
        m = osm.rasterize_roads(data, grid, ("tertiary",))
        assert m.sum() == 10
        assert all(m[i, i] for i in range(10))
