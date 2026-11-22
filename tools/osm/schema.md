# `features.json` version 1

The exporter writes this document to `tools/osm/generated/features.json`. That file is generated and gitignored. `sample/features.sample.json` is a short example of the same shape, not a live extract. Published exports are derived from OpenStreetMap and stay under ODbL. They live on the `data` branch, not on `main`.

Positions are metres in the game frame:

- `x` is east
- `y` is up, and is `null` unless a terrain height grid was sampled
- `z` is south

`transform` records the origin that produced those axes. For the current crop the origin is the northwest cell centre described in `docs/terrain.md`: easting `286882.5`, northing `5475437.5`, elevation `1600` m CGVD2013. A later crop can replace that origin with `--manifest terrain/generated/terrain.json` or with `--origin-easting`, `--origin-northing` and `--origin-elevation`.

```
x = easting - originEasting
y = elevation - originElevation
z = originNorthing - northing
```

Easting and northing are NAD83(CSRS) / UTM zone 11N (EPSG:2955), converted from OpenStreetMap longitude and latitude (EPSG:4326) with easting/northing axis order. This is the same horizontal step the terrain exporter uses. `y` uses the terrain grid's CGVD2013 heights when that grid is present. OpenStreetMap `ele` tags are copied onto peaks and are not used as `y`.

## Top level

| Field | Meaning |
| --- | --- |
| `version` | Document format. This file is version `1`. |
| `generator` | `ski-scrapex-osm-export` |
| `generatedAt` | UTC time the file was written |
| `source` | Overpass endpoint, OSM timestamp, retrieval time, query hash, ODbL copyright, attribution and licence. `queries` lists each cached response when the download was split |
| `crs` | `EPSG:2955` horizontal, `EPSG:6647` vertical |
| `transform` | Origin, which input supplied it, axis names and the formula above |
| `heights` | Whether a height grid was sampled. `sampledPoints` and `unsampledPoints` count distinct OSM nodes projected while building the file, including candidates that fall outside the buffer |
| `bufferMetres` | Buildings, roads and peaks this far outside the resort polygon are included |
| `verification` | Whether way `1138569632` is `landuse=winter_sports` and way `101303241` is the Quickdraw chair |
| `counts` | Feature totals |
| `quality` | Name notes, peaks and pistes outside the buffer, skipped highway classes |
| `boundary` | The resort polygon |
| `runs` | `piste:type=downhill` |
| `terrainParks` | `piste:type=snow_park` |
| `lifts` | Aerialway ways, with stations and towers |
| `buildings` | `building=*` inside the buffered resort |
| `roads` | Road-like `highway=*` values inside the buffered resort |
| `peaks` | Named `natural=peak` nodes inside the buffered resort |

## Feature identity

Every OpenStreetMap object keeps a stable id:

- `id` is `way/<osmId>`, `relation/<osmId>` or `node/<osmId>`
- `osmType` and `osmId` repeat that pair
- `osmVersion` is the OSM version when Overpass provided one
- `tags` is the OSM tag map, unchanged

A coordinate is `{ "osmId", "x", "y", "z" }`. `x` and `z` are rounded to centimetres. `y` is a number of centimetres or `null`.

`geometry` is `line`, `area` or `mixed`. A piste is an area only when it is tagged `area=yes` or is a multipolygon. A closed downhill way without `area=yes` stays a line. Buildings and the resort boundary are areas.

## Runs and terrain parks

Ways that share a name are one feature. Unnamed ways stay separate. Each feature has:

| Field | Meaning |
| --- | --- |
| `name`, `difficulty`, `grooming` | Run-level values when every member agrees; otherwise `null`, with the member values kept |
| `topology` | `path` (one chain), `branches` (they meet but reversing one would double back), or `separate` (the ways do not touch) |
| `orderedDownhill` | True when the member order and vertex order run from high to low, or when the documented Grandfather's sequence was applied |
| `orderSource` | `documented-way-sequence`, `height-grid`, `openstreetmap`, or `none` |
| `members` | The OSM ways, each with its own `points` |
| `points` | Present for a `path`: the members joined in order, with the shared joint node written once |

Grandfather's Trail uses ways `650891799`, `374339391` and `650891807`, in that order, which is the downhill sequence in `docs/terrain.md`. Each way keeps its mapped node order when that order already connects to the next way. `downhillContradiction` is set when a height grid says that published sequence climbs.

Other paths keep OpenStreetMap's direction unless both ends can be sampled and the sampled end is higher by more than one metre. In that case the path is reversed and `orderSource` is `height-grid`.

## Lifts

Each aerialway way has:

- `stations`: both ends. A node tagged `aerialway=station` has `inferred: false`. When a terminal is untagged, the way's endpoint is still emitted and `inferred` is true. Roles are `start` and `end` along the exported line, or `bottom`, `middle` and `top` when heights show which terminal is higher. `orderedBottomToTop` records that second case.
- `towers`: nodes tagged `aerialway=pylon`, in line order, with `index` starting at 0.
- `line`: every way vertex in that same order, with `kind` of `station`, `pylon` or `vertex`.

## Buildings, roads and peaks

Buildings and roads are ways that intersect the resort polygon expanded by `bufferMetres`. Roads are `highway` values for motorway, trunk, primary, secondary, tertiary, unclassified, residential, living street, service, track, road, busway and pedestrian, including `*_link`. Footways and paths inside the buffer are counted in `quality.highwaysSkipped` and omitted.

A way that is both a piste and a road is listed in both groups. Those ids are also in `quality.waysUsedAsRunAndRoad`.

Peaks inside the buffer are in `peaks`. Named peaks fetched nearby but outside the buffer are in `quality.peaksOutsideBuffer` with a distance. `ele` is the OSM tag parsed as a number. It is not `y`.

## Licence

The live file is derived from OpenStreetMap and is © OpenStreetMap contributors, available under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Keep `source.attribution` with any copy.
