import * as THREE from 'three'

const size = 32
const pixels = new Uint8Array(size * size * 4)
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const index = (y * size + x) * 4
    const twill = Math.cos((x + y * 2) * Math.PI / 4)
    const threads = Math.cos(x * Math.PI / 4) * Math.cos(y * Math.PI / 4)
    const height = 128 + twill * 26 + threads * 19
    pixels.set([height, height, height, 255], index)
  }
}

/** A shared twill bump map so every outfit colour still uses its original palette. */
export const fabricWeave = new THREE.DataTexture(pixels, size, size)
fabricWeave.wrapS = fabricWeave.wrapT = THREE.RepeatWrapping
fabricWeave.repeat.set(7, 5)
fabricWeave.magFilter = THREE.LinearFilter
fabricWeave.minFilter = THREE.LinearMipmapLinearFilter
fabricWeave.generateMipmaps = true
fabricWeave.needsUpdate = true

/** Keep the waist anchored, allowing the lowest jacket panels to follow the hem. */
function addHemMorphs(geometry: THREE.BufferGeometry, hem: number): void {
  const positions = geometry.getAttribute('position')
  const side = new Float32Array(positions.count * 3)
  const back = new Float32Array(side.length)
  for (let i = 0; i < positions.count; i++) {
    const weight = THREE.MathUtils.clamp(1 - (positions.getY(i) - hem) / 0.22, 0, 1) ** 2
    side[i * 3] = weight * 0.1
    back[i * 3 + 2] = weight * 0.1
  }
  geometry.morphTargetsRelative = true
  geometry.morphAttributes.position = [new THREE.BufferAttribute(side, 3), new THREE.BufferAttribute(back, 3)]
}

/** A closed jacket shell, blended through the waist between the spine and chest. */
export function jacketGeometry(baggy: boolean) {
  const k = baggy ? 1.06 : 0.94
  const hem = baggy ? -0.2 : -0.08
  const profile = [
    [0.001, hem + 0.05], [0.15 * k, hem + 0.02], [0.185 * k, hem],
    [0.208 * k, hem + 0.05], [0.2 * k, 0.04], [0.197 * k, 0.13],
    [0.199 * k, 0.21], [0.207 * k, 0.28], [0.219 * k, 0.35],
    [0.228 * k, 0.4], [0.222 * k, 0.47], [0.19 * k, 0.53],
    [0.12, 0.575], [0.09, 0.6], [0.001, 0.6],
  ].filter(([, y], i, rings) => i < 4 || y > rings[3][1])
  const geometry = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 24)
  geometry.scale(1, 1, 0.72)
  const positions = geometry.getAttribute('position')
  const joints = new Uint16Array(positions.count * 4)
  const weights = new Float32Array(joints.length)
  for (let i = 0; i < positions.count; i++) {
    const blend = THREE.MathUtils.smoothstep(positions.getY(i), 0.09, 0.38)
    joints[i * 4 + 1] = 1
    weights[i * 4] = 1 - blend
    weights[i * 4 + 1] = blend
  }
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(joints, 4))
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4))
  addHemMorphs(geometry, hem)
  return { geometry, hem }
}
