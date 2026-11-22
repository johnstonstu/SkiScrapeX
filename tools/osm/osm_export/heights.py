"""Sample the terrain height grid the same way game/src/world/terrainGrid.ts does.

heights.f32 stores little-endian float32 metres relative to the manifest's
vertical origin. This module does not import or modify the terrain package.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

from .transform import Origin


def sample_grid(
    x: float,
    z: float,
    columns: int,
    rows: int,
    step_metres: float,
    heights: list[float] | tuple[float, ...],
) -> float | None:
    """Bilinear sample on the same cell diagonal as createTerrainGrid.

    x and z are metres from the grid's own northwest cell centre, with +x east
    and +z south. Values in heights are already relative to that grid's
    vertical origin. Outside the grid this returns None.
    """
    if len(heights) != columns * rows:
        raise ValueError("Height array does not match the grid dimensions")
    width = (columns - 1) * step_metres
    depth = (rows - 1) * step_metres
    if x < 0 or z < 0 or x > width or z > depth:
        return None
    grid_x = x / step_metres
    grid_z = z / step_metres
    column = min(int(grid_x), columns - 2)
    row = min(int(grid_z), rows - 2)
    u = grid_x - column
    v = grid_z - row
    top_left = row * columns + column
    a = heights[top_left]
    b = heights[top_left + 1]
    c = heights[top_left + columns]
    d = heights[top_left + columns + 1]
    upper = u + v <= 1
    rise_east = (b - a) if upper else (d - c)
    rise_south = (c - a) if upper else (d - b)
    if upper:
        return a + u * rise_east + v * rise_south
    return d - (1 - u) * rise_east - (1 - v) * rise_south


class HeightGrid:
    """Terrain manifest plus heights, sampled in a (possibly different) game origin."""

    def __init__(self, meta: dict, heights: list[float], manifest_path: Path, heights_path: Path):
        self.meta = meta
        self.heights = heights
        self.manifest_path = manifest_path
        self.heights_path = heights_path
        self.columns = int(meta["columns"])
        self.rows = int(meta["rows"])
        self.step_metres = float(meta["stepMetres"])
        self.origin_easting = float(meta["originEasting"])
        self.origin_northing = float(meta["originNorthing"])
        self.origin_elevation = float(meta["originElevation"])
        if meta.get("heightEncoding") not in (None, "float32-le"):
            raise ValueError(f"Unsupported heightEncoding {meta.get('heightEncoding')}")
        if len(heights) != self.columns * self.rows:
            raise ValueError("heights.f32 length does not match terrain.json")

    def sample(self, x: float, z: float, origin: Origin) -> float | None:
        """Return Y in the export origin, or None outside the grid."""
        easting = origin.easting + x
        northing = origin.northing - z
        grid_x = easting - self.origin_easting
        grid_z = self.origin_northing - northing
        relative = sample_grid(
            grid_x, grid_z, self.columns, self.rows, self.step_metres, self.heights,
        )
        if relative is None:
            return None
        elevation = relative + self.origin_elevation
        return elevation - origin.elevation


def load_height_grid(manifest_path: Path, heights_path: Path | None = None) -> HeightGrid:
    meta = json.loads(manifest_path.read_text(encoding="utf-8"))
    path = heights_path or manifest_path.parent / "heights.f32"
    blob = path.read_bytes()
    if len(blob) % 4 != 0:
        raise ValueError(f"{path} is not a sequence of float32 values")
    count = len(blob) // 4
    heights = list(struct.unpack(f"<{count}f", blob))
    return HeightGrid(meta, heights, manifest_path, path)
