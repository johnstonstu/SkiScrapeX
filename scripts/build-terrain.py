"""Build a browser terrain grid from the 2025 LidarBC Apex survey."""
import hashlib
import json
from pathlib import Path
import shutil
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import numpy as np
from osgeo import gdal, osr

from height_packing import pack_heights

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'data' / 'raw'
OUTPUT = ROOT / 'terrain' / 'generated'
SERVICE = ('https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/'
           'LiDAR_BC_S3_Public/FeatureServer')
INDEX = f'{SERVICE}/5/query'          # bare-earth DEM (ground)
SURFACE_INDEX = f'{SERVICE}/1/query'  # digital surface model (first return)
BOUNDS = (286880, 5472800, 290100, 5475440)  # west, south, east, north in EPSG:2955
STEP = 5
NODATA = -32767


# Canopy grid: metres of vegetation above ground and the share of each 5 m cell
# covered by canopy taller than this.
CANOPY_MIN_HEIGHT = 2.5
CANOPY_HEIGHT_SCALE = 4  # stored value = metres * 4, so 0..63.75 m fits a byte

# Detail grid near the skier: 2 m samples on the same origin as the 5 m grid,
# from the 1 m ground lightly smoothed (a snowpack buries boulders and stumps
# but keeps cat tracks, banks and gullies). Stored as uint16 centimetres above
# the minimum elevation; 65535 marks a hole.
DETAIL_STEP = 2
DETAIL_SMOOTH_SIGMA = 1.5  # metres, Gaussian, applied at 1 m
DETAIL_SCALE = 100
DETAIL_HOLE = 65535


def source_tiles(index=INDEX, where="year=2025 AND contract='OP24BMRS001'"):
    parameters = {
        'f': 'json', 'where': where,
        'geometry': ','.join(map(str, BOUNDS)), 'geometryType': 'esriGeometryEnvelope',
        'inSR': 2955, 'returnGeometry': 'false',
        'outFields': 'maptile,s3Url', 'orderByFields': 'maptile ASC',
    }
    with urlopen(f'{index}?{urlencode(parameters)}', timeout=45) as response:
        result = json.load(response)
    features = result.get('features')
    if not features or result.get('exceededTransferLimit'):
        raise RuntimeError(f'Incomplete LidarBC tile index result: {result}')
    return [feature['attributes'] for feature in features]


def download(url):
    path = CACHE / url.rsplit('/', 1)[1]
    if not path.exists():
        partial = path.with_suffix('.part')
        with urlopen(url, timeout=90) as response, partial.open('wb') as target:
            shutil.copyfileobj(response, target)
        partial.replace(path)
    return path


# Route sections in downhill order, followed by a separately rendered lift.
ROUTE_WAYS = (650891799, 374339391, 650891807)
QUICKDRAW_WAY = 101303241


def extract_reference_lines(origin_easting, origin_northing):
    wgs84 = osr.SpatialReference()
    wgs84.ImportFromEPSG(4326)
    wgs84.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    utm = osr.SpatialReference()
    utm.ImportFromEPSG(2955)
    project = osr.CoordinateTransformation(wgs84, utm)
    lines = []
    for way_id in (*ROUTE_WAYS, QUICKDRAW_WAY):
        url = f'https://api.openstreetmap.org/api/0.6/way/{way_id}/full.json'
        request = Request(url, headers={'User-Agent': 'SkiScrapex-terrain-import/1.0'})
        with urlopen(request, timeout=45) as response:
            elements = json.load(response)['elements']
        way = next(item for item in elements if item['type'] == 'way' and item['id'] == way_id)
        nodes = {item['id']: item for item in elements if item['type'] == 'node'}
        points = []
        for node_id in way['nodes']:
            node = nodes[node_id]
            easting, northing, _ = project.TransformPoint(node['lon'], node['lat'])
            points.append([round(easting - origin_easting, 2), round(origin_northing - northing, 2)])
        lines.append({'id': way_id, 'version': way['version'], 'points': points,
                      'feature': 'lift' if way_id == QUICKDRAW_WAY else 'trail'})
    return {'attribution': '© OpenStreetMap contributors', 'license': 'ODbL 1.0', 'lines': lines}


def surface_tiles(ground_tiles):
    """2025 surface-model tiles that pair with the ground tiles by map tile id."""
    wanted = {tile['maptile'] for tile in ground_tiles}
    for where in ("year=2025 AND contract='OP24BMRS001'", 'year=2025'):
        try:
            tiles = [tile for tile in source_tiles(SURFACE_INDEX, where) if tile['maptile'] in wanted]
        except RuntimeError:
            continue
        if {tile['maptile'] for tile in tiles} == wanted:
            return tiles
    raise RuntimeError('Surface tiles do not cover the same map tiles as the ground model.')


def fetch_tiles(tiles):
    sources, paths = [], []
    for tile in tiles:
        url = tile['s3Url']
        path = download(url)
        paths.append(str(path))
        with path.open('rb') as source:
            checksum = hashlib.file_digest(source, 'sha256').hexdigest()
        sources.append({'id': tile['maptile'], 'url': url, 'sha256': checksum})
    return sources, paths


def warp(paths, step, resample):
    mosaic = gdal.BuildVRT('', paths)
    return gdal.Warp('', mosaic, format='MEM', outputBounds=BOUNDS,
                     xRes=step, yRes=step, resampleAlg=resample, dstNodata=NODATA)


def build_canopy(ground_tiles, ground_paths, columns, rows):
    """Canopy height and cover per 5 m cell from first-return surface minus ground."""
    sources, surface_paths = fetch_tiles(surface_tiles(ground_tiles))
    ground = warp(ground_paths, 1, 'bilinear').ReadAsArray().astype('f4')
    surface = warp(surface_paths, 1, 'bilinear').ReadAsArray().astype('f4')
    valid = (ground != NODATA) & (surface != NODATA) & np.isfinite(ground) & np.isfinite(surface)
    chm = np.where(valid, np.clip(surface - ground, 0, 63.75), 0).astype('f4')
    blocks = chm.reshape(rows, STEP, columns, STEP)
    tall = (blocks > CANOPY_MIN_HEIGHT).mean(axis=(1, 3))
    top = blocks.max(axis=(1, 3))
    cover_bytes = np.round(tall * 255).astype('u1').tobytes()
    height_bytes = np.round(top * CANOPY_HEIGHT_SCALE).astype('u1').tobytes()
    meta = {
        'coverFile': 'canopy-cover.u8',
        'heightFile': 'canopy-height.u8',
        'coverEncoding': 'uint8 share of 1 m cells taller than minHeightMetres, 0..255',
        'heightEncoding': f'uint8 tallest canopy in metres * {CANOPY_HEIGHT_SCALE}',
        'heightScale': CANOPY_HEIGHT_SCALE,
        'minHeightMetres': CANOPY_MIN_HEIGHT,
        'invalidShare': float(1 - valid.mean()),
        'method': 'LidarBC 2025 surface model minus bare earth at 1 m, aggregated to the height grid',
        'sources': sources,
    }
    return meta, cover_bytes, height_bytes


def gaussian_blur(values, sigma):
    """Separable Gaussian on a 2D array, edges clamped. sigma in cells."""
    radius = max(1, int(round(3 * sigma)))
    kernel = np.exp(-0.5 * (np.arange(-radius, radius + 1) / sigma) ** 2)
    kernel /= kernel.sum()
    out = values
    for axis in (0, 1):
        padded = np.pad(out, [(radius, radius) if a == axis else (0, 0) for a in (0, 1)], mode='edge')
        acc = np.zeros_like(out)
        for k, weight in enumerate(kernel):
            acc += weight * (padded[k:k + out.shape[0], :] if axis == 0 else padded[:, k:k + out.shape[1]])
        out = acc
    return out


def build_detail(paths, metadata):
    """2 m heights aligned to the 5 m grid origin (sample [0, 0] at the same point)."""
    columns = int((metadata['columns'] - 1) * STEP // DETAIL_STEP) + 1
    rows = int((metadata['rows'] - 1) * STEP // DETAIL_STEP) + 1
    west = metadata['originEasting'] - DETAIL_STEP / 2
    north = metadata['originNorthing'] + DETAIL_STEP / 2
    pad = 8  # metres of context so the blur has real data at the crop edge
    bounds = (west - pad, north - rows * DETAIL_STEP - pad, west + columns * DETAIL_STEP + pad, north + pad)
    mosaic = gdal.BuildVRT('', paths)
    fine = gdal.Warp('', mosaic, format='MEM', outputBounds=bounds, xRes=1, yRes=1,
                     resampleAlg='bilinear', dstNodata=NODATA).ReadAsArray().astype('f8')
    hole = (fine == NODATA) | ~np.isfinite(fine)
    if hole.all():
        raise RuntimeError('No ground data for the detail grid.')
    fine[hole] = np.nan
    filled = np.where(hole, np.nanmean(fine), fine)
    weight = gaussian_blur((~hole).astype('f8'), DETAIL_SMOOTH_SIGMA)
    smooth = gaussian_blur(np.where(hole, 0, filled), DETAIL_SMOOTH_SIGMA) / np.maximum(weight, 1e-6)
    smooth[hole] = np.nan
    # Sample centres sit at pad + 0.5 + 2k in the 1 m raster: average the 2 x 2 block.
    o = pad
    block = smooth[o:o + rows * DETAIL_STEP, o:o + columns * DETAIL_STEP]
    detail = block.reshape(rows, DETAIL_STEP, columns, DETAIL_STEP).mean(axis=(1, 3))
    base = metadata['minimumElevation']
    centimetres = np.round((detail - base) * DETAIL_SCALE)
    if np.nanmax(centimetres) >= DETAIL_HOLE:
        raise RuntimeError('Detail heights exceed the uint16 range.')
    encoded = np.where(np.isfinite(centimetres), np.clip(centimetres, 0, DETAIL_HOLE - 1), DETAIL_HOLE).astype('<u2')
    data = encoded.tobytes()
    meta = {
        'file': 'heights-2m.u16',
        'columns': columns,
        'rows': rows,
        'stepMetres': DETAIL_STEP,
        'encoding': 'uint16-le centimetres above baseElevation; 65535 is a hole',
        'baseElevation': base,
        'scale': DETAIL_SCALE,
        'hole': DETAIL_HOLE,
        'smoothingSigmaMetres': DETAIL_SMOOTH_SIGMA,
        'holeShare': float((encoded == DETAIL_HOLE).mean()),
        'sha256': hashlib.sha256(data).hexdigest(),
        'method': 'LidarBC 2025 1 m bare earth, Gaussian smoothed, 2 x 2 block mean; origin matches the 5 m grid',
    }
    return meta, data


def write_packed_heights(filename, data, grid, *, coarse):
    packed = pack_heights(data, grid['columns'], grid['rows'], coarse=coarse)
    (OUTPUT / filename).write_bytes(packed)
    grid['packedHeights'] = {
        'file': filename,
        'encoding': 'plane-delta16-gzip-v1',
        'sha256': hashlib.sha256(packed).hexdigest(),
    }
    print(f'{filename}: {len(data):,} raw bytes to {len(packed):,} packed bytes')


def main():
    gdal.UseExceptions()
    CACHE.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)

    ground_tiles = source_tiles()
    sources, paths = fetch_tiles(ground_tiles)
    raster = warp(paths, STEP, 'bilinear')
    heights = raster.ReadAsArray()
    if not np.all(np.isfinite(heights) & (heights != NODATA)):
        raise RuntimeError('The crop has missing elevations. Inspect source coverage before exporting.')

    west, _, _, north = BOUNDS
    datum_origin = 1600
    height_data = (heights - datum_origin).astype('<f4').tobytes()
    metadata = {
        'version': 1,
        'columns': raster.RasterXSize,
        'rows': raster.RasterYSize,
        'stepMetres': STEP,
        'originEasting': west + STEP / 2,
        'originNorthing': north - STEP / 2,
        'originElevation': datum_origin,
        'horizontalCRS': 'EPSG:2955',
        'verticalCRS': 'EPSG:6647',
        'minimumElevation': float(heights.min()),
        'maximumElevation': float(heights.max()),
        'heightEncoding': 'float32-le',
        'heightSha256': hashlib.sha256(height_data).hexdigest(),
        'attribution': 'Contains information licensed under the Open Government Licence – British Columbia.',
        'sources': sources,
    }

    references = extract_reference_lines(metadata['originEasting'], metadata['originNorthing'])
    max_x = (metadata['columns'] - 1) * STEP
    max_z = (metadata['rows'] - 1) * STEP
    for line in references['lines']:
        if not all(0 <= x <= max_x and 0 <= z <= max_z for x, z in line['points']):
            raise RuntimeError(f"OSM way {line['id']} lies outside the terrain crop.")
    try:
        canopy, cover_bytes, height_bytes = build_canopy(ground_tiles, paths, metadata['columns'], metadata['rows'])
        (OUTPUT / canopy['coverFile']).write_bytes(cover_bytes)
        (OUTPUT / canopy['heightFile']).write_bytes(height_bytes)
        metadata['canopy'] = canopy
        print(f"Canopy: {sum(cover_bytes) / 255 / len(cover_bytes):.0%} mean cover")
    except Exception as error:  # canopy is optional; the game falls back to a procedural forest
        print(f'warning: canopy skipped ({error})')

    try:
        detail, detail_bytes = build_detail(paths, metadata)
        (OUTPUT / detail['file']).write_bytes(detail_bytes)
        metadata['detail'] = detail
        write_packed_heights('heights-2m.delta.bin', detail_bytes, detail, coarse=False)
        print(f"Detail: {detail['columns']} x {detail['rows']} at {DETAIL_STEP} m")
    except Exception as error:
        source = 'Packed detail grid' if 'detail' in metadata else 'Detail grid'
        print(f'warning: {source} skipped ({error})')

    (OUTPUT / 'references.json').write_text(json.dumps(references, indent=2) + '\n', encoding='utf-8')
    (OUTPUT / 'heights.f32').write_bytes(height_data)
    write_packed_heights('heights-5m.delta.bin', height_data, metadata, coarse=True)
    (OUTPUT / 'terrain.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
    gdal.DEMProcessing(str(OUTPUT / 'hillshade.png'), raster, 'hillshade',
                       format='PNG', computeEdges=True)
    print(f"Exported {metadata['columns']} × {metadata['rows']} elevations to {OUTPUT}")


if __name__ == '__main__':
    main()
