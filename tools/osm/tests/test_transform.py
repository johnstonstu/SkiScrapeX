import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from osm_export.constants import CELL_METRES, CROP_NORTH, CROP_WEST, VERTICAL_ORIGIN_METRES
from osm_export.transform import (
    documented_origin,
    local_from_lonlat,
    origin_from_manifest,
    project_lonlat,
    to_local,
    to_projected,
    unproject,
)


class TransformTests(unittest.TestCase):
    def test_documented_origin_is_the_northwest_cell_centre(self):
        origin = documented_origin()
        self.assertEqual(origin.easting, CROP_WEST + CELL_METRES / 2)
        self.assertEqual(origin.northing, CROP_NORTH - CELL_METRES / 2)
        self.assertEqual(origin.elevation, VERTICAL_ORIGIN_METRES)
        self.assertEqual(origin.easting, 286882.5)
        self.assertEqual(origin.northing, 5475437.5)
        self.assertEqual(origin.elevation, 1600.0)

    def test_origin_is_local_zero_and_axes_point_east_up_and_south(self):
        origin = documented_origin()
        x, y, z = to_local(origin.easting, origin.northing, origin.elevation, origin)
        self.assertEqual((x, y, z), (0.0, 0.0, 0.0))

        x_east, y_east, z_east = to_local(origin.easting + 25, origin.northing, None, origin)
        self.assertEqual((x_east, z_east), (25.0, 0.0))
        self.assertIsNone(y_east)

        x_north, y_north, z_north = to_local(
            origin.easting, origin.northing + 40, origin.elevation + 15, origin,
        )
        self.assertEqual((x_north, y_north, z_north), (0.0, 15.0, -40.0))

        _, _, z_south = to_local(origin.easting, origin.northing - 8, origin.elevation, origin)
        self.assertEqual(z_south, 8.0)

    def test_horizontal_round_trip(self):
        origin = documented_origin()
        lon, lat = -119.91, 49.385
        easting, northing = project_lonlat(lon, lat)
        x, y, z = to_local(easting, northing, 1742.25, origin)
        back_easting, back_northing = to_projected(x, z, origin)
        self.assertAlmostEqual(back_easting, easting, places=6)
        self.assertAlmostEqual(back_northing, northing, places=6)
        back_lon, back_lat = unproject(back_easting, back_northing)
        self.assertAlmostEqual(back_lon, lon, places=9)
        self.assertAlmostEqual(back_lat, lat, places=9)
        self.assertAlmostEqual(y, 1742.25 - origin.elevation)

    def test_projection_axis_direction_near_apex(self):
        origin = documented_origin()
        easting, northing = project_lonlat(-119.9, 49.39)
        easting_east, northing_east = project_lonlat(-119.899, 49.39)
        easting_north, northing_north = project_lonlat(-119.9, 49.391)
        self.assertGreater(easting_east, easting)
        self.assertGreater(northing_north, northing)

        x, _, z = to_local(easting, northing, None, origin)
        x_east, _, z_east = to_local(easting_east, northing_east, None, origin)
        x_north, _, z_north = to_local(easting_north, northing_north, None, origin)
        self.assertGreater(x_east, x)
        self.assertLess(z_north, z)
        # A longitude step is mostly east, and a latitude step is mostly north.
        self.assertGreater(x_east - x, abs(z_east - z) * 5)
        self.assertGreater(z - z_north, abs(x_north - x) * 5)

    def test_known_lonlat_projects_to_stable_utm(self):
        easting, northing = project_lonlat(-119.9, 49.39)
        self.assertAlmostEqual(easting, 289562.427, delta=0.05)
        self.assertAlmostEqual(northing, 5474855.583, delta=0.05)

    def test_custom_origin_shifts_the_local_frame(self):
        base = documented_origin()
        shifted_easting = base.easting + 10
        shifted_northing = base.northing - 5
        from osm_export.transform import Origin
        shifted = Origin(shifted_easting, shifted_northing, 1500.0, source="command-line")
        x, y, z = to_local(base.easting, base.northing, 1600.0, shifted)
        self.assertEqual((x, y, z), (-10.0, 100.0, -5.0))
        again = local_from_lonlat(-119.9, 49.39, shifted, elevation=None)
        direct = to_local(*project_lonlat(-119.9, 49.39), None, shifted)
        self.assertIsNone(again[1])
        self.assertAlmostEqual(again[0], direct[0], places=6)
        self.assertAlmostEqual(again[2], direct[2], places=6)

    def test_origin_from_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "terrain.json"
            path.write_text(json.dumps({
                "originEasting": 10,
                "originNorthing": 20,
                "originElevation": 30,
            }), encoding="utf-8")
            origin = origin_from_manifest(path)
        self.assertEqual((origin.easting, origin.northing, origin.elevation), (10.0, 20.0, 30.0))
        self.assertEqual(origin.source, "terrain-manifest")


if __name__ == "__main__":
    unittest.main()
