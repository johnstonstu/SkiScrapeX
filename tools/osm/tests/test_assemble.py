import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from osm_export.assemble import build_features, summarize, validate_document
from osm_export.constants import DOCUMENTED_DOWNHILL_WAYS, QUICKDRAW_WAY_ID
from osm_export.overpass import normalize_elements, overpass_queries
from osm_export.transform import documented_origin


def node(osm_id, lon, lat, **tags):
    element = {"type": "node", "id": osm_id, "lon": lon, "lat": lat}
    if tags:
        element["tags"] = tags
    return element


def way(osm_id, node_ids, **tags):
    return {"type": "way", "id": osm_id, "nodes": list(node_ids), "tags": tags}


def dataset(*elements):
    return normalize_elements({
        "osm3s": {
            "timestamp_osm_base": "2026-01-01T00:00:00Z",
            "copyright": "The data included in this document is from www.openstreetmap.org. The data is made available under ODbL.",
        },
        "elements": list(elements),
    })


BOUNDARY = way(
    1138569632,
    [1, 2, 3, 4, 1],
    landuse="winter_sports",
    name="Apex Mountain Resort",
)
BOUNDARY_NODES = [
    node(1, -119.95, 49.37),
    node(2, -119.90, 49.37),
    node(3, -119.90, 49.40),
    node(4, -119.95, 49.40),
]


class NormalizeTests(unittest.TestCase):
    def test_queries_are_split_and_name_the_boundary(self):
        queries = dict(overpass_queries())
        self.assertEqual(set(queries), {"resort", "buildings", "highways"})
        self.assertIn("way(1138569632)", queries["resort"])
        self.assertIn('way["building"]', queries["buildings"])
        self.assertIn('way["highway"]', queries["highways"])
        self.assertNotIn("building", queries["resort"])

    def test_body_tags_survive_a_later_skeleton_copy(self):
        data = dataset(
            node(10, -119.92, 49.38, aerialway="station"),
            node(10, -119.92, 49.38),
            way(20, [10], name="Kept"),
        )
        self.assertEqual(data["nodes"][10]["tags"]["aerialway"], "station")
        self.assertEqual(data["nodes"][10]["lat"], 49.38)
        self.assertEqual(data["ways"][20]["nodes"], [10])


class AssembleTests(unittest.TestCase):
    def test_grandfather_order_lifts_and_filters(self):
        elements = [
            *BOUNDARY_NODES,
            BOUNDARY,
            node(100, -119.920, 49.380),
            node(110, -119.925, 49.382),
            node(101, -119.930, 49.384),
            node(111, -119.928, 49.387),
            node(102, -119.925, 49.390),
            node(112, -119.918, 49.391),
            node(103, -119.910, 49.392),
            way(650891807, [102, 112, 103], name="Grandfather's Trail", **{"piste:type": "downhill", "piste:difficulty": "easy"}),
            way(374339391, [101, 111, 102], name="Grandfather's Trail", **{"piste:type": "downhill", "piste:difficulty": "easy"}),
            way(650891799, [100, 110, 101], name="Grandfather's Trail", **{"piste:type": "downhill", "piste:difficulty": "easy"}),
            node(200, -119.910, 49.381, aerialway="station"),
            node(201, -119.912, 49.383, aerialway="pylon"),
            node(202, -119.914, 49.385, aerialway="pylon"),
            node(203, -119.916, 49.387, aerialway="station"),
            way(QUICKDRAW_WAY_ID, [200, 201, 202, 203], name="Quickdraw", aerialway="chair_lift"),
            node(300, -119.905, 49.388),
            node(301, -119.908, 49.386),
            way(50, [300, 301], name="T-Bar", aerialway="t-bar"),
            way(60, [300, 301], name="Stock's Chiar", aerialway="chair_lift"),
            node(700, -119.922, 49.378),
            node(701, -119.922, 49.379),
            way(70, [700, 701], name="Dude ney Trail", **{"piste:type": "downhill", "piste:difficulty": "easy"}),
            node(800, -119.918, 49.376),
            node(801, -119.918, 49.377),
            node(802, -119.917, 49.378),
            node(803, -119.916, 49.379),
            node(804, -119.915, 49.380),
            way(81, [802, 803, 804], name="Village Traverse", **{"piste:type": "downhill", "piste:difficulty": "easy"}),
            way(80, [800, 801, 802], name="Village Traverse", **{"piste:type": "downhill", "piste:difficulty": "easy"}),
            node(501, -119.915, 49.381),
            node(502, -119.915, 49.383),
            node(500, -119.915, 49.385),
            node(503, -119.916, 49.381),
            node(504, -119.9155, 49.383),
            way(601, [503, 504, 500], name="Juniper", **{"piste:type": "downhill", "piste:difficulty": "intermediate"}),
            way(600, [501, 502, 500], name="Juniper", **{"piste:type": "downhill", "piste:difficulty": "intermediate"}),
            node(900, -119.930, 49.386),
            node(901, -119.929, 49.387),
            node(902, -119.928, 49.388),
            way(90, [900, 901, 902], name="Boarder Cross", **{"piste:type": "snow_park", "piste:difficulty": "advanced"}),
            way(400, [410, 411, 412, 413, 410], building="yes", name="Day Lodge"),
            node(410, -119.904, 49.386),
            node(411, -119.904, 49.3862),
            node(412, -119.9038, 49.3862),
            node(413, -119.9038, 49.386),
            way(401, [420, 421, 422, 423, 420], building="yes", name="Far Away"),
            node(420, -119.70, 49.50),
            node(421, -119.70, 49.501),
            node(422, -119.699, 49.501),
            node(423, -119.699, 49.50),
            way(430, [4301, 4302], highway="service", name="Resort Road"),
            node(4301, -119.906, 49.387),
            node(4302, -119.907, 49.388),
            way(431, [4311, 4312], highway="footway"),
            node(4311, -119.906, 49.389),
            node(4312, -119.907, 49.3895),
            node(1859465627, -119.915, 49.382, natural="peak", name="Beaconsfield Mountain", ele="2247"),
            node(12240219025, -119.910, 49.20, natural="peak", name="Apex Mountain", ele="2247"),
        ]
        document = build_features(dataset(*elements), documented_origin(), buffer_metres=50)
        self.assertEqual(validate_document(document), [])

        grandfather = next(run for run in document["runs"] if run["name"] == "Grandfather's Trail")
        self.assertEqual(
            [member["osmId"] for member in grandfather["members"]],
            list(DOCUMENTED_DOWNHILL_WAYS),
        )
        self.assertTrue(grandfather["orderedDownhill"])
        self.assertEqual(grandfather["orderSource"], "documented-way-sequence")
        self.assertEqual(grandfather["difficulty"], "easy")
        self.assertEqual(grandfather["geometry"], "line")
        self.assertEqual(grandfather["points"][0]["osmId"], 100)
        self.assertEqual(grandfather["points"][-1]["osmId"], 103)
        self.assertIsNone(grandfather["points"][0]["y"])

        village = next(run for run in document["runs"] if run["name"] == "Village Traverse")
        self.assertEqual(village["topology"], "path")
        self.assertEqual([member["osmId"] for member in village["members"]], [80, 81])
        self.assertFalse(village["orderedDownhill"])
        self.assertEqual(village["orderSource"], "openstreetmap")

        juniper = next(run for run in document["runs"] if run["name"] == "Juniper")
        self.assertEqual(juniper["topology"], "branches")
        self.assertFalse(juniper["orderedDownhill"])
        self.assertNotIn("points", juniper)

        quickdraw = next(lift for lift in document["lifts"] if lift["osmId"] == QUICKDRAW_WAY_ID)
        self.assertEqual([station["osmId"] for station in quickdraw["stations"]], [200, 203])
        self.assertEqual([station["role"] for station in quickdraw["stations"]], ["start", "end"])
        self.assertFalse(any(station["inferred"] for station in quickdraw["stations"]))
        self.assertEqual([tower["osmId"] for tower in quickdraw["towers"]], [201, 202])
        self.assertEqual([tower["index"] for tower in quickdraw["towers"]], [0, 1])
        self.assertEqual([point["kind"] for point in quickdraw["line"]], ["station", "pylon", "pylon", "station"])

        t_bar = next(lift for lift in document["lifts"] if lift["name"] == "T-Bar")
        self.assertEqual(len(t_bar["stations"]), 2)
        self.assertTrue(all(station["inferred"] for station in t_bar["stations"]))
        self.assertEqual(t_bar["towers"], [])

        self.assertEqual([park["name"] for park in document["terrainParks"]], ["Boarder Cross"])
        self.assertEqual(document["terrainParks"][0]["geometry"], "line")
        self.assertEqual([building["osmId"] for building in document["buildings"]], [400])
        self.assertEqual([road["osmId"] for road in document["roads"]], [430])
        self.assertEqual(document["quality"]["highwaysSkipped"], {"footway": 1})
        self.assertEqual([peak["name"] for peak in document["peaks"]], ["Beaconsfield Mountain"])
        self.assertEqual(document["peaks"][0]["ele"], 2247)
        self.assertIsNone(document["peaks"][0]["y"])
        self.assertEqual(document["quality"]["peaksOutsideBuffer"][0]["name"], "Apex Mountain")
        self.assertIn("Stock's Chiar", " ".join(document["quality"]["nameNotes"]))
        self.assertIn("Dude ney Trail", " ".join(document["quality"]["nameNotes"]))
        self.assertIn("Stock's Chiar", summarize(document))
        self.assertTrue(document["verification"]["resortBoundary"]["found"])
        self.assertTrue(document["verification"]["quickdraw"]["found"])
        # Node 200 is east and south of node 203, so it has a larger X and a larger Z.
        self.assertGreater(quickdraw["stations"][0]["x"], quickdraw["stations"][1]["x"])
        self.assertGreater(quickdraw["stations"][0]["z"], quickdraw["stations"][1]["z"])

    def test_height_grid_orients_a_run_and_can_disagree_with_the_documented_order(self):
        elements = [
            *BOUNDARY_NODES,
            BOUNDARY,
            node(100, -119.920, 49.380),
            node(101, -119.925, 49.384),
            node(102, -119.920, 49.388),
            node(103, -119.910, 49.392),
            way(650891799, [100, 101], name="Grandfather's Trail", **{"piste:type": "downhill", "piste:difficulty": "easy"}),
            way(374339391, [101, 102], name="Grandfather's Trail", **{"piste:type": "downhill", "piste:difficulty": "easy"}),
            way(650891807, [102, 103], name="Grandfather's Trail", **{"piste:type": "downhill", "piste:difficulty": "easy"}),
            node(710, -119.930, 49.381),
            node(711, -119.930, 49.386),
            way(71, [710, 711], name="Chute", **{"piste:type": "downhill", "piste:difficulty": "advanced"}),
        ]

        class NorthIsHigher:
            def sample(self, x, z, origin):
                return -z

        document = build_features(
            dataset(*elements), documented_origin(), sampler=NorthIsHigher(), buffer_metres=50,
        )
        grandfather = document["runs"][0] if document["runs"][0]["name"] == "Grandfather's Trail" else next(
            run for run in document["runs"] if run["name"] == "Grandfather's Trail"
        )
        self.assertEqual(
            [member["osmId"] for member in grandfather["members"]],
            list(DOCUMENTED_DOWNHILL_WAYS),
        )
        self.assertTrue(grandfather["downhillContradiction"])
        self.assertEqual(grandfather["orderSource"], "documented-way-sequence")
        chute = next(run for run in document["runs"] if run["name"] == "Chute")
        self.assertTrue(chute["orderedDownhill"])
        self.assertEqual(chute["orderSource"], "height-grid")
        self.assertEqual(chute["points"][0]["osmId"], 711)
        self.assertEqual(chute["points"][-1]["osmId"], 710)
        self.assertGreater(chute["points"][0]["y"], chute["points"][-1]["y"])

    def test_sample_document_matches_the_schema(self):
        sample_path = Path(__file__).resolve().parents[1] / "sample" / "features.sample.json"
        document = json.loads(sample_path.read_text(encoding="utf-8"))
        self.assertEqual(validate_document(document), [])
        origin_easting = document["transform"]["originEasting"]
        origin_northing = document["transform"]["originNorthing"]
        point = document["runs"][0]["points"][0]
        from osm_export.transform import Origin, to_local, to_projected
        origin = Origin(origin_easting, origin_northing, document["transform"]["originElevation"])
        easting, northing = to_projected(point["x"], point["z"], origin)
        x, y, z = to_local(easting, northing, None, origin)
        self.assertAlmostEqual(x, point["x"], places=2)
        self.assertAlmostEqual(z, point["z"], places=2)
        self.assertIsNone(y)
        self.assertIsNone(point["y"])
        self.assertEqual(len(document["lifts"][0]["stations"]), 2)
        self.assertEqual(len(document["lifts"][0]["towers"]), 1)


if __name__ == "__main__":
    unittest.main()
