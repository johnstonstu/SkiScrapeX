"""Build the distant-terrain grid around the Apex crop from NRCan MRDEM (30 m).

Reads the national Cloud Optimized GeoTIFFs over HTTP (only the needed
window is fetched), reprojects to the crop's EPSG:2955 frame and writes
`horizon.f32` (ground, metres above the crop's vertical origin) and
`horizon-canopy.u8` (surface minus ground, metres * 4) beside the terrain
outputs. Both MRDEM and LidarBC heights are CGVD2013.
"""
import hashlib
import json
from pathlib import Path

import numpy as np
from osgeo import gdal

from height_packing import gzip_bytes, pack_heights

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'terrain' / 'generated'
# Mirrors of the same COGs, tried in order.
BASES = (
    'https://canelevation-dem.s3.ca-central-1.amazonaws.com/mrdem-30/',
    'https://datacube-prod-data-public.s3.amazonaws.com/store/elevation/mrdem/mrdem-30/',
    'https://datacube-prod-data-public.s3.ca-central-1.amazonaws.com/store/elevation/mrdem/mrdem-30/',
)


def open_first(name):
    errors = []
    for base in BASES:
        try:
            dataset = gdal.Open(f'/vsicurl/{base}{name}')
            if dataset is not None:
                return dataset, base + name
        except RuntimeError as error:
            errors.append(f'{base}: {error}')
    raise RuntimeError(f'Could not open {name}: ' + '; '.join(errors))
STEP = 60
PAD = 12000


def main():
    gdal.UseExceptions()
    gdal.SetConfigOption('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')
    gdal.SetConfigOption('CPL_VSIL_CURL_ALLOWED_EXTENSIONS', '.tif')
    gdal.SetConfigOption('AWS_NO_SIGN_REQUEST', 'YES')
    terrain = json.loads((OUTPUT / 'terrain.json').read_text(encoding='utf-8'))
    west = terrain['originEasting'] - terrain['stepMetres'] / 2
    north = terrain['originNorthing'] + terrain['stepMetres'] / 2
    east = west + terrain['columns'] * terrain['stepMetres']
    south = north - terrain['rows'] * terrain['stepMetres']
    bounds = (west - PAD, south - PAD, east + PAD, north + PAD)

    def warp(source, resample):
        raster = gdal.Warp('', source, format='MEM', outputBounds=bounds, dstSRS='EPSG:2955',
                           xRes=STEP, yRes=STEP, resampleAlg=resample, dstNodata=-32767)
        return raster.ReadAsArray().astype('f4')

    dtm, dtm_url = open_first('mrdem-30-dtm.tif')
    dsm, dsm_url = open_first('mrdem-30-dsm.tif')
    ground = warp(dtm, 'bilinear')
    surface = warp(dsm, 'bilinear')
    valid = (ground > -1000) & np.isfinite(ground)
    if valid.mean() < 0.99:
        raise RuntimeError(f'MRDEM window is only {valid.mean():.1%} valid')
    origin = terrain['originElevation']
    heights = np.where(valid, ground - origin, np.nan).astype('<f4')
    canopy = np.where(valid & (surface > -1000), np.clip(surface - ground, 0, 63.75), 0)
    height_bytes = heights.tobytes()
    canopy_bytes = np.round(canopy * 4).astype('u1').tobytes()
    rows, columns = heights.shape
    meta = {
        'version': 1,
        'columns': columns,
        'rows': rows,
        'stepMetres': STEP,
        # Local frame of the crop: x east of the crop origin, z south of it.
        'originX': bounds[0] + STEP / 2 - terrain['originEasting'],
        'originZ': terrain['originNorthing'] - (bounds[3] - STEP / 2),
        'originElevation': origin,
        'heightEncoding': 'float32-le',
        'heightFile': 'horizon.f32',
        'heightSha256': hashlib.sha256(height_bytes).hexdigest(),
        'canopyFile': 'horizon-canopy.u8',
        'canopyEncoding': 'uint8 surface minus ground in metres * 4 (MRDEM DSM - DTM)',
        'horizontalCRS': 'EPSG:2955',
        'verticalCRS': 'EPSG:6647',
        'source': 'NRCan CanElevation MRDEM-30 DTM and DSM (COG)',
        'sourceUrls': [dtm_url, dsm_url],
        'attribution': 'Contains information licensed under the Open Government Licence – Canada.',
    }
    # Packed copies for the browser; the raw files stay for tools and older builds.
    packed_heights = pack_heights(height_bytes, columns, rows, coarse=True)
    packed_canopy = gzip_bytes(canopy_bytes)
    meta['packedHeights'] = {
        'file': 'horizon.delta.bin',
        'encoding': 'plane-delta16-gzip-v1',
        'sha256': hashlib.sha256(packed_heights).hexdigest(),
    }
    meta['packedCanopy'] = {'file': 'horizon-canopy.u8.gz.bin', 'encoding': 'gzip-v1'}
    (OUTPUT / 'horizon.f32').write_bytes(height_bytes)
    (OUTPUT / 'horizon-canopy.u8').write_bytes(canopy_bytes)
    (OUTPUT / 'horizon.delta.bin').write_bytes(packed_heights)
    (OUTPUT / 'horizon-canopy.u8.gz.bin').write_bytes(packed_canopy)
    (OUTPUT / 'horizon.json').write_text(json.dumps(meta, indent=2) + '\n', encoding='utf-8')
    print(f'Horizon {columns} x {rows} at {STEP} m, {np.nanmin(heights) + origin:.0f} to {np.nanmax(heights) + origin:.0f} m')


if __name__ == '__main__':
    main()
