import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from osm_export.heights import HeightGrid, load_height_grid, sample_grid
from osm_export.transform import Origin


class HeightGridTests(unittest.TestCase):
    def setUp(self):
        # 2 by 2 samples, 10 m apart. Values are already relative to the grid origin.
        # a -- b
        # |    |
        # c -- d
        self.heights = [0.0, 10.0, 30.0, 40.0]
        self.meta = {
            "columns": 2,
            "rows": 2,
            "stepMetres": 10.0,
            "originEasting": 1000.0,
            "originNorthing": 2000.0,
            "originElevation": 1600.0,
            "heightEncoding": "float32-le",
        }

    def test_samples_match_the_terrain_renderer_diagonal(self):
        self.assertEqual(sample_grid(0, 0, 2, 2, 10, self.heights), 0)
        self.assertEqual(sample_grid(10, 0, 2, 2, 10, self.heights), 10)
        self.assertEqual(sample_grid(0, 10, 2, 2, 10, self.heights), 30)
        self.assertEqual(sample_grid(10, 10, 2, 2, 10, self.heights), 40)
        # Upper triangle: u = v = 0.25, height = 0 + 0.25*10 + 0.25*30.
        self.assertAlmostEqual(sample_grid(2.5, 2.5, 2, 2, 10, self.heights), 10)
        # Lower triangle: u = v = 0.75.
        self.assertAlmostEqual(sample_grid(7.5, 7.5, 2, 2, 10, self.heights), 30)
        self.assertIsNone(sample_grid(-0.01, 0, 2, 2, 10, self.heights))
        self.assertIsNone(sample_grid(0, 10.01, 2, 2, 10, self.heights))

    def test_vertical_origin_and_horizontal_shift(self):
        grid = HeightGrid(self.meta, self.heights, Path("terrain.json"), Path("heights.f32"))
        same = Origin(1000, 2000, 1600)
        self.assertAlmostEqual(grid.sample(0, 0, same), 0)
        self.assertAlmostEqual(grid.sample(2.5, 2.5, same), 10)
        lower_origin = Origin(1000, 2000, 1500)
        self.assertAlmostEqual(grid.sample(0, 0, lower_origin), 100)
        # Game origin 10 m west of the grid, so local x=10 is the grid's northwest corner.
        moved = Origin(990, 2000, 1600)
        self.assertAlmostEqual(grid.sample(10, 0, moved), 0)
        self.assertIsNone(grid.sample(-1, 0, same))

    def test_load_little_endian_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / "terrain.json"
            heights = root / "heights.f32"
            manifest.write_text(json_dumps(self.meta), encoding="utf-8")
            heights.write_bytes(struct.pack("<4f", *self.heights))
            grid = load_height_grid(manifest, heights)
        self.assertAlmostEqual(grid.sample(10, 10, Origin(1000, 2000, 1600)), 40)


def json_dumps(value) -> str:
    import json
    return json.dumps(value)


if __name__ == "__main__":
    unittest.main()
