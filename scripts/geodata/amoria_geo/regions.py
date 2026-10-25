"""Registered real-data regions. Add a Region here to build another world."""
from __future__ import annotations

from .config import Region, register

KAANI = register(
    Region(
        id="kaani-machakos",
        name="Kaani, Machakos County (Kenya)",
        description=(
            "A 6.4 km square of semi-arid hill country about 11 km east-north-east of Machakos town, Kenya "
            "(its western edge about 8 km from the town), in Lower Kaewa-Kaani ward. Tree cover is densest "
            "on the western hills and most of the cropland is in the eastern half. Stream lines derived from"
            " the terrain drain about nine tenths of the square to a single outlet on the eastern edge; in "
            "this semi-arid area they are likely seasonal, which the data cannot confirm. The village of "
            "Kaani sits in the south-west, near the Machakos-Kitui road that cuts diagonally across the "
            "square."
        ),
        center_lat=-1.4967,
        center_lon=37.3605,
        utm_epsg=32737,  # WGS 84 / UTM zone 37S
    )
)
