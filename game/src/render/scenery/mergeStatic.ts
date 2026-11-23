import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * Collects copies of a static part placed many times (posts, caps, board
 * backs) and merges each material's copies into one mesh: one draw call for
 * every sign on the mountain instead of one per part.
 */
export function createStaticBatch() {
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>()
  const place = new THREE.Object3D()
  return {
    /** Add `geometry` placed at `matrix` (world, or the batch's parent space). */
    add(geometry: THREE.BufferGeometry, material: THREE.Material, matrix: THREE.Matrix4) {
      const copy = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).applyMatrix4(matrix)
      for (const name of Object.keys(copy.attributes)) if (!['position', 'normal', 'uv'].includes(name)) copy.deleteAttribute(name)
      const list = byMaterial.get(material) ?? []
      list.push(copy)
      byMaterial.set(material, list)
    },
    /** Matrix for an object at `position` turned `yaw` about +Y, then offset by a child transform. */
    matrix(position: THREE.Vector3, yaw: number, child?: THREE.Object3D): THREE.Matrix4 {
      place.position.copy(position)
      place.rotation.set(0, yaw, 0)
      place.updateMatrix()
      if (!child) return place.matrix.clone()
      child.updateMatrix()
      return place.matrix.clone().multiply(child.matrix)
    },
    /** The merged meshes, one per material; the source copies are freed. */
    build(castShadow = true): THREE.Mesh[] {
      const meshes: THREE.Mesh[] = []
      for (const [material, list] of byMaterial) {
        const merged = mergeGeometries(list, false)
        for (const piece of list) piece.dispose()
        if (!merged) continue
        const mesh = new THREE.Mesh(merged, material)
        mesh.castShadow = castShadow
        meshes.push(mesh)
      }
      byMaterial.clear()
      return meshes
    },
  }
}
