import * as THREE from 'three'
import { outcropTop, topHeight, type Outcrop } from '../../world/cliffs'

/**
 * Rock outcrops: a snowy top that meets the slope at its uphill edge, a
 * faceted rock face at the lip with snow lodged on its ledges, and rock
 * sides. Flat-shaded triangles, vertex colours, all outcrops in one mesh.
 */
export function createCliffView(outcrops: Outcrop[], heightAt: (x: number, z: number) => number) {
  const positions: number[] = []
  const colours: number[] = []
  const snow = new THREE.Color('#eef3f7')
  const rockLight = new THREE.Color('#99948b')
  const rockDark = new THREE.Color('#5c5852')
  const colour = new THREE.Color()

  const hash = (a: number, b: number) => {
    const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
    return s - Math.floor(s)
  }
  const tri = (a: number[], b: number[], c: number[], col: THREE.Color[]) => {
    positions.push(...a, ...b, ...c)
    for (const k of col) colours.push(k.r, k.g, k.b)
  }

  for (const o of outcrops) {
    const half = o.width / 2
    // World position from local (across right of downhill, back uphill from the lip, height).
    const world = (across: number, back: number, y: number) => [o.x - o.dirZ * across - o.dirX * back, y, o.z + o.dirX * across - o.dirZ * back]
    const ground = (across: number, back: number) => {
      const [x, , z] = world(across, back, 0)
      const h = heightAt(x, z)
      return Number.isFinite(h) ? h : o.lipGround
    }
    const lipBack = (across: number) => {
      // Same edge as the physics footprint.
      for (let b = -1; b <= o.depth; b += 0.1) {
        const [x, , z] = world(across, b, 0)
        if (outcropTop(o, x, z) !== null) return b
      }
      return 0
    }
    const backEdge = (across: number) => o.depth * (1 - 0.35 * (across / half) ** 4)
    const nu = Math.max(4, Math.round(o.width / 1.2))
    const nv = Math.max(3, Math.round(o.depth / 1.5))
    const us = Array.from({ length: nu + 1 }, (_, i) => -half + (o.width * i) / nu)

    // Snowy top, a few centimetres proud so it never z-fights the terrain.
    const top = us.map((u) => {
      const b0 = lipBack(u)
      const b1 = backEdge(u)
      return Array.from({ length: nv + 1 }, (_, j) => {
        const b = b0 + ((b1 - b0) * j) / nv
        return world(u, b, Math.max(topHeight(o, b, u), ground(u, b)) + 0.05)
      })
    })
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const shade = snow.clone().multiplyScalar(0.95 + 0.05 * hash(i + o.seed, j))
        const c = [shade, shade, shade]
        tri(top[i][j], top[i + 1][j], top[i][j + 1], c)
        tri(top[i + 1][j], top[i + 1][j + 1], top[i][j + 1], c)
      }
    }

    // The face: from the lip down to below the snow, in jagged rows.
    const rows = Math.max(3, Math.round(o.height / 0.9))
    const face = us.map((u, i) => {
      const b = lipBack(u)
      const lipTop = topHeight(o, b, u)
      const foot = ground(u, b - 0.6) - 0.5
      // Buttresses and gullies: whole columns lean out or step back.
      const column = (hash(Math.floor(i / 2) * 5.7 + o.seed, 1) - 0.5) * 1.4
      return Array.from({ length: rows + 1 }, (_, r) => {
        const t = r / rows
        // Push points out of and into the face so it reads as broken rock.
        const bulge = r === 0 ? 0 : (hash(i * 3.1 + o.seed, r) - 0.4) * 1.1 + column * Math.sin(t * Math.PI)
        return world(u + (hash(r + o.seed, i) - 0.5) * 0.5, b - bulge - t * 0.6, lipTop + (foot - lipTop) * t + 0.04)
      })
    })
    for (let i = 0; i < nu; i++) {
      for (let r = 0; r < rows; r++) {
        const strata = hash(r * 7.3 + o.seed, Math.floor(i / 2))
        colour.copy(rockDark).lerp(rockLight, 0.35 + 0.65 * strata)
        // Snow lodged on some ledges near the top.
        const ledge = colour.clone()
        if (r > 0 && hash(i + 11 * r, o.seed) > 0.9) ledge.lerp(snow, 0.55)
        const c = [ledge, ledge, ledge]
        tri(face[i][r], face[i][r + 1], face[i + 1][r], c)
        tri(face[i + 1][r], face[i][r + 1], face[i + 1][r + 1], c)
      }
    }

    // Sides: rock walls from the top edge down into the snow.
    for (const side of [0, nu]) {
      const sign = side === 0 ? -1 : 1
      const u = us[side]
      for (let j = 0; j < nv; j++) {
        const a = top[side][j]
        const b = top[side][j + 1]
        const b0 = lipBack(u)
        const span = backEdge(u) - b0
        const lowA = [a[0], ground(u, b0 + (span * j) / nv) - 0.5, a[2]]
        const lowB = [b[0], ground(u, b0 + (span * (j + 1)) / nv) - 0.5, b[2]]
        colour.copy(rockDark).lerp(rockLight, 0.4 + 0.4 * hash(j, o.seed + side))
        const c = [colour.clone(), colour.clone(), colour.clone()]
        if (sign < 0) {
          tri(a, lowA, b, c)
          tri(b, lowA, lowB, c)
        } else {
          tri(a, b, lowA, c)
          tri(b, lowB, lowA, c)
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'cliffs'
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}
