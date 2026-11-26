import * as THREE from 'three'
import { SPECIES_COUNT, Species, type Forest, type Tree } from '../../world/forest'
import { compactTreeShapes, distantTree, treeShapes } from './treeShapes'

/** Metres a chunk must move past the near distance before it drops back to stand-ins. */
const NEAR_HYSTERESIS = 30

export interface ForestDetail {
  /** Full conifer inside this radius, metres. */
  near: number
  /** Simple cone out to here at `midShare` of the trees. */
  mid: number
  midShare: number
  /** Share of trees drawn past `mid`. */
  farShare: number
  compact?: boolean
  /** Two-cone stand-ins without a trunk (8 triangles instead of 20) between `near` and `mid`. */
  leanStandIns?: boolean
}


/**
 * Instanced trees. Far away each chunk is one batch of a two-cone stand-in,
 * tinted by species and thinned with distance. Chunks inside `near` hand their
 * trees to one instanced pool per species (spruce, fir, pine, snag,
 * krummholz, snow ghost), so detail costs six draw calls however many chunks
 * are close.
 */
/**
 * Camera and skier positions for the sight-line fade, shared by every forest
 * material. main.ts writes them once per frame.
 */
export const SIGHT_LINE = { from: { value: new THREE.Vector3() }, to: { value: new THREE.Vector3(0, -1e6, 0) } }

export function createForestView(forest: Forest, detail: ForestDetail) {
  const group = new THREE.Group()
  group.name = 'forest'
  const shapes = detail.compact ? compactTreeShapes() : treeShapes()
  const simple = detail.leanStandIns ? distantTree(2) : distantTree(3, true)
  // Past `mid`, a single cone (4 triangles instead of 12) is plenty.
  const lowest = distantTree(1)
  const material = new THREE.MeshLambertMaterial({ vertexColors: true })
  // Trees dissolve (screen-door dither) only where they would hide the skier:
  // within a few metres of the camera-to-skier sight line, between the two.
  // Trees beside the camera stay solid, so orbit and aerial views keep their
  // forest. Anything closer than about 1.5 m still fades so the camera never
  // sits inside a crown.
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSightFrom = SIGHT_LINE.from
    shader.uniforms.uSightTo = SIGHT_LINE.to
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vCamDist;\nvarying vec3 vWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vCamDist = -mvPosition.z;
        vec4 worldPoint = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          worldPoint = instanceMatrix * worldPoint;
        #endif
        vWorld = (modelMatrix * worldPoint).xyz;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCamDist;\nvarying vec3 vWorld;\nuniform vec3 uSightFrom;\nuniform vec3 uSightTo;')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        vec3 sight = uSightTo - uSightFrom;
        float along = clamp(dot(vWorld - uSightFrom, sight) / max(dot(sight, sight), 1e-4), 0.0, 1.0);
        float off = length(vWorld - (uSightFrom + sight * along));
        // 1 where the fragment is clear of the sight line (or past the skier).
        float clear = max(smoothstep(1.6, 3.6, off), step(0.96, along));
        float keep = mix(smoothstep(3.0, 8.5, vCamDist), 1.0, clear);
        keep = min(keep, smoothstep(0.8, 1.6, vCamDist));
        float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        if (keep < 1.0 && dither > keep) discard;`,
      )
  }
  const transform = new THREE.Object3D()
  const color = new THREE.Color()
  const matrixOf = (tree: Tree) => {
    transform.position.set(tree.x, tree.y - 0.3, tree.z)
    transform.rotation.set(0, tree.rotation, 0)
    const girth = 1 + 0.12 * Math.sin(tree.rotation * 2)
    transform.scale.set(tree.height * girth, tree.height, tree.height * girth)
    transform.updateMatrix()
    return transform.matrix
  }
  // Distant stand-ins take a species tint; near shapes carry their own colours.
  const farTint = (tree: Tree) => {
    color.setScalar(tree.tone)
    if (tree.species === Species.Ghost) color.setRGB(1.5, 1.55, 1.6)
    else if (tree.species === Species.Snag) color.setRGB(1.1, 1.05, 1)
    else if (tree.species === Species.Fir) color.multiplyScalar(1.05)
    else {
      // Soft frost lift so distant spruce/pine/krummholz aren't pure dark green.
      color.r = color.r * 0.78 + 0.22 * 0.78
      color.g = color.g * 0.78 + 0.22 * 0.85
      color.b = color.b * 0.78 + 0.22 * 0.9
    }
    return color
  }
  const batches: { far: THREE.InstancedMesh; trees: Tree[]; cx: number; cz: number; y: number; n: number; near: boolean }[] = []
  for (const chunk of forest.chunks) {
    const n = chunk.trees.length
    if (!n) continue
    const far = new THREE.InstancedMesh(simple, material, n)
    let y = 0
    chunk.trees.forEach((tree, i) => {
      // Snags and pines read thinner from afar.
      const m = matrixOf(tree)
      if (tree.species === Species.Snag || tree.species === Species.Pine) m.scale(new THREE.Vector3(0.6, 1, 0.6))
      far.setMatrixAt(i, m)
      far.setColorAt(i, farTint(tree))
      y += tree.y
    })
    far.instanceMatrix.needsUpdate = true
    if (far.instanceColor) far.instanceColor.needsUpdate = true
    far.computeBoundingSphere()
    far.castShadow = true
    far.count = 0
    group.add(far)
    batches.push({ far, trees: chunk.trees, cx: chunk.cx, cz: chunk.cz, y: y / n, n, near: false })
  }

  // Near pools, one per species, grown on demand.
  const pools = shapes.map((shape) => {
    const mesh = new THREE.InstancedMesh(shape, material, 1)
    mesh.count = 0
    mesh.castShadow = true
    mesh.frustumCulled = false
    group.add(mesh)
    return mesh
  })
  const counts = new Array(SPECIES_COUNT).fill(0)
  const fillPools = () => {
    counts.fill(0)
    for (const batch of batches) if (batch.near) for (const tree of batch.trees) counts[tree.species]++
    pools.forEach((mesh, species) => {
      if (counts[species] > mesh.instanceMatrix.count) {
        const grown = new THREE.InstancedMesh(shapes[species], material, Math.ceil(counts[species] * 1.4))
        grown.castShadow = true
        grown.frustumCulled = false
        group.remove(mesh)
        mesh.dispose()
        group.add(grown)
        pools[species] = grown
      }
    })
    const used = new Array(SPECIES_COUNT).fill(0)
    for (const batch of batches) {
      if (!batch.near) continue
      for (const tree of batch.trees) {
        const mesh = pools[tree.species]
        const i = used[tree.species]++
        mesh.setMatrixAt(i, matrixOf(tree))
        color.setScalar(tree.tone)
        mesh.setColorAt(i, color)
      }
    }
    pools.forEach((mesh, species) => {
      mesh.count = used[species]
      mesh.visible = used[species] > 0
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    })
  }

  let drawn = 0
  return {
    object: group,
    get drawn() {
      return drawn
    },
    update(camera: THREE.Vector3) {
      drawn = 0
      let changed = false
      for (const batch of batches) {
        const d = Math.hypot(batch.cx - camera.x, batch.cz - camera.z, (batch.y - camera.y) * 0.5)
        // Hysteresis: a camera hovering at the boundary (lift bob, orbit sway) must not
        // flip a chunk every frame, because each flip refills and re-uploads every near tree.
        const near = batch.near ? d < detail.near + NEAR_HYSTERESIS : d < detail.near
        if (near !== batch.near) {
          batch.near = near
          changed = true
        }
        const skier = SIGHT_LINE.to.value
        const playerGap = Math.hypot(Math.max(0, Math.abs(batch.cx - skier.x) - forest.chunkSize / 2),
          Math.max(0, Math.abs(batch.cz - skier.z) - forest.chunkSize / 2))
        const closeToSkier = playerGap < 40
        if (near) {
          batch.far.count = 0
          drawn += batch.n
        } else if (closeToSkier) {
          batch.far.count = batch.n
        } else if (d < detail.mid) {
          const t = (d - detail.near) / (detail.mid - detail.near)
          batch.far.count = Math.ceil(batch.n * (1 - t * (1 - detail.midShare)))
        } else {
          batch.far.count = Math.ceil(batch.n * detail.farShare)
        }
        const geometry = near || closeToSkier || d < detail.mid ? simple : lowest
        if (batch.far.geometry !== geometry) batch.far.geometry = geometry
        batch.far.visible = batch.far.count > 0
        drawn += batch.far.count
      }
      if (changed) fillPools()
    },
    dispose() {
      for (const shape of shapes) shape.dispose()
      simple.dispose()
      lowest.dispose()
      material.dispose()
      for (const batch of batches) batch.far.dispose()
      for (const mesh of pools) mesh.dispose()
    },
  }
}

