"""Command line export of Apex OpenStreetMap features."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .assemble import build_features, summarize, validate_document
from .constants import DEFAULT_BUFFER_METRES, OVERPASS_ENDPOINTS
from .heights import load_height_grid
from .overpass import fetch_overpass, normalize_elements
from .transform import Origin, documented_origin, origin_from_manifest


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def tool_root() -> Path:
    return Path(__file__).resolve().parents[1]


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
        help="Overpass interpreter URL; may be repeated. Defaults to the public servers.",
    )
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


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.buffer_metres < 0:
        print("Buffer must be zero or positive.", file=sys.stderr)
        return 1
    origin = resolve_origin(args)
    sampler, heights_meta = height_source(args, origin)
    endpoints = tuple(args.endpoints) if args.endpoints else OVERPASS_ENDPOINTS
    try:
        payload, fetch = fetch_overpass(args.cache_dir, refresh=args.refresh, endpoints=endpoints)
    except RuntimeError as exc:
        print(exc, file=sys.stderr)
        return 1
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
        return 1
    errors = validate_document(document)
    if errors:
        print("Export failed validation:", file=sys.stderr)
        for error in errors:
            print(f"  {error}", file=sys.stderr)
        return 1
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
