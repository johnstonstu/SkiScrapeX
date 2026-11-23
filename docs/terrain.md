# Apex terrain

The first crop covers the Quickdraw chair and the linked Grandfather’s Trail segments. It is a bare-earth model around the ski resort, including the terrain between the two ends of the Quickdraw chair. The tested export uses nine tiles and contains 340,032 valid samples. The mapped Grandfather’s endpoints sample at about 2,174 m and 1,681 m. This crop is the reference for the first descent. The resort map and a local review can refine the line, landmarks, exact spawn and finish.

## Build

The **Build Apex data** workflow runs `scripts/build-terrain.py` in CI and publishes the outputs to the `data` branch. To run it locally you need Python 3.11+, NumPy and GDAL's Python bindings (`python3-numpy` and `python3-gdal` on Debian/Ubuntu). It downloads the original GeoTIFFs into `data/raw/` and writes the height grid, canopy grids, metadata, north-up hillshade and route reference into `terrain/generated/`. View the result in the game (`game/`, orbit camera with C).

The canopy grids come from the 2025 LidarBC surface model ([index layer 1](https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/LiDAR_BC_S3_Public/FeatureServer/1)) paired with the ground tiles by map tile id. Surface minus ground at 1 m gives canopy height. Each 5 m cell stores the share of 1 m cells taller than 2.5 m (`canopy-cover.u8`, 0 to 255) and the tallest canopy (`canopy-height.u8`, metres × 4). Lift towers and buildings also show up as canopy; the game keeps trees off lift lines and runs.

## Sources and checks

| Source | Role |
| --- | --- |
| [LidarBC 1:2,500 DEM service](https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/LiDAR_BC_S3_Public/FeatureServer/5) | Primary elevation. The 2025 survey, contract OP24BMRS001, has 1 m bare-earth GeoTIFFs. The wider study box intersects 15 DEM tiles and has a northwest data gap. The first crop excludes that gap and the exporter checks every output cell for missing data. |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Route reference extracted separately under ODbL. Quickdraw is [way 101303241](https://www.openstreetmap.org/way/101303241). Grandfather’s Trail is represented by ways [650891799](https://www.openstreetmap.org/way/650891799), [374339391](https://www.openstreetmap.org/way/374339391) and [650891807](https://www.openstreetmap.org/way/650891807), in downhill order. The mapped trail starts at the top of Quickdraw and reaches the T-bar base. |
| [Apex resort trail map](https://apexresort.com/wp-content/uploads/2023/12/Apex-Mountain-Winter-Trail-Map-2023-PDF.pdf) | Visual reference for layout and names. The artwork is outside the game assets. |
| [NRCan HRDEM](https://open.canada.ca/data/dataset/957782bf-847c-4644-a757-e383c0057995) and [MRDEM](https://open.canada.ca/data/en/dataset/18752265-bda3-498c-a4ba-9dfe68cb98da) | Federal fallback candidates. The HRDEM catalog returns regional candidates. Validate actual cell coverage and the vertical datum before joining sources. MRDEM has nationwide 30 m coverage and is suitable for broader context. |

Contains information licensed under the [Open Government Licence – British Columbia](https://pub.data.gov.bc.ca/license/OGL-vbc2.0.pdf). © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) for the separately exported route geometry. The game depicts a winter surface over a bare-earth elevation model.

## Contract for the skiing prototype

- Positions and heights use metres. Three.js axes are +X east, +Y up and +Z south. Projected coordinates are NAD83(CSRS) / UTM 11N (EPSG:2955), and source elevations are CGVD2013 (EPSG:6647).
- The crop uses bounds E 286880–290100 and N 5472800–5475440. It exports 644 columns × 528 rows at 5 m. Sample [0, 0] is the northwest **cell centre**. The manifest defines its easting and northing and the 1600 m vertical origin. Rows go south and columns go east. Each value in `heights.f32` is a little-endian Float32 representing metres relative to the vertical origin.
- [The pure sampler](../game/src/world/terrainGrid.ts) exposes `sampleTerrain(x, z) → { height, normal: { x, y, z } } | null`. The unit normal points upward. The sampler and the mesh split each cell along the same diagonal, so the reported height matches the rendered triangles. A synthetic slope can implement the same function without loading data or Three.js.
- `heights-2m.u16` (described by `detail` in the manifest) is a 2 m grid whose sample [0, 0] is the same point as the 5 m grid's. Each value is a little-endian uint16 of centimetres above `detail.baseElevation`; 65535 is a hole. It is the 1 m ground, Gaussian smoothed with sigma 1.5 m and averaged over 2 × 2 blocks. The game samples it first and falls back to the 5 m grid outside it or in holes.

## Local review

Follow Grandfather’s from the top of Quickdraw through the westward bend to the T-bar base and compare the line and two recognizable features against local knowledge.

## Packed downloads

Each grid can advertise a `packedHeights` object alongside its existing manifest fields. It contains the file name, encoding (`plane-delta16-gzip-v1`) and SHA-256 of the gzip file. The gzip payloads use a `.bin` extension so static servers serve them as binary files. The browser prefers the packed downloads. It uses the original files when no supported packed format is advertised, gzip decoding is unavailable, or a packed download fails. The original files also serve the OSM tooling and older game builds.

After gzip inflation, each row-major sample is a signed little-endian 16-bit residual from `left + upper - upperLeft`. Missing neighbours contribute zero. A residual of −32768 is an escape followed by the original little-endian sample. The 2 m predictor uses the existing uint16 codes, including the hole code. The 5 m predictor uses units of 1/8192 m. Any Float32 value that cannot be represented exactly as a signed 32-bit count of those units, including negative zero, uses an escape and contributes zero to future predictions. Decoding preserves the original sample bytes, dimensions and origin.
