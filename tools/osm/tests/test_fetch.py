import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import requests

from osm_export.assemble import build_features, validate_document
from osm_export.checks import feature_problems
from osm_export.constants import MAP_ENDPOINT, MAP_MAX_SQUARE_DEGREES, OVERPASS_ENDPOINTS, QUICKDRAW_WAY_ID
from osm_export.export import main
from osm_export.overpass import fetch_osm_map, fetch_resort, normalize_elements, parse_osm_map
from osm_export.transform import bbox_from_manifest, documented_crop_bbox, documented_origin, unproject


FALLBACK = Path(__file__).resolve().parents[1] / "fallback" / "features.json"

MAP_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="test" copyright="OpenStreetMap and contributors" license="https://opendatacommons.org/licenses/odbl/1-0/">
  <bounds minlat="49.37" minlon="-119.95" maxlat="49.40" maxlon="-119.90"/>
  <node id="1" lat="49.370" lon="-119.950" version="1" timestamp="2026-11-22T17:00:00Z"/>
  <node id="2" lat="49.370" lon="-119.900" version="1" timestamp="2026-11-22T17:00:01Z"/>
  <node id="3" lat="49.400" lon="-119.900" version="1"/>
  <node id="4" lat="49.400" lon="-119.950" version="1"/>
  <node id="10" lat="49.380" lon="-119.920" version="3" timestamp="2026-11-22T16:00:00Z">
    <tag k="aerialway" v="station"/>
  </node>
  <way id="1138569632" version="2">
    <nd ref="1"/>
    <nd ref="2"/>
    <nd ref="3"/>
    <nd ref="4"/>
    <nd ref="1"/>
    <tag k="landuse" v="winter_sports"/>
    <tag k="name" v="Apex Mountain Resort"/>
  </way>
  <way id="101303241" version="4">
    <nd ref="1"/>
    <nd ref="10"/>
    <tag k="aerialway" v="chair_lift"/>
    <tag k="name" v="Quickdraw"/>
  </way>
  <relation id="9">
    <member type="way" ref="1138569632" role="outer"/>
    <tag k="type" v="multipolygon"/>
  </relation>
</osm>
"""


class MapXmlTests(unittest.TestCase):
    def test_map_xml_becomes_overpass_elements(self):
        payload = parse_osm_map(MAP_XML)
        data = normalize_elements(payload)
        self.assertEqual(data["nodes"][10]["tags"]["aerialway"], "station")
        self.assertEqual(data["ways"][QUICKDRAW_WAY_ID]["nodes"], [1, 10])
        self.assertEqual(data["relations"][9]["members"][0]["role"], "outer")
        self.assertIn("ODbL", data["copyright"])
        self.assertEqual(data["osmTimestamp"], "2026-11-22T16:00:00Z")

        document = build_features(data, documented_origin(), buffer_metres=50, fetch={
            "api": "OSM API 0.6 map",
            "endpoint": MAP_ENDPOINT,
            "retrievedAt": "2026-11-22T17:00:00Z",
            "querySha256": None,
            "fromCache": False,
            "queries": [],
        })
        self.assertEqual(validate_document(document), [])
        self.assertEqual(document["source"]["api"], "OSM API 0.6 map")
        self.assertEqual(document["source"]["endpoint"], MAP_ENDPOINT)
        self.assertTrue(document["verification"]["resortBoundary"]["found"])
        self.assertTrue(document["verification"]["quickdraw"]["found"])

    def test_map_error_document_is_rejected(self):
        with self.assertRaises(ValueError):
            parse_osm_map(b"<osm><error>bbox too large</error></osm>")
        with self.assertRaises(ValueError):
            parse_osm_map(b"<error><message>gone</message></error>")


class BboxTests(unittest.TestCase):
    def test_documented_crop_fits_the_map_api_and_covers_the_origin(self):
        west, south, east, north = documented_crop_bbox(50)
        self.assertLess(west, east)
        self.assertLess(south, north)
        self.assertLess((east - west) * (north - south), MAP_MAX_SQUARE_DEGREES)
        lon, lat = unproject(286882.5, 5475437.5)
        self.assertLess(west, lon)
        self.assertLess(lon, east)
        self.assertLess(south, lat)
        self.assertLess(lat, north)

    def test_manifest_bbox_matches_the_documented_crop(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "terrain.json"
            path.write_text(json.dumps({
                "originEasting": 286882.5,
                "originNorthing": 5475437.5,
                "originElevation": 1600,
                "columns": 644,
                "rows": 528,
                "stepMetres": 5,
            }), encoding="utf-8")
            self.assertEqual(bbox_from_manifest(path, 50), documented_crop_bbox(50))


class FetchFallbackTests(unittest.TestCase):
    def test_mirrors_and_map_endpoint_are_configured(self):
        self.assertGreaterEqual(len(OVERPASS_ENDPOINTS), 3)
        self.assertIn("https://overpass-api.de/api/interpreter", OVERPASS_ENDPOINTS)
        self.assertIn("https://overpass.kumi.systems/api/interpreter", OVERPASS_ENDPOINTS)
        self.assertTrue(MAP_ENDPOINT.endswith("/api/0.6/map"))

    def test_overpass_failure_uses_the_map_api(self):
        class Response:
            status_code = 200
            content = MAP_XML
            text = MAP_XML.decode("utf-8")

        with tempfile.TemporaryDirectory() as tmp:
            with patch("osm_export.overpass.requests.post", side_effect=requests.ConnectionError("busy")):
                with patch("osm_export.overpass.requests.get", return_value=Response()) as get:
                    payload, fetch = fetch_resort(
                        Path(tmp),
                        endpoints=("https://overpass.example/api/interpreter",),
                        attempts=1,
                        backoff=0,
                        timeout=1,
                        map_bbox=(-119.95, 49.37, -119.90, 49.40),
                    )
        self.assertEqual(payload["elements"][0]["type"], "node")
        self.assertEqual(fetch["api"], "OSM API 0.6 map")
        self.assertEqual(fetch["endpoint"], MAP_ENDPOINT)
        self.assertIn("ODbL", payload["osm3s"]["copyright"])
        args, kwargs = get.call_args
        self.assertEqual(args[0], MAP_ENDPOINT)
        self.assertIn("bbox", kwargs["params"])

    def test_map_api_can_be_called_directly(self):
        class Response:
            status_code = 200
            content = MAP_XML
            text = ""

        with patch("osm_export.overpass.requests.get", return_value=Response()):
            payload, fetch = fetch_osm_map((-119.95, 49.37, -119.90, 49.40), attempts=1, backoff=0, timeout=1)
        self.assertEqual(fetch["bbox"][0], -119.95)
        self.assertGreaterEqual(len(payload["elements"]), 4)

    def test_export_writes_the_committed_cache_when_downloads_fail(self):
        self.assertTrue(FALLBACK.is_file())
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "out" / "features.json"
            with patch("osm_export.overpass.time.sleep"):
                with patch("osm_export.overpass.requests.post", side_effect=requests.ConnectionError("down")):
                    code = main([
                        "--no-map-fallback",
                        "--endpoint", "http://127.0.0.1:9/api/interpreter",
                        "--retry-attempts", "1",
                        "--retry-backoff", "0",
                        "--documented-origin",
                        "--no-heights",
                        "--cache-dir", str(Path(tmp) / "cache"),
                        "--output", str(output),
                        "--fallback", str(FALLBACK),
                    ])
            self.assertEqual(code, 0)
            self.assertEqual(output.read_bytes(), FALLBACK.read_bytes())

    def test_export_fails_when_fallback_is_disabled_and_unusable(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "features.json"
            with patch("osm_export.overpass.requests.post", side_effect=requests.ConnectionError("down")):
                code = main([
                    "--no-map-fallback",
                    "--no-fallback",
                    "--endpoint", "http://127.0.0.1:9/api/interpreter",
                    "--retry-attempts", "1",
                    "--retry-backoff", "0",
                    "--documented-origin",
                    "--no-heights",
                    "--cache-dir", str(Path(tmp) / "cache"),
                    "--output", str(output),
                ])
            self.assertEqual(code, 1)
            self.assertFalse(output.exists())


class CommittedFallbackTests(unittest.TestCase):
    def test_committed_fallback_passes_schema_and_publish_checks(self):
        document = json.loads(FALLBACK.read_text(encoding="utf-8"))
        self.assertEqual(validate_document(document), [])
        self.assertEqual(feature_problems(document), [])
        self.assertEqual(document["generator"], "ski-scrapex-osm-export")
        self.assertEqual(document["version"], 1)
        self.assertEqual(document["counts"]["lifts"], 4)
        self.assertEqual(document["counts"]["buildings"], 147)
        self.assertEqual(document["counts"]["towers"], 31)
        self.assertGreater(document["counts"]["runs"], 0)
        self.assertEqual(
            {lift["name"] for lift in document["lifts"]},
            {"Magic Carpet", "Quickdraw", "Stock's Chiar", "T-Bar"},
        )
        self.assertEqual(document["transform"]["originEasting"], 286882.5)
        self.assertEqual(document["transform"]["originNorthing"], 5475437.5)
        self.assertEqual(document["transform"]["originElevation"], 1600)
        self.assertEqual(document["source"]["endpoint"], "api.openstreetmap.org/api/0.6/map")
        self.assertIn("OpenStreetMap", document["source"]["attribution"])
        self.assertIn("ODbL", document["source"]["license"])
        self.assertIn("ODbL", document["source"]["copyright"])
        self.assertTrue(document["verification"]["resortBoundary"]["found"])
        self.assertTrue(document["verification"]["quickdraw"]["found"])
        self.assertTrue(document["heights"]["attached"])
        point = document["runs"][0]["members"][0]["points"][0]
        self.assertIsInstance(point["y"], float)

    def test_feature_problems_reject_an_empty_resort(self):
        self.assertTrue(any("buildings" in problem for problem in feature_problems({
            "counts": {"buildings": 0, "lifts": 4},
            "source": {"attribution": "© OpenStreetMap contributors", "license": "ODbL-1.0"},
        })))
        self.assertTrue(any("lifts" in problem for problem in feature_problems({
            "counts": {"buildings": 3, "lifts": 3},
            "source": {"attribution": "© OpenStreetMap contributors", "license": "ODbL-1.0"},
        })))

    def test_check_script_accepts_the_fallback_and_rejects_a_missing_file(self):
        import importlib.util
        script = Path(__file__).resolve().parents[1] / "check_features.py"
        spec = importlib.util.spec_from_file_location("check_features", script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertEqual(module.main([str(FALLBACK)]), 0)
        self.assertEqual(module.main([str(FALLBACK.parent / "missing.json")]), 1)
