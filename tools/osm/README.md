# Apex OpenStreetMap export

This tool downloads Apex Mountain Resort's mapped runs, terrain parks, lifts, buildings, roads and named peaks, then writes them in the game's local frame. It does not modify the terrain pipeline. When `terrain/generated/` exists it can sample that height grid; otherwise every `y` is left null.

Coordinates are metres. `+X` is east, `+Y` is up and `+Z` is south. Longitude and latitude are projected to NAD83(CSRS) / UTM zone 11N (EPSG:2955), matching the terrain export. The default origin is the northwest cell centre of the crop in `docs/terrain.md`:

- easting `286882.5` (crop west `286880` plus half of the 5 m cell)
- northing `5475437.5` (crop north `5475440` minus half of the 5 m cell)
- elevation `1600` m CGVD2013

```
x = easting - originEasting
z = originNorthing - northing
y = elevation - originElevation
```

The output file repeats those parameters in `transform`, so a later crop can be followed without editing this tool.

## Setup

Python 3.11 or newer. The only third-party packages are `requests` and `pyproj`.

```bash
python3 -m pip install -r tools/osm/requirements.txt
```

## Export

From the repository root:

```bash
python3 tools/osm/export.py
```

Or from this directory:

```bash
python3 -m osm_export
```

The raw Overpass response is cached in `tools/osm/cache/`. The game file is written to `tools/osm/generated/features.json`. Both directories are gitignored. Pass `--refresh` to download again.

Useful options:

```bash
python3 tools/osm/export.py --refresh
python3 tools/osm/export.py --manifest terrain/generated/terrain.json
python3 tools/osm/export.py --origin-easting 286882.5 --origin-northing 5475437.5 --origin-elevation 1600
python3 tools/osm/export.py --documented-origin --no-heights
python3 tools/osm/export.py --buffer-metres 50
```

`--manifest` reads `originEasting`, `originNorthing` and `originElevation` from a terrain manifest. If `terrain/generated/terrain.json` is already present, the tool uses it as the origin so the features stay aligned when the crop changes. `--documented-origin` keeps the crop origin above instead. Explicit `--origin-*` values replace whichever origin was selected.

Heights are attached only when `heights.f32` sits beside a manifest and the point falls on that grid. The sampler uses the same cell diagonal as `game/src/world/terrainGrid.ts`. Points outside the grid keep `y: null`. `--no-heights` skips sampling.

Buildings, roads and named peaks are kept when they meet the resort polygon or come within `--buffer-metres` of it (50 m by default). Runs and lifts that merely cross the boundary are kept in full.

On success the command prints a count of runs, parks, lifts, towers, buildings, roads and peaks, plus name notes such as an aerialway tagged `Stock's Chiar`. The file format is described in [schema.md](schema.md). [sample/features.sample.json](sample/features.sample.json) shows a tiny version-1 document.

## Tests

```bash
cd tools/osm
python3 -m unittest discover -s tests -v
```

The tests cover the local-frame round trip, axis direction (east increases `x`, north decreases `z`, up increases `y`), the terrain-grid diagonal, Grandfather's documented way order, lift stations and towers, and the buffered resort filter.

## What is requested from OpenStreetMap

Three Overpass queries load:

- resort boundary way `1138569632` (`landuse=winter_sports`, checked at runtime rather than assumed)
- `piste:type=downhill` and `piste:type=snow_park`
- aerialways, plus nodes tagged `aerialway=pylon` or `aerialway=station`
- named `natural=peak` nodes in a wider box
- buildings and highways in a box padded around the verified boundary

Quickdraw is way `101303241`. Grandfather's Trail is ordered as ways `650891799`, `374339391`, `650891807`, the downhill sequence documented for the terrain viewer. Other runs are chained when their endpoints meet without doubling back, and they are reversed to run downhill only when the height grid can tell which end is higher.

The live file is © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
