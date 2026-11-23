/** Decode the little-endian residual stream after gzip inflation. */
export function unpackHeights(
  buffer: ArrayBuffer,
  columns: number,
  rows: number,
  coarse: boolean,
): ArrayBuffer {
  const sampleBytes = coarse ? 4 : 2
  const count = columns * rows
  if (!Number.isSafeInteger(columns) || !Number.isSafeInteger(rows) || columns < 1 || rows < 1 ||
      buffer.byteLength < count * 2 || buffer.byteLength > count * (2 + sampleBytes)) {
    throw new Error('Packed height grid size mismatch')
  }

  const source = new DataView(buffer)
  const raw = new ArrayBuffer(count * sampleBytes)
  const output = new DataView(raw)
  const previousRow = new Int32Array(columns)
  let cursor = 0
  for (let row = 0; row < rows; row++) {
    let left = 0
    let upperLeft = 0
    for (let column = 0; column < columns; column++) {
      const offset = (row * columns + column) * sampleBytes
      const upper = previousRow[column]
      if (cursor + 2 > source.byteLength) throw new Error('Truncated packed height grid')
      const delta = source.getInt16(cursor, true)
      cursor += 2
      let units: number
      if (delta === -32768) {
        if (cursor + sampleBytes > source.byteLength) throw new Error('Truncated packed height sample')
        if (coarse) {
          output.setUint32(offset, source.getUint32(cursor, true), true)
          const scaled = output.getFloat32(offset, true) * 8192
          units = isInt32(scaled) && !Object.is(scaled, -0) ? scaled : 0
        } else {
          units = source.getUint16(cursor, true)
          output.setUint16(offset, units, true)
        }
        cursor += sampleBytes
      } else {
        units = left + upper - upperLeft + delta
        if (coarse) {
          const height = units / 8192
          if (!isInt32(units) || Math.fround(height) !== height) throw new Error('Invalid packed coarse height')
          output.setFloat32(offset, height, true)
        } else {
          if (units < 0 || units > 65535) throw new Error('Invalid packed detail height')
          output.setUint16(offset, units, true)
        }
      }
      previousRow[column] = left = units
      upperLeft = upper
    }
  }
  if (cursor !== source.byteLength) throw new Error('Trailing packed height data')
  return raw
}

function isInt32(value: number): boolean {
  return (value | 0) === value
}
