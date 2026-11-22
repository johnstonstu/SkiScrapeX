import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * Bake every plain, static mesh under `root` into one mesh per material
 * (world transforms applied relative to `root`). Instanced meshes, lines,
 * sprites and anything named in `keep` stay as they are. Cuts draw calls for
 * scenery built from many small parts (lift towers, the hut, park features).
 */
export function mergeStatic(root: THREE.Object3D, keep: (object: THREE.Object3D) => boolean = () => false): number {
  root.updateMatrixWorld(true)
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const byMaterial = new Map<THREE.Material, { parts: THREE.BufferGeometry[]; cast: boolean; receive: boolean }>()
  const victims: THREE.Mesh[] = []
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || keep(object)) return
    if (Array.isArray(object.material) || !object.visible) return
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone()
    for (const name of Object.keys(geometry.attributes)) if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name)
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, object.matrixWorld))
    const entry = byMaterial.get(object.material) ?? { parts: [], cast: false, receive: false }
    entry.parts.push(geometry)
    entry.cast ||= object.castShadow
    entry.receive ||= object.receiveShadow
    byMaterial.set(object.material, entry)
    victims.push(object)
  })
  if (victims.length < 2) return 0
  for (const mesh of victims) {
    mesh.removeFromParent()
    mesh.geometry.dispose()
  }
  for (const [material, entry] of byMaterial) {
    const merged = mergeGeometries(entry.parts)
    for (const part of entry.parts) part.dispose()
    if (!merged) continue
    const mesh = new THREE.Mesh(merged, material)
    mesh.castShadow = entry.cast
    mesh.receiveShadow = entry.receive
    mesh.name = `${root.name || 'merged'}-static`
    root.add(mesh)
  }
  return victims.length - byMaterial.size
}
