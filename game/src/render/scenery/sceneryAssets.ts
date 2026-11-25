/**
 * Hand-modelled scenery from public/models/scenery/*.glb (built by
 * tools/blender/build_lifts.py and friends). Each GLB holds named assets: an
 * empty per asset with its meshes (one per material) as children.
 *
 * Loaded before the stage is built so views can use the models directly; if a
 * file fails to load the views keep their code-built versions.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export type AssetSet = Map<string, THREE.Object3D>

export interface SceneryAssets {
  lifts: AssetSet | null
}

async function loadSet(file: string): Promise<AssetSet | null> {
  const url = `${import.meta.env.BASE_URL}models/scenery/${file}`
  try {
    const gltf = await new GLTFLoader().loadAsync(url)
    const set: AssetSet = new Map()
    for (const child of gltf.scene.children) set.set(child.name, child)
    return set
  } catch (error) {
    console.error(`Scenery model ${url} failed to load; keeping the code-built versions.`, error)
    return null
  }
}

/** Every scenery GLB, fetched in parallel. Never rejects: missing sets are null. */
export async function loadSceneryAssets(): Promise<SceneryAssets> {
  const [lifts] = await Promise.all([loadSet('lifts.glb')])
  return { lifts }
}

/** A placed copy of an asset; meshes keep their own materials (shared with other copies). */
export function placeAsset(set: AssetSet, name: string): THREE.Object3D | null {
  const asset = set.get(name)
  if (!asset) return null
  const copy = asset.clone(true)
  copy.position.set(0, 0, 0)
  copy.rotation.set(0, 0, 0)
  copy.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) object.castShadow = true
  })
  return copy
}

/**
 * An asset as one geometry with a group per material, for instancing. Child
 * transforms are baked in, relative to the asset's origin.
 */
export function mergedAsset(set: AssetSet, name: string): { geometry: THREE.BufferGeometry; materials: THREE.Material[] } | null {
  const asset = set.get(name)
  if (!asset) return null
  asset.updateMatrixWorld(true)
  const toAsset = new THREE.Matrix4().copy(asset.matrixWorld).invert()
  const parts: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  asset.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const geometry = mesh.geometry.clone()
    for (const key of Object.keys(geometry.attributes)) if (key !== 'position' && key !== 'normal') geometry.deleteAttribute(key)
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toAsset, mesh.matrixWorld))
    parts.push(geometry.index ? geometry.toNonIndexed() : geometry)
    materials.push(mesh.material as THREE.Material)
  })
  if (!parts.length) return null
  const geometry = mergeGeometries(parts, true)
  for (const part of parts) part.dispose()
  if (!geometry) throw new Error(`Scenery asset ${name} has parts that cannot be merged`)
  return { geometry, materials }
}

/** Meshes of a placed asset whose own name or an ancestor's starts with `prefix`. */
export function partsNamed(object: THREE.Object3D, prefix: string): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  object.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return
    for (let node: THREE.Object3D | null = child; node && node !== object.parent; node = node.parent) {
      if (node.name.startsWith(prefix)) {
        out.push(child as THREE.Mesh)
        return
      }
    }
  })
  return out
}
