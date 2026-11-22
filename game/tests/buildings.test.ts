import { describe, expect, it } from 'vitest'
import { buildBuildings, indexBuildings, orientedBox, pushOutOfRing } from '../src/world/buildings'

describe('buildings', () => {
  const flat = () => 10
  const rotated = (cx: number, cz: number, l: number, w: number, angle: number) => {
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    return [
      [-l, -w],
      [l, -w],
      [l, w],
      [-l, w],
    ].map(([u, v]) => ({ x: cx + u * c - v * s, z: cz + u * s + v * c }))
  }

  it('finds the oriented box of a rotated rectangle', () => {
    const ring = rotated(50, 60, 9, 5, 0.4).map((p): [number, number] => [p.x, p.z])
    const box = orientedBox(ring)
    expect(box.halfLength).toBeCloseTo(9, 5)
    expect(box.halfWidth).toBeCloseTo(5, 5)
    expect(box.centre[0]).toBeCloseTo(50, 5)
    expect(box.centre[1]).toBeCloseTo(60, 5)
    expect(Math.abs(box.axis[0] * Math.cos(0.4) + box.axis[1] * Math.sin(0.4))).toBeCloseTo(1, 5)
  })

  it('gives box-like houses a gable roof and stacks storeys from the high side', () => {
    const [house] = buildBuildings([{ id: 'way/1', building: 'house', points: rotated(0, 0, 8, 5, 0) }], flat)
    expect(house.roof).not.toBeNull()
    expect(house.eaves).toBeCloseTo(16)
    expect(house.base).toBeLessThan(10)
    const [tagged] = buildBuildings(
      [{ id: 'way/2', building: 'yes', tags: { 'building:levels': '5' }, points: rotated(0, 0, 8, 5, 0) }],
      flat,
    )
    expect(tagged.eaves).toBeCloseTo(25)
  })

  it('uses a flat roof for an L-shaped footprint and indexes it for collisions', () => {
    const l = [
      { x: 0, z: 0 },
      { x: 30, z: 0 },
      { x: 30, z: 10 },
      { x: 10, z: 10 },
      { x: 10, z: 30 },
      { x: 0, z: 30 },
    ]
    const buildings = buildBuildings([{ id: 'way/3', points: l }], flat)
    expect(buildings[0].roof).toBeNull()
    const index = indexBuildings(buildings)
    expect(index.hit(5, 25)).not.toBeNull()
    expect(index.hit(20, 20)).toBeNull()
  })
})

describe('pushOutOfRing', () => {
  it('moves a point inside a footprint just past the nearest wall', () => {
    const ring: [number, number][] = [[0, 0], [10, 0], [10, 6], [0, 6]]
    const out = pushOutOfRing(9, 3, ring, 0.3)
    expect(out.x).toBeCloseTo(10.3)
    expect(out.z).toBeCloseTo(3)
    expect(out.nx).toBeCloseTo(1)
    const bottom = pushOutOfRing(4, 0.5, ring, 0.3)
    expect(bottom.z).toBeCloseTo(-0.3)
    expect(bottom.nz).toBeCloseTo(-1)
  })
})
