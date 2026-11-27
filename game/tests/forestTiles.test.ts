import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createForestView, SIGHT_LINE } from '../src/render/scenery/forestView'
import type { Forest, Tree } from '../src/world/forest'

/** A 6 x 6 grid of 192 m chunks, 40 trees each, well away from the skier. */
function testForest(): Forest {
  const chunkSize = 192
  const chunks = []
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      const cx = 7680 + (i + 0.5) * chunkSize
      const cz = 7680 + (j + 0.5) * chunkSize
      const trees: Tree[] = Array.from({ length: 40 }, (_, k) => ({
        x: cx - 90 + (k % 8) * 22, z: cz - 90 + Math.floor(k / 8) * 40, y: 1500, height: 12 + (k % 5),
        rotation: k, species: k % 4, tone: 0.8 + (k % 3) * 0.05,
      }) as Tree)
      chunks.push({ cx, cz, trees })
    }
  }
  return { chunkSize, chunks, count: 36 * 40, source: 'procedural' }
}

/** Visible forest meshes and the instances they draw. */
function census(group: THREE.Object3D) {
  let draws = 0
  let instances = 0
  group.traverse((object) => {
    const mesh = object as THREE.InstancedMesh
    if (!mesh.isInstancedMesh || !mesh.visible || mesh.count === 0) return
    draws++
    instances += mesh.count
  })
  return { draws, instances }
}

describe('forest far tiles', () => {
  const detail = { near: 150, mid: 600, midShare: 0.45, farShare: 0.1 }
  SIGHT_LINE.to.value.set(0, -1e6, 0)

  it('draws distant chunks a tile at a time with the same trees', () => {
    const view = createForestView(testForest(), detail)
    view.update(new THREE.Vector3(0, 1500, 0))
    const { draws, instances } = census(view.object)
    // 36 chunks fall in 4 tiles of 768 m (the grid straddles tile edges: 4x4, 4x2, 2x4, 2x2).
    expect(draws).toBe(4)
    expect(instances).toBe(36 * Math.ceil(40 * detail.farShare))
    expect(view.drawn).toBe(instances)
  })

  it('splits a tile back into chunks when the camera comes close', () => {
    const view = createForestView(testForest(), detail)
    view.update(new THREE.Vector3(0, 1500, 0))
    view.update(new THREE.Vector3(7680 + 96, 1500, 7680 + 96))
    const { draws } = census(view.object)
    expect(draws).toBeGreaterThan(4)
    // Back out again: merged.
    view.update(new THREE.Vector3(0, 1500, 0))
    expect(census(view.object).draws).toBe(4)
  })

  it('rebuilds tiles when the far share changes', () => {
    const live = { ...detail }
    const view = createForestView(testForest(), live)
    view.update(new THREE.Vector3(0, 1500, 0))
    live.farShare = 0.3
    view.update(new THREE.Vector3(0, 1500, 0))
    expect(census(view.object).instances).toBe(36 * Math.ceil(40 * 0.3))
  })
})
