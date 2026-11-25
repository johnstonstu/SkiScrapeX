import * as THREE from 'three'
import type { Gate, Nugget } from '../../world/challenges'
import { GATE_HALF_WIDTH } from '../../world/challenges'

type HeightAt = (x: number, z: number) => number

const GATE_COLOURS = [0xd8262c, 0x1f5fd1]
const PASSED = new THREE.Color(0x58c46a)
const MISSED = new THREE.Color(0x56595e)

/**
 * Slalom gates: two poles and a banner between them, red and blue in turn.
 * A passed gate turns green, a missed one grey.
 */
export function createGatesView(gates: Gate[], heightAt: HeightAt, colours: number[] = GATE_COLOURS) {
  const group = new THREE.Group()
  group.name = 'slalom'
  // Race-sized: stubby poles read as nothing at 40 m, so these are thick, tall and bright.
  const poleGeometry = new THREE.CylinderGeometry(0.05, 0.05, 2.3, 8)
  poleGeometry.translate(0, 1.15, 0)
  const bannerGeometries = new Map<number, THREE.PlaneGeometry>()
  const bannerFor = (half: number) => {
    let geometry = bannerGeometries.get(half)
    if (!geometry) bannerGeometries.set(half, (geometry = new THREE.PlaneGeometry(half * 2, 0.9)))
    return geometry
  }
  const banners: THREE.MeshLambertMaterial[] = []
  /** Per gate: its materials and centre, for fading as the camera passes through. */
  const fades: { materials: THREE.MeshLambertMaterial[]; centre: THREE.Vector3 }[] = []
  gates.forEach((gate, i) => {
    const colour = colours[i % colours.length]
    const half = gate.halfWidth ?? GATE_HALF_WIDTH
    const pole = new THREE.MeshLambertMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.25 })
    const banner = new THREE.MeshLambertMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.3, side: THREE.DoubleSide })
    banners.push(banner)
    // Poles either side across the direction of travel.
    const px = gate.dirZ * half
    const pz = -gate.dirX * half
    const ends: [number, number][] = [
      [gate.x + px, gate.z + pz],
      [gate.x - px, gate.z - pz],
    ]
    const heights = ends.map(([x, z]) => heightAt(x, z))
    for (const [k, [x, z]] of ends.entries()) {
      const mesh = new THREE.Mesh(poleGeometry, pole)
      mesh.position.set(x, heights[k] - 0.1, z)
      mesh.castShadow = true
      group.add(mesh)
    }
    const flag = new THREE.Mesh(bannerFor(half), banner)
    flag.position.set(gate.x, (heights[0] + heights[1]) / 2 + 1.5, gate.z)
    flag.rotation.y = Math.atan2(gate.dirX, gate.dirZ)
    group.add(flag)
    for (const material of [pole, banner]) material.transparent = true
    fades.push({ materials: [pole, banner], centre: flag.position.clone() })
  })
  return {
    object: group,
    /** Fade gates the follow camera is about to pass through, so they never fill the screen. */
    update(camera: THREE.Vector3) {
      for (const { materials, centre } of fades) {
        const d = camera.distanceTo(centre)
        const opacity = d > 7 ? 1 : Math.max(0, (d - 2.5) / 4.5)
        if (materials[0].opacity === opacity) continue
        for (const material of materials) {
          material.opacity = opacity
          material.depthWrite = opacity === 1
        }
      }
    },
    mark(index: number, result: 'pass' | 'miss') {
      const material = banners[index]
      if (!material) return
      material.color.copy(result === 'pass' ? PASSED : MISSED)
      material.emissive.copy(material.color)
    },
    reset() {
      banners.forEach((material, i) => {
        material.color.setHex(colours[i % colours.length])
        material.emissive.setHex(colours[i % colours.length])
      })
    },
    dispose() {
      poleGeometry.dispose()
      for (const geometry of bannerGeometries.values()) geometry.dispose()
      group.traverse((object) => {
        const material = (object as THREE.Mesh).material as THREE.Material | undefined
        material?.dispose()
      })
    },
  }
}

/** Gold nuggets: lumpy, shiny, slowly turning and bobbing. Found ones disappear. */
export function createNuggetsView(nuggets: Nugget[], heightAt: HeightAt, found: Set<string>) {
  const group = new THREE.Group()
  group.name = 'nuggets'
  const geometry = new THREE.IcosahedronGeometry(0.4, 1)
  // Knock the vertices about so it reads as a lump, not a gem.
  const position = geometry.attributes.position
  for (let i = 0; i < position.count; i++) {
    const k = 0.8 + 0.35 * Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1)
    position.setXYZ(i, position.getX(i) * k * 1.2, position.getY(i) * k * 0.8, position.getZ(i) * k)
  }
  geometry.computeVertexNormals()
  // Low metalness: there is no environment map, so a true metal renders dark.
  const material = new THREE.MeshStandardMaterial({ color: 0xffc83a, metalness: 0.35, roughness: 0.3, emissive: 0xa86f00, emissiveIntensity: 0.7, flatShading: true })
  // A glint above each nugget, so it catches the eye between trees.
  const glintTexture = (() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    const g = canvas.getContext('2d')!
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(255,250,215,1)')
    grad.addColorStop(0.25, 'rgba(255,220,120,0.55)')
    grad.addColorStop(1, 'rgba(255,200,80,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
    g.fillStyle = 'rgba(255,252,230,0.9)'
    g.fillRect(30, 4, 4, 56)
    g.fillRect(4, 30, 56, 4)
    return new THREE.CanvasTexture(canvas)
  })()
  const glintMaterial = new THREE.SpriteMaterial({ map: glintTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  const meshes = new Map<string, { mesh: THREE.Mesh; glint: THREE.Sprite; base: number }>()
  for (const nugget of nuggets) {
    if (found.has(nugget.id)) continue
    const mesh = new THREE.Mesh(geometry, material)
    const base = heightAt(nugget.x, nugget.z) + 0.9
    mesh.position.set(nugget.x, base, nugget.z)
    mesh.castShadow = true
    const glint = new THREE.Sprite(glintMaterial.clone())
    glint.position.set(nugget.x, base + 0.35, nugget.z)
    group.add(mesh, glint)
    meshes.set(nugget.id, { mesh, glint, base })
  }
  let time = 0
  return {
    object: group,
    update(dt: number) {
      time += dt
      material.emissiveIntensity = 0.6 + 0.3 * Math.sin(time * 3)
      let i = 0
      for (const { mesh, glint, base } of meshes.values()) {
        mesh.rotation.y = time * 1.2 + i
        mesh.position.y = base + Math.sin(time * 2 + i) * 0.12
        // Twinkle: a quick flare every couple of seconds, out of step between nuggets.
        const phase = (time * 0.55 + i * 0.37) % 1
        const flare = phase < 0.12 ? Math.sin((phase / 0.12) * Math.PI) : 0
        glint.scale.setScalar(0.5 + flare * 1.3)
        glint.material.opacity = 0.35 + flare * 0.65
        glint.position.y = mesh.position.y + 0.3
        i++
      }
    },
    remove(id: string) {
      const entry = meshes.get(id)
      if (!entry) return
      group.remove(entry.mesh, entry.glint)
      meshes.delete(id)
    },
  }
}
