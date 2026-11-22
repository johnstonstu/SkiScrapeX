import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from osm_export.geometry import (
    distance_to_polygon,
    line_within_buffer,
    point_in_ring,
    segments_intersect,
)

SQUARE = [(0, 0), (10, 0), (10, 10), (0, 10), (0, 0)]


class GeometryTests(unittest.TestCase):
    def test_point_in_ring_and_distance(self):
        self.assertTrue(point_in_ring(5, 5, SQUARE))
        self.assertFalse(point_in_ring(15, 5, SQUARE))
        self.assertEqual(distance_to_polygon((5, 5), SQUARE), 0)
        self.assertAlmostEqual(distance_to_polygon((12, 5), SQUARE), 2)

    def test_crossing_segment_and_buffer(self):
        self.assertTrue(segments_intersect((-1, 5), (5, 5), (0, 0), (0, 10)))
        self.assertTrue(line_within_buffer([(-5, 5), (5, 5)], SQUARE, [], 0))
        self.assertTrue(line_within_buffer([(12, 5), (12, 8)], SQUARE, [], 3))
        self.assertFalse(line_within_buffer([(12, 5), (12, 8)], SQUARE, [], 1))
        self.assertFalse(line_within_buffer([(20, 20), (22, 20)], SQUARE, [], 5))


if __name__ == "__main__":
    unittest.main()
