"""Identifiers checked against OpenStreetMap and the terrain crop contract."""

# Closed way 1138569632 is landuse=winter_sports, name "Apex Mountain Resort".
BOUNDARY_WAY_ID = 1138569632

# Way 101303241 is aerialway=chair_lift, name "Quickdraw".
QUICKDRAW_WAY_ID = 101303241

# docs/terrain.md lists these Grandfather's Trail ways in downhill order.
# The terrain exporter keeps each way's node order and draws the ways in this sequence.
DOCUMENTED_DOWNHILL_NAME = "Grandfather's Trail"
DOCUMENTED_DOWNHILL_WAYS = (650891799, 374339391, 650891807)

# docs/terrain.md crop: E 286880–290100, N 5472800–5475440, 5 m cells.
# Sample [0, 0] is the northwest cell centre. Vertical origin is 1600 m CGVD2013.
CROP_WEST = 286880.0
CROP_SOUTH = 5472800.0
CROP_EAST = 290100.0
CROP_NORTH = 5475440.0
CELL_METRES = 5.0
VERTICAL_ORIGIN_METRES = 1600.0

# Search box around the verified resort boundary, padded past the default buffer.
# Peaks use a wider box so nearby named summits can be reported when they fall outside.
SEARCH_SOUTH = 49.368
SEARCH_WEST = -119.941
SEARCH_NORTH = 49.399
SEARCH_EAST = -119.885
PEAK_SOUTH = 49.34
PEAK_WEST = -119.98
PEAK_NORTH = 49.42
PEAK_EAST = -119.86

# Highway values treated as roads. Footways and paths are counted, then left out.
ROAD_CLASSES = frozenset({
    "motorway", "motorway_link",
    "trunk", "trunk_link",
    "primary", "primary_link",
    "secondary", "secondary_link",
    "tertiary", "tertiary_link",
    "unclassified", "residential", "living_street",
    "service", "track", "road",
    "busway", "pedestrian",
})

DEFAULT_BUFFER_METRES = 50.0
USER_AGENT = "SkiScrapex-osm-export/1.0 (local resort feature export)"
# Public Overpass interpreters. The export tries each one, then the main OSM map API.
OVERPASS_ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
)
# OSM API 0.6 map call. One small bbox, used only after Overpass fails.
MAP_ENDPOINT = "https://api.openstreetmap.org/api/0.6/map"
# The map API rejects a bbox larger than 0.25 square degrees.
MAP_MAX_SQUARE_DEGREES = 0.25
