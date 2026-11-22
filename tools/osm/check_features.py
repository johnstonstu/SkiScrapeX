#!/usr/bin/env python3
"""Fail if features.json is missing, empty of buildings, or not the four Apex lifts.

Used by the data and Pages workflows. The stdlib-only check does not import
pyproj, so the Pages job can run it without the GIS packages.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from osm_export.checks import feature_problems


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 1:
        print("usage: check_features.py path/to/features.json", file=sys.stderr)
        return 2
    path = Path(args[0])
    if not path.is_file():
        print(f"error: {path} is missing", file=sys.stderr)
        return 1
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"error: {path} is not valid JSON ({exc})", file=sys.stderr)
        return 1
    problems = feature_problems(document)
    if problems:
        print(f"error: {path} failed the features check:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1
    counts = document["counts"]
    print(
        f"{path}: buildings={counts['buildings']} lifts={counts['lifts']} "
        f"({document['source'].get('attribution')}, {document['source'].get('license')})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
