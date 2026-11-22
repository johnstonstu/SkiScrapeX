"""WGS84 lon/lat to the game frame used by the terrain manifest.

Game axes are metres: +X east, +Y up, +Z south. Projected coordinates are
NAD83(CSRS) / UTM zone 11N (EPSG:2955). Elevations, when they come from the
terrain grid, are CGVD2013 (EPSG:6647) minus the vertical origin.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from pyproj import Transformer

from .constants import (
    CELL_METRES,
    CROP_EAST,
    CROP_NORTH,
    CROP_SOUTH,
    CROP_WEST,
    VERTICAL_ORIGIN_METRES,
)


@dataclass(frozen=True)
class Origin:
    """Local-frame origin. X and Z are zero here; Y is zero at origin.elevation."""

    easting: float
    northing: float
    elevation: float
    source: str = "documented-crop"


def documented_origin() -> Origin:
    """Northwest cell centre of the crop described in docs/terrain.md."""
    return Origin(
        easting=CROP_WEST + CELL_METRES / 2.0,
        northing=CROP_NORTH - CELL_METRES / 2.0,
        elevation=VERTICAL_ORIGIN_METRES,
        source="documented-crop",
    )


def metres_bbox_to_lonlat(
    west: float,
    south: float,
    east: float,
    north: float,
) -> tuple[float, float, float, float]:
    """EPSG:2955 metre edges to (min lon, min lat, max lon, max lat)."""
    corners = (
        unproject(west, south),
        unproject(west, north),
        unproject(east, south),
        unproject(east, north),
    )
    lons = [lon for lon, _lat in corners]
    lats = [lat for _lon, lat in corners]
    return min(lons), min(lats), max(lons), max(lats)


def documented_crop_bbox(buffer_metres: float = 0) -> tuple[float, float, float, float]:
    """Lon/lat bbox of the crop in docs/terrain.md, expanded by buffer_metres."""
    return metres_bbox_to_lonlat(
        CROP_WEST - buffer_metres,
        CROP_SOUTH - buffer_metres,
        CROP_EAST + buffer_metres,
        CROP_NORTH + buffer_metres,
    )


def bbox_from_manifest(path: Path, buffer_metres: float = 0) -> tuple[float, float, float, float]:
    """Lon/lat bbox of a terrain manifest, expanded by buffer_metres.

    The manifest origin is the northwest cell centre. The box is the outer
    edge of the grid, which is what the OSM map API expects.
    """
    meta = json.loads(path.read_text(encoding="utf-8"))
    required = ("originEasting", "originNorthing", "columns", "rows", "stepMetres")
    missing = [key for key in required if key not in meta]
    if missing:
        raise ValueError(f"{path} is missing {', '.join(missing)}")
    origin_easting = float(meta["originEasting"])
    origin_northing = float(meta["originNorthing"])
    step = float(meta["stepMetres"])
    columns = int(meta["columns"])
    rows = int(meta["rows"])
    west = origin_easting - step / 2.0 - buffer_metres
    north = origin_northing + step / 2.0 + buffer_metres
    east = origin_easting + (columns - 1) * step + step / 2.0 + buffer_metres
    south = origin_northing - (rows - 1) * step - step / 2.0 - buffer_metres
    return metres_bbox_to_lonlat(west, south, east, north)


def origin_from_manifest(path: Path) -> Origin:
    """Read originEasting, originNorthing and originElevation from terrain.json."""
    meta = json.loads(path.read_text(encoding="utf-8"))
    missing = [key for key in ("originEasting", "originNorthing", "originElevation") if key not in meta]
    if missing:
        raise ValueError(f"{path} is missing {', '.join(missing)}")
    return Origin(
        easting=float(meta["originEasting"]),
        northing=float(meta["originNorthing"]),
        elevation=float(meta["originElevation"]),
        source="terrain-manifest",
    )


_TO_UTM = Transformer.from_crs("EPSG:4326", "EPSG:2955", always_xy=True)
_TO_WGS84 = Transformer.from_crs("EPSG:2955", "EPSG:4326", always_xy=True)


def project_lonlat(lon: float, lat: float) -> tuple[float, float]:
    """Return easting, northing in EPSG:2955. Axis order is easting then northing."""
    easting, northing = _TO_UTM.transform(lon, lat)
    return float(easting), float(northing)


def unproject(easting: float, northing: float) -> tuple[float, float]:
    lon, lat = _TO_WGS84.transform(easting, northing)
    return float(lon), float(lat)


def to_local(
    easting: float,
    northing: float,
    elevation: float | None,
    origin: Origin,
) -> tuple[float, float | None, float]:
    """Project an EPSG:2955 position into the game frame.

    x = easting - origin.easting
    z = origin.northing - northing
    y = elevation - origin.elevation, or None when elevation is unknown
    """
    x = easting - origin.easting
    z = origin.northing - northing
    y = None if elevation is None else elevation - origin.elevation
    return x, y, z


def to_projected(x: float, z: float, origin: Origin) -> tuple[float, float]:
    """Inverse of the horizontal part of to_local."""
    return origin.easting + x, origin.northing - z


def local_from_lonlat(
    lon: float,
    lat: float,
    origin: Origin,
    elevation: float | None = None,
) -> tuple[float, float | None, float]:
    easting, northing = project_lonlat(lon, lat)
    return to_local(easting, northing, elevation, origin)


def transform_metadata(origin: Origin) -> dict:
    return {
        "originEasting": origin.easting,
        "originNorthing": origin.northing,
        "originElevation": origin.elevation,
        "originSource": origin.source,
        "axes": "+X east, +Y up, +Z south",
        "formula": {
            "x": "easting - originEasting",
            "y": "elevation - originElevation",
            "z": "originNorthing - northing",
        },
    }
