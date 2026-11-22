"""Command line export of Apex OpenStreetMap features."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .assemble import build_features, summarize, validate_document
from .checks import feature_problems
from .constants import DEFAULT_BUFFER_METRES, MAP_ENDPOINT, OVERPASS_ENDPOINTS
from .heights import load_height_grid
from .overpass import fetch_resort, normalize_elements
from .transform import Origin, bbox_from_manifest, documented_crop_bbox, documented_origin, origin_from_manifest


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def tool_root() -> Path:
    return Path(__file__).resolve().parents[1]


def default_fallback() -> Path:
    return tool_root() / "fallback" / "features.json"


def display_path(path: Path) -> str:
    resolved = path.resolve()
    try:
        return str(resolved.relative_to(repo_root()))
    except ValueError:
        return str(resolved)


def resolve_origin(args) -> Origin:
    """Documented crop origin, unless a terrain manifest or explicit flags replace it."""
    manifest = args.manifest
    if manifest is None and not args.documented_origin:
        default = repo_root() / "terrain" / "generated" / "terrain.json"
        if default.exists():
            manifest = default
    if args.documented_origin or manifest is None:
        origin = documented_origin()
    else:
        if not manifest.exists():
            raise SystemExit(f"Terrain manifest not found: {manifest}")
        origin = origin_from_manifest(manifest)
    overridden = any(
        value is not None
        for value in (args.origin_easting, args.origin_northing, args.origin_elevation)
    )
    if not overridden:
        return origin
    return Origin(
        easting=origin.easting if args.origin_easting is None else args.origin_easting,
        northing=origin.northing if args.origin_northing is None else args.origin_northing,
        elevation=origin.elevation if args.origin_elevation is None else args.origin_elevation,
        source="command-line",
    )


def height_source(args, origin: Origin):
    if args.no_heights:
        return None, {"attached": False, "source": None}
    manifest = args.manifest
    if manifest is None:
        default = repo_root() / "terrain" / "generated" / "terrain.json"
        manifest = default if default.exists() else None
    if manifest is None or not manifest.exists():
        return None, {"attached": False, "source": None}
    heights = args.heights or manifest.parent / "heights.f32"
    if not heights.exists():
        print(f"warning: {display_path(manifest)} has no heights.f32 beside it", file=sys.stderr)
        return None, {"attached": False, "source": None, "manifest": display_path(manifest)}
    try:
        grid = load_height_grid(manifest, heights)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"warning: height grid was not used ({exc})", file=sys.stderr)
        return None, {"attached": False, "source": None}
    meta = {
        "attached": True,
        "source": display_path(heights),
        "manifest": display_path(manifest),
        "columns": grid.columns,
        "rows": grid.rows,
        "stepMetres": grid.step_metres,
        "gridOriginEasting": grid.origin_easting,
        "gridOriginNorthing": grid.origin_northing,
        "gridOriginElevation": grid.origin_elevation,
        "verticalDatum": "CGVD2013",
        "note": (
            "Sampled Y uses the terrain grid's CGVD2013 heights, converted into "
            f"the export vertical origin at {origin.elevation} m."
        ),
    }
    return grid, meta


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Export Apex Mountain Resort runs, lifts, buildings, roads and peaks "
            "from OpenStreetMap into the game's local metre frame."
        )
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=tool_root() / "generated" / "features.json",
        help="where to write features.json (default: tools/osm/generated/features.json)",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=tool_root() / "cache",
        help="directory for the raw Overpass response",
    )
    parser.add_argument("--refresh", action="store_true", help="ignore the cached Overpass response")
    parser.add_argument(
        "--endpoint",
        action="append",
        dest="endpoints",
        help="Overpass interpreter URL; may be repeated. Defaults to the public mirrors.",
    )
    parser.add_argument(
        "--no-map-fallback",
        action="store_true",
        help="do not call api.openstreetmap.org/api/0.6/map when every Overpass mirror fails",
    )
    parser.add_argument(
        "--map-endpoint",
        default=MAP_ENDPOINT,
        help="OSM map API URL used after Overpass fails (default: the main api.openstreetmap.org map call)",
    )
    parser.add_argument(
        "--fallback",
        type=Path,
        default=None,
        help=(
            "features.json to write when the download fails. "
            "Defaults to tools/osm/fallback/features.json when that file is present."
        ),
    )
    parser.add_argument(
        "--no-fallback",
        action="store_true",
        help="fail the export when the download fails, instead of writing the committed cache",
    )
    parser.add_argument("--retry-attempts", type=int, default=2, help="tries per Overpass mirror and for the map API")
    parser.add_argument("--retry-backoff", type=float, default=3, help="seconds times the attempt number between retries")
    parser.add_argument(
        "--manifest",
        type=Path,
        help="terrain.json to take the origin from, and to sample when heights.f32 is beside it",
    )
    parser.add_argument("--heights", type=Path, help="heights.f32 to sample; defaults to the manifest's sibling")
    parser.add_argument(
        "--documented-origin",
        action="store_true",
        help="use the crop origin from docs/terrain.md even when terrain/generated/terrain.json exists",
    )
    parser.add_argument("--origin-easting", type=float, help="override origin easting in EPSG:2955")
    parser.add_argument("--origin-northing", type=float, help="override origin northing in EPSG:2955")
    parser.add_argument("--origin-elevation", type=float, help="override the vertical origin in metres")
    parser.add_argument(
        "--buffer-metres",
        type=float,
        default=DEFAULT_BUFFER_METRES,
        help="include buildings, roads and nearby features within this many metres of the resort boundary",
    )
    parser.add_argument("--no-heights", action="store_true", help="leave every Y null")
    return parser.parse_args(argv)


def resolve_map_bbox(args) -> tuple[float, float, float, float]:
    """Bbox for the OSM map API: the terrain manifest, or the documented crop."""
    manifest = args.manifest
    if manifest is None and not args.documented_origin:
        default = repo_root() / "terrain" / "generated" / "terrain.json"
        if default.exists():
            manifest = default
    if manifest is not None and manifest.exists() and not args.documented_origin:
        return bbox_from_manifest(manifest, args.buffer_metres)
    return documented_crop_bbox(args.buffer_metres)


def chosen_fallback(args) -> Path | None:
    if args.no_fallback:
        return None
    path = args.fallback if args.fallback is not None else default_fallback()
    return path if path.exists() else None


def publish_fallback(path: Path, output: Path) -> int:
    """Copy a committed features.json after it passes the same checks as a fresh export."""
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Cached features could not be read: {exc}", file=sys.stderr)
        return 1
    errors = validate_document(document) + feature_problems(document)
    if errors:
        print("Cached features failed validation:", file=sys.stderr)
        for error in errors:
            print(f"  {error}", file=sys.stderr)
        return 1
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(path.read_bytes())
    counts = document["counts"]
    print(
        "::warning::Fresh OpenStreetMap export was not usable. "
        f"Wrote the committed ODbL fallback {path} "
        f"({counts['buildings']} buildings, {counts['lifts']} lifts).",
        file=sys.stderr,
    )
    print(summarize(document))
    print(f"Wrote {output}")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.buffer_metres < 0:
        print("Buffer must be zero or positive.", file=sys.stderr)
        return 1
    if args.retry_attempts < 1:
        print("Retry attempts must be at least 1.", file=sys.stderr)
        return 1
    origin = resolve_origin(args)
    sampler, heights_meta = height_source(args, origin)
    endpoints = tuple(args.endpoints) if args.endpoints else OVERPASS_ENDPOINTS
    fallback = chosen_fallback(args)
    try:
        bbox = None if args.no_map_fallback else resolve_map_bbox(args)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"Could not build an OSM map bbox: {exc}", file=sys.stderr)
        if fallback is None:
            return 1
        return publish_fallback(fallback, args.output)
    try:
        payload, fetch = fetch_resort(
            args.cache_dir,
            refresh=args.refresh,
            endpoints=endpoints,
            attempts=args.retry_attempts,
            backoff=args.retry_backoff,
            map_fallback=not args.no_map_fallback,
            map_bbox=bbox,
            map_endpoint=args.map_endpoint,
        )
    except RuntimeError as exc:
        print(exc, file=sys.stderr)
        if fallback is None:
            return 1
        return publish_fallback(fallback, args.output)
    data = normalize_elements(payload)
    try:
        document = build_features(
            data,
            origin,
            sampler=sampler,
            buffer_metres=args.buffer_metres,
            fetch=fetch,
            heights_meta=heights_meta,
        )
    except ValueError as exc:
        print(exc, file=sys.stderr)
        if fallback is None:
            return 1
        return publish_fallback(fallback, args.output)
    errors = validate_document(document)
    if errors:
        print("Export failed validation:", file=sys.stderr)
        for error in errors:
            print(f"  {error}", file=sys.stderr)
        if fallback is None:
            return 1
        return publish_fallback(fallback, args.output)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(document, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(summarize(document))
    print(f"Wrote {args.output}")
    if not document["verification"]["resortBoundary"]["found"]:
        print("warning: the resort boundary did not match the expected way and tag", file=sys.stderr)
    if not document["verification"]["quickdraw"]["found"]:
        print("warning: Quickdraw way 101303241 was not exported as a chair_lift", file=sys.stderr)
    return 0
