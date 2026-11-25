/**
 * Mark rows `min`..`max` of an RGBA8 data texture for upload. three.js uploads
 * each update range as a single row (`texSubImage2D` with height 1), so a range
 * spanning several rows is rejected by WebGL ("width or height out of range")
 * and nothing changes on the GPU. One range per row; three merges nothing
 * across rows, and a few dozen small uploads are still far cheaper than the
 * whole texture.
 */
export function addRowRanges(texture: { addUpdateRange(start: number, count: number): void }, min: number, max: number, width: number): void {
  for (let row = min; row <= max; row++) texture.addUpdateRange(row * width * 4, width * 4)
}
