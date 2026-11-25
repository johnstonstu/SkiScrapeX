import { describe, expect, it } from 'vitest'
import { addRowRanges } from '../src/fx/rowUpload'

describe('texture row uploads', () => {
  it('adds one single-row range per changed row (three uploads each range as one row)', () => {
    const ranges: { start: number; count: number }[] = []
    addRowRanges({ addUpdateRange: (start, count) => ranges.push({ start, count }) }, 3, 5, 512)
    expect(ranges).toEqual([
      { start: 3 * 512 * 4, count: 512 * 4 },
      { start: 4 * 512 * 4, count: 512 * 4 },
      { start: 5 * 512 * 4, count: 512 * 4 },
    ])
    // No range may span more than one row of pixels.
    for (const r of ranges) expect(r.count).toBeLessThanOrEqual(512 * 4)
  })
})
