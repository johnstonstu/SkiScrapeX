"""Lossless plane prediction for the browser's gzip height downloads."""

import gzip
import math
import struct


ESCAPE = -32768
FLOAT_SCALE = 8192  # Float32 elevations from the Apex export lie on this lattice.


def pack_heights(data: bytes, columns: int, rows: int, *, coarse: bool) -> bytes:
    """Encode little-endian Float32 metres or uint16 detail codes."""
    sample = struct.Struct('<f' if coarse else '<H')
    word = struct.Struct('<h')
    if columns < 1 or rows < 1 or len(data) != columns * rows * sample.size:
        raise ValueError('Height grid size mismatch')

    packed = bytearray()
    previous_row = [0] * columns
    for row in range(rows):
        left = upper_left = 0
        for column in range(columns):
            index = row * columns + column
            offset = index * sample.size
            value, = sample.unpack_from(data, offset)
            units = value * FLOAT_SCALE if coarse else value
            # An off-lattice Float32 (including negative zero and nonfinite
            # values) uses its original bytes and contributes zero to prediction.
            exact = (not coarse or (
                -2**31 <= units < 2**31 and int(units) == units
                and (units != 0 or math.copysign(1, units) > 0)
            ))
            upper = previous_row[column]
            delta = int(units) - (left + upper - upper_left) if exact else ESCAPE
            if ESCAPE < delta <= 32767:
                packed.extend(word.pack(delta))
            else:
                packed.extend(word.pack(ESCAPE))
                packed.extend(data[offset:offset + sample.size])
            left = previous_row[column] = int(units) if exact else 0
            upper_left = upper
    return gzip.compress(packed, compresslevel=6, mtime=0)


def gzip_bytes(data: bytes) -> bytes:
    """Deterministic gzip (no timestamp) for the `gzip-v1` downloads."""
    return gzip.compress(data, compresslevel=9, mtime=0)
