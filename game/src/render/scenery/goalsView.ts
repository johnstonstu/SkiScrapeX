import * as THREE from 'three'
import type { Gate, Nugget } from '../../world/challenges'
import { GATE_HALF_WIDTH } from '../../world/challenges'

type HeightAt = (x: number, z: number) => number

const GATE_COLOURS = [0xd8262c, 0x1f5fd1]
const PASSED = new THREE.Color(0x58c46a)
const MISSED = new THREE.Color(0x56595e)

/**
 * How a gate is dressed, as on a real race hill:
 * - `slalom`: a single bare pole at each end (the racer clears the turning pole).
 * - `panel`: at each end a pair of poles 0.75 m apart with a small panel
 *   between them, as GS and downhill gates are set. Nothing spans the gate,
 *   so the course below stays in view.
 */
export type GateStyle = 'slalom' | 'panel'

/** FIS-sized panel: 0.75 m wide, 0.5 m tall, its bottom 0.9 m up. */
const PANEL_WIDTH = 0.75
const PANEL_HEIGHT = 0.5
const PANEL_BASE = 0.9

/**
 * Race gates, red and blue in turn. A passed gate turns green, a missed one
 * grey (the panels, or the poles of a slalom gate).
 */
export function createGatesView(gates: Gate[], heightAt: HeightAt, colours: number[] = GATE_COLOURS, style: GateStyle = 'panel') {
  const group = new THREE.Group()
  group.name = 'slalom'
  const poleHeight = style === 'slalom' ? 1.8 : 1.9
  const poleGeometry = new THREE.CylinderGeometry(0.028, 0.03, poleHeight, 8)
  poleGeometry.translate(0, poleHeight / 2, 0)
  const panelGeometry = new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT)
  /** Per gate: the materials that show pass or miss. */
  const markers: THREE.MeshLambertMaterial[] = []
  /** Per gate: its materials and centre, for fading as the camera passes through. */
  const fades: { materials: THREE.MeshLambertMaterial[]; centre: THREE.Vector3 }[] = []
  const pole = (x: number, z: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(poleGeometry, material)
    mesh.position.set(x, heightAt(x, z) - 0.1, z)
    mesh.castShadow = true
    group.add(mesh)
  }
  gates.forEach((gate, i) => {
    const colour = colours[i % colours.length]
    const half = gate.halfWidth ?? GATE_HALF_WIDTH
    const poleMaterial = new THREE.MeshLambertMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.25, transparent: true })
    const materials = [poleMaterial]
    // Across the direction of travel.
    const ax = gate.dirZ
    const az = -gate.dirX
    const yaw = Math.atan2(gate.dirX, gate.dirZ)
    if (style === 'slalom') {
      for (const sign of [1, -1]) pole(gate.x + sign * ax * half, gate.z + sign * az * half, poleMaterial)
      markers.push(poleMaterial)
    } else {
      const panelMaterial = new THREE.MeshLambertMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.3, side: THREE.DoubleSide, transparent: true })
      materials.push(panelMaterial)
      markers.push(panelMaterial)
      for (const sign of [1, -1]) {
        // Inner pole on the gate line, outer pole 0.75 m further out, the panel between.
        const inner = half
        const outer = half + PANEL_WIDTH
        pole(gate.x + sign * ax * inner, gate.z + sign * az * inner, poleMaterial)
        pole(gate.x + sign * ax * outer, gate.z + sign * az * outer, poleMaterial)
        const mid = (inner + outer) / 2
        const x = gate.x + sign * ax * mid
        const z = gate.z + sign * az * mid
        const panel = new THREE.Mesh(panelGeometry, panelMaterial)
        panel.position.set(x, heightAt(x, z) + PANEL_BASE + PANEL_HEIGHT / 2, z)
        panel.rotation.y = yaw
        group.add(panel)
      }
    }
    const y = (heightAt(gate.x + ax * half, gate.z + az * half) + heightAt(gate.x - ax * half, gate.z - az * half)) / 2 + 1
    fades.push({ materials, centre: new THREE.Vector3(gate.x, y, gate.z) })
  })
  return {
    object: group,
    /** Fade gates the follow camera is about to pass through, so they never fill the screen. */
    update(camera: THREE.Vector3) {
      for (const { materials, centre } of fades) {
        const d = camera.distanceTo(centre)
        const opacity = d > 6 ? 1 : Math.max(0, (d - 2) / 4)
        if (materials[0].opacity === opacity) continue
        for (const material of materials) {
          material.opacity = opacity
          material.depthWrite = opacity === 1
        }
      }
    },
    mark(index: number, result: 'pass' | 'miss') {
      const material = markers[index]
      if (!material) return
      material.color.copy(result === 'pass' ? PASSED : MISSED)
      material.emissive.copy(material.color)
    },
    reset() {
      markers.forEach((material, i) => {
        material.color.setHex(colours[i % colours.length])
        material.emissive.setHex(colours[i % colours.length])
      })
    },
    dispose() {
      poleGeometry.dispose()
      panelGeometry.dispose()
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
