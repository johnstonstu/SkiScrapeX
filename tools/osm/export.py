#!/usr/bin/env python3
"""Run the OSM export from the repository root: python3 tools/osm/export.py"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from osm_export.export import main

if __name__ == "__main__":
    raise SystemExit(main())
