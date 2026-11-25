/**
 * The skinned rider body from public/models/rider.glb (built by
 * tools/blender/build_rider.py). Each garment is one skinned mesh whose
 * weights name the rig's joints; it is bound to the rider's own bones, so the
 * procedural animation in skierView.ts drives it unchanged.
 *
 * Garment colours come from three slots (base, accent, trim) picked per texel
 * by the baked mask: R = accent, G = trim, B = ambient occlusion.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { applyTextureBudget } from '../textureBudget'

export type JacketStyle = 'shell' | 'parkrat' | 'racer' | 'hoodie' | 'puffer'
export type PantsStyle = 'baggy' | 'slim' | 'race'
export type GloveStyle = 'mitt' | 'glove' | 'pipe'
export type Headwear = 'helmet' | 'beanie' | 'cap'

export const JACKET_STYLES: JacketStyle[] = ['shell', 'parkrat', 'racer', 'hoodie', 'puffer']
export const PANTS_STYLES: PantsStyle[] = ['baggy', 'slim', 'race']
export const GLOVE_STYLES: GloveStyle[] = ['mitt', 'glove', 'pipe']
export const HEADWEAR: Headwear[] = ['helmet', 'beanie', 'cap']

interface GarmentSource {
  name: string
  geometry: THREE.BufferGeometry
  boneNames: string[]
  mask: THREE.Texture | null
  normal: THREE.Texture | null
  normalScale: THREE.Vector2
  lens: boolean
}

export interface RiderAsset {
  garments: Map<string, GarmentSource[]>
}

let assetPromise: Promise<RiderAsset> | null = null

/** Loads and caches the rider GLB; every rider shares its geometry and textures. */
export function loadRiderAsset(url = `${import.meta.env.BASE_URL}models/rider.glb`): Promise<RiderAsset> {
  assetPromise ??= new GLTFLoader().loadAsync(url).then(
    (gltf) => {
      const garments = new Map<string, GarmentSource[]>()
      gltf.scene.updateMatrixWorld(true)
      gltf.scene.traverse((object) => {
        const mesh = object as THREE.SkinnedMesh
        if (!mesh.isSkinnedMesh) return
        const material = mesh.material as THREE.MeshStandardMaterial
        const [garment, slot] = material.name.split('|')
        for (const texture of [material.map, material.normalMap]) if (texture) applyTextureBudget(texture)
        if (material.map) {
          // The base colour texture is the mask: data, not colour.
          material.map.colorSpace = THREE.NoColorSpace
          material.map.needsUpdate = true
        }
        const list = garments.get(garment) ?? []
        list.push({
          name: garment,
          geometry: mesh.geometry,
          boneNames: mesh.skeleton.bones.map((bone) => bone.name),
          mask: material.map,
          normal: material.normalMap,
          normalScale: material.normalScale.clone(),
          lens: slot === 'lens',
        })
        garments.set(garment, list)
      })
      if (!garments.size) throw new Error(`rider asset ${url} has no skinned garments`)
      return { garments }
    },
    (error: unknown) => {
      assetPromise = null
      throw new Error(`Could not load the rider model ${url}: ${error instanceof Error ? error.message : String(error)}`)
    },
  )
  return assetPromise
}

/** Colours for one garment's three slots. */
export interface GarmentColours {
  base: THREE.ColorRepresentation
  accent: THREE.ColorRepresentation
  trim: THREE.ColorRepresentation
}

const SURFACE: Record<string, { roughness: number; metalness?: number; normal?: number }> = {
  jacket_racer: { roughness: 0.45 },
  jacket_puffer: { roughness: 0.5 },
  jacket_shell: { roughness: 0.68 },
  head_helmet: { roughness: 0.32, metalness: 0.05 },
  head_goggles: { roughness: 0.55 },
  head_face: { roughness: 0.75 },
}

/** A standard material that colours from the mask; programs are shared by every garment. */
function garmentMaterial(source: GarmentSource) {
  const surface = SURFACE[source.name] ?? { roughness: 0.82 }
  const material = new THREE.MeshStandardMaterial({
    map: source.mask,
    normalMap: source.normal,
    normalScale: source.normalScale.clone().multiplyScalar(surface.normal ?? 1),
    roughness: surface.roughness,
    metalness: surface.metalness ?? 0,
  })
  const uniforms = {
    uBase: { value: new THREE.Color() },
    uAccent: { value: new THREE.Color() },
    uTrim: { value: new THREE.Color() },
  }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uBase;\nuniform vec3 uAccent;\nuniform vec3 uTrim;')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 garmentMask = texture2D( map, vMapUv );
          vec3 garmentColour = mix( mix( uBase, uAccent, garmentMask.r ), uTrim, garmentMask.g );
          diffuseColor.rgb *= garmentColour * garmentMask.b;
        #endif`,
      )
  }
  material.customProgramCacheKey = () => 'rider-garment'
  return { material, uniforms }
}

function lensMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.12, metalness: 0.15, emissive: 0x6a2a00 })
}

export interface RiderSkin {
  /** Show one garment per category and colour them. */
  apply(choice: { jacket: JacketStyle; pants: PantsStyle; gloves: GloveStyle; headwear: Headwear }, colours: Record<string, GarmentColours>): void
  setFirstPerson(on: boolean): void
}

/**
 * Builds this rider's skinned garments and binds them to `bones` while the rig
 * is in its bind pose. `parent` is the rig root: garment vertices are in root space.
 */
export function createRiderSkin(
  asset: RiderAsset,
  parent: THREE.Object3D,
  bones: Record<string, THREE.Bone>,
  withRestPose: (fn: () => void) => void,
): RiderSkin {
  const meshes = new Map<string, THREE.SkinnedMesh[]>()
  const uniforms = new Map<string, ReturnType<typeof garmentMaterial>['uniforms']>()
  withRestPose(() => {
    for (const [name, sources] of asset.garments) {
      const list: THREE.SkinnedMesh[] = []
      for (const source of sources) {
        let material: THREE.Material
        if (source.lens) material = lensMaterial()
        else {
          const made = garmentMaterial(source)
          material = made.material
          uniforms.set(name, made.uniforms)
        }
        const mesh = new THREE.SkinnedMesh(source.geometry, material)
        mesh.name = name
        mesh.castShadow = true
        mesh.visible = false
        parent.add(mesh)
        mesh.updateMatrixWorld(true)
        const skeleton = new THREE.Skeleton(
          source.boneNames.map((boneName) => {
            const bone = bones[boneName]
            if (!bone) throw new Error(`Rider garment ${name} uses joint ${boneName}, which the rig does not have`)
            return bone
          }),
        )
        mesh.bind(skeleton, mesh.matrixWorld)
        // Poses stay within this sphere (the rest pose is about 2.1 m tall).
        mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 1.5)
        list.push(mesh)
      }
      meshes.set(name, list)
    }
  })

  let shown = new Set<string>()
  let firstPerson = false
  const refresh = () => {
    for (const [name, list] of meshes) {
      const head = name.startsWith('head_')
      for (const mesh of list) mesh.visible = shown.has(name) && !(firstPerson && head)
    }
  }

  return {
    apply(choice, colours) {
      shown = new Set([
        `jacket_${choice.jacket}`, `pants_${choice.pants}`, `gloves_${choice.gloves}`,
        'head_face', 'head_goggles', `head_${choice.headwear}`,
      ])
      for (const [name, slot] of uniforms) {
        const colour = colours[name.split('_')[0]] ?? colours[name]
        const own = colours[name] ?? colour
        if (!own) continue
        slot.uBase.value.set(own.base)
        slot.uAccent.value.set(own.accent)
        slot.uTrim.value.set(own.trim)
      }
      refresh()
    },
    setFirstPerson(on) {
      firstPerson = on
      refresh()
    },
  }
}
