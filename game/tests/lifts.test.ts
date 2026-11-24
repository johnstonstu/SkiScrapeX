import { expect, it } from 'vitest'
import { InstancedMesh, Matrix4, Mesh, Vector3 } from 'three'
import { createLiftView, sampleRide } from '../src/render/scenery/liftView'
import type { Lift } from '../src/world/resort'

it('builds a blue T-bar drive, yellow return, and portal towers', () => {
  const lift: Lift = {
    id: 'tbar',
    name: 'T-Bar',
    type: 't-bar',
    bottom: [10, 20],
    top: [110, 220],
    towers: [[40, 80], [70, 140]],
    line: [[10, 20], [110, 220]],
  }
  const view = createLiftView([lift], (_x, z) => z * 0.2)
  let blue = 0
  let yellow = 0
  view.object.traverse((child) => {
    if (!(child instanceof Mesh)) return
    const hex = (child.material as { color?: { getHex(): number } }).color?.getHex()
    if (hex === 0x1f4f86) blue++
    if (hex === 0xc4a035) yellow++
  })
  expect(blue).toBeGreaterThan(0)
  expect(yellow).toBeGreaterThan(0)
  expect(view.ride(lift.id)?.onSnow).toBe(true)
  view.dispose()
})

it('builds Magic Carpet rails and a non-aerial ride path', () => {
  const lift: Lift = {
    id: 'carpet',
    name: 'Magic Carpet',
    type: 'magic_carpet',
    bottom: [0, 0],
    top: [0, 40],
    towers: [],
    line: [[0, 0], [0, 20], [0, 40]],
  }
  const view = createLiftView([lift], () => 10)
  let rails = 0
  view.object.traverse((child) => {
    if (child instanceof Mesh && (child.material as { color?: { getHex(): number } }).color?.getHex() === 0x8a9098) rails++
  })
  expect(rails).toBeGreaterThan(0)
  expect(view.ride(lift.id)?.aerial).toBe(false)
  view.dispose()
})

it('builds open green Stock\'s terminals instead of a Uni hood', () => {
  const lift: Lift = {
    seats: 3,
    id: 'stocks',
    name: "Stock's Chair",
    type: 'chair_lift',
    bottom: [10, 20],
    top: [210, 320],
    towers: [[110, 170]],
    line: [[10, 20], [210, 320]],
  }
  const view = createLiftView([lift], (_x, z) => z * 0.2)
  const ride = view.ride(lift.id)!
  expect(ride.speed).toBeCloseTo(2.28, 2)
  let greens = 0
  view.object.traverse((child) => {
    if (child instanceof Mesh && (child.material as { color?: { getHex(): number } }).color?.getHex() === 0x3f6b3a) greens++
  })
  expect(greens).toBeGreaterThan(0)
  view.dispose()
})

it.each([3, 4])('keeps the rider on the same %i-seat chair during fast-forward', seats => {
  const lift: Lift = {
    seats, id: 'lift', name: 'Test chair', type: 'chair_lift',
    bottom: [10, 20], top: [210, 320], towers: [[110, 170]], line: [[10, 20], [210, 320]],
  }
  const view = createLiftView([lift], (_x, z) => z * 0.2)
  view.update(21)
  const ride = view.ride(lift.id)!
  const chairs = view.object.children.find(child => child instanceof InstancedMesh) as InstancedMesh
  let distance = ride.boardingDistance
  const grip = new Vector3()
  const matrix = new Matrix4()
  const position = new Vector3()
  let occupied = -1
  for (const scale of [1, 6, 1]) {
    const dt = 1.25
    view.update(dt, scale === 6 ? lift.id : undefined)
    distance += dt * ride.speed * scale
    sampleRide(ride, distance, grip)
    grip.y += 2.69 // Seated rider origin to rope.
    if (occupied < 0) {
      for (let i = 0; i < chairs.count; i++) {
        chairs.getMatrixAt(i, matrix)
        if (position.setFromMatrixPosition(matrix).distanceTo(grip) < 0.001) occupied = i
      }
    }
    expect(occupied).toBeGreaterThanOrEqual(0)
    chairs.getMatrixAt(occupied, matrix)
    expect(position.setFromMatrixPosition(matrix).distanceTo(grip)).toBeLessThan(0.001)
  }
  view.dispose()
})
