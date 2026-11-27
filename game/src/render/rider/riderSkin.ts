/**
 * The skinned rider body from public/models/rider.glb (built by
 * tools/blender/build_rider.py). Each garment is one skinned mesh whose
 * weights name the rig's joints; it is bound to the rider's own bones, so the
 * procedural animation in skierView.ts drives it unchanged.
 *
 * Garment colours come from three slots (base, accent, trim) picked per texel
 * by the baked mask: R = accent, G = trim, B = ambient occlusion.
 *
 * The GLB holds only geometry (meshopt-compressed by scripts/pack-rider.mjs).
 * Each garment's mask and normal map are separate JPEGs under models/rider/,
 * fetched the first time a rider wears that garment, so the first download is
 * the default outfit rather than every style in the wardrobe.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { applyTextureBudget } from '../textureBudget'
import { createGarmentMaterial, createRiderWeather, type GarmentSurface, type RiderWeather } from './garmentMaterial'

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
  /** Fetches this garment's mask and normal map into `mask` and `normal` (shared by every rider). */
  loadMaps?: () => Promise<void>
}

export interface RiderAsset {
  garments: Map<string, GarmentSource[]>
}

/** Fetch the maps for these garments (all of them when omitted); resolves once they are on their textures. */
export function loadGarmentMaps(asset: RiderAsset, names?: Iterable<string>): Promise<void> {
  const list = names ? [...names] : [...asset.garments.keys()]
  return Promise.all(
    list.flatMap((name) => (asset.garments.get(name) ?? []).map((source) => source.loadMaps?.() ?? Promise.resolve())),
  ).then(() => {})
}

/** The garments a rider shows for one outfit choice. */
export function garmentsFor(choice: { jacket: JacketStyle; pants: PantsStyle; gloves: GloveStyle; headwear: Headwear }): string[] {
  return [`jacket_${choice.jacket}`, `pants_${choice.pants}`, `gloves_${choice.gloves}`, 'head_face', 'head_goggles', `head_${choice.headwear}`]
}

/** A 1x1 stand-in so a garment's material compiles with its final maps before the JPEGs arrive. */
function placeholder(rgb: [number, number, number]): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d')!
  context.fillStyle = `rgb(${rgb.join(',')})`
  context.fillRect(0, 0, 1, 1)
  const texture = new THREE.Texture(canvas)
  texture.flipY = false // glTF UVs
  texture.colorSpace = THREE.NoColorSpace // the mask and the normal map are data
  texture.needsUpdate = true
  applyTextureBudget(texture)
  return texture
}

/** Decodes a JPEG off the main thread where the browser can, without colour management. */
async function fetchImage(url: string): Promise<TexImageSource> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  const blob = await response.blob()
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
    } catch {
      // Older Safari rejects the options; fall back to an <img>.
    }
  }
  const image = new Image()
  image.src = URL.createObjectURL(blob)
  try {
    await image.decode()
  } finally {
    URL.revokeObjectURL(image.src)
  }
  return image
}

/** Gives `source` lazily loaded maps from the file names pack-rider.mjs left in the material's extras. */
function attachLazyMaps(source: GarmentSource, extras: { mask?: string; normal?: string; normalScale?: number }, base: string) {
  if (extras.mask) source.mask = placeholder([0, 0, 255]) // all base colour, no occlusion
  if (extras.normal) {
    source.normal = placeholder([128, 128, 255]) // flat
    source.normalScale.setScalar(extras.normalScale ?? 1)
  }
  let pending: Promise<void> | null = null
  source.loadMaps = () =>
    (pending ??= Promise.all(
      ([[source.mask, extras.mask], [source.normal, extras.normal]] as const).map(async ([texture, file]) => {
        if (!texture || !file) return
        const image = await fetchImage(base + file)
        texture.source = new THREE.Source(image)
        texture.needsUpdate = true
      }),
    ).then(
      () => {},
      (error: unknown) => {
        pending = null // try again next time the garment is shown
        console.warn(`Rider textures for ${source.name} failed to load; showing flat colours.`, error)
      },
    ))
}

let assetPromise: Promise<RiderAsset> | null = null
let gate: Promise<void> = Promise.resolve()

/**
 * Hold the rider GLB download (about 0.6 MB, plus 0.5 MB of maps for the outfit) until the returned function is
 * called, so it does not compete with the terrain on a slow connection. The
 * code-built body shows until then. Call before any rider is created.
 */
export function holdRiderAsset(): () => void {
  let release = () => {}
  gate = new Promise<void>((resolve) => (release = resolve))
  return () => release()
}

/** Loads and caches the rider GLB; every rider shares its geometry and textures. */
export function loadRiderAsset(url = `${import.meta.env.BASE_URL}models/rider.glb`): Promise<RiderAsset> {
  const base = url.slice(0, url.lastIndexOf('/') + 1)
  assetPromise ??= gate.then(() => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url)).then(
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
        const source: GarmentSource = {
          name: garment,
          geometry: mesh.geometry,
          boneNames: mesh.skeleton.bones.map((bone) => bone.name),
          mask: material.map,
          normal: material.normalMap,
          normalScale: material.normalScale.clone(),
          lens: slot === 'lens',
        }
        if (!material.map && !material.normalMap) attachLazyMaps(source, material.userData, base)
        list.push(source)
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

/** Surface and looseness per garment (see GarmentSurface); anything missing gets cloth defaults. */
const SURFACE: Record<string, GarmentSurface> = {
  jacket_shell: { roughness: 0.66, sheen: 0.2, loose: 0.004, band: [1.0, 1.3], sleeve: 0.5 },
  jacket_parkrat: { roughness: 0.82, loose: 0.008, band: [0.8, 1.25], sleeve: 1 },
  jacket_racer: { roughness: 0.42, sheen: 0.12, loose: 0.0008, band: [1.06, 1.2] },
  jacket_hoodie: { roughness: 0.86, loose: 0.004, band: [0.98, 1.25], sleeve: 0.6 },
  jacket_puffer: { roughness: 0.48, sheen: 0.18, loose: 0.002, band: [1.02, 1.2], sleeve: 0.3 },
  pants_baggy: { roughness: 0.82, loose: 0.007, band: [0.25, 0.95] },
  pants_slim: { roughness: 0.8, loose: 0.003, band: [0.25, 0.7] },
  pants_race: { roughness: 0.6, sheen: 0.15 },
  head_helmet: { roughness: 0.3, metalness: 0.05, sheen: 0 },
  head_goggles: { roughness: 0.5, sheen: 0.05 },
  head_face: { roughness: 0.78, sheen: 0.25 },
}

function lensMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.12, metalness: 0.15, emissive: 0x6a2a00 })
}

export interface RiderSkin {
  /** Show one garment per category and colour them. */
  apply(choice: { jacket: JacketStyle; pants: PantsStyle; gloves: GloveStyle; headwear: Headwear }, colours: Record<string, GarmentColours>): void
  setFirstPerson(on: boolean): void
  /** Wind, time and snow for this rider's garments. */
  readonly weather: RiderWeather
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
  const uniforms = new Map<string, ReturnType<typeof createGarmentMaterial>['uniforms']>()
  const weather = createRiderWeather()
  withRestPose(() => {
    for (const [name, sources] of asset.garments) {
      const list: THREE.SkinnedMesh[] = []
      for (const source of sources) {
        let material: THREE.Material
        if (source.lens) material = lensMaterial()
        else {
          const made = createGarmentMaterial(source, SURFACE[source.name] ?? { roughness: 0.82 }, weather)
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
    weather,
    apply(choice, colours) {
      shown = new Set(garmentsFor(choice))
      void loadGarmentMaps(asset, shown)
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
