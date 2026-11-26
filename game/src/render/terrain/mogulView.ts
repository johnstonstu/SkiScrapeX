import * as THREE from 'three'
import { pointOnMogul, type Mogul } from '../../world/moguls'
import type { SampleTerrain } from '../../sim'

/** Bumps and the bumped surface they sit on (a run's mogul field or an event's). */
type MogulField = { bumps: readonly Mogul[]; sampleTerrain: SampleTerrain }

/** How the bumps are drawn at a graphics level. The physics always uses every bump. */
export interface MogulDetail {
  /** Points around each ring and rings from crest to foot. 12 × 4 is 84 triangles a bump. */
  segments: number
  rings: number
  /** Chunks further than this from the camera are hidden, metres. */
  reach: number
  /** Chunk size, metres: bigger chunks mean fewer draw calls, smaller ones cull more triangles. */
  chunk: number
}

export const MOGUL_DETAIL: Record<'low' | 'medium' | 'high', MogulDetail> = {
  // 8 × 3 is 40 triangles a bump: rounded enough at Low's draw distances.
  // Low keeps draw calls down with 384 m chunks: rarely more than one in view.
  low: { segments: 8, rings: 3, reach: 170, chunk: 384 },
  medium: { segments: 12, rings: 4, reach: 260, chunk: 256 },
  high: { segments: 12, rings: 4, reach: 340, chunk: 256 },
}

/**
 * Bumps as terrain-coloured meshes, one per chunk square so the camera only
 * draws (and shadows) the fields around it. Each vertex sits on the bumped
 * surface the skis feel.
 */
export function createMogulView(field: MogulField, material: THREE.Material, detail: MogulDetail = MOGUL_DETAIL.high) {
  const group = new THREE.Group()
  group.name = 'moguls'
  const byChunk = new Map<number, Mogul[]>()
  for (const bump of field.bumps) {
    const key = Math.floor(bump.x / detail.chunk) * 65536 + Math.floor(bump.z / detail.chunk)
    const list = byChunk.get(key)
    if (list) list.push(bump)
    else byChunk.set(key, [bump])
  }
  const chunks: { mesh: THREE.Mesh; cx: number; cz: number; bumps: Mogul[]; trimmed: boolean }[] = []
  for (const bumps of byChunk.values()) {
    const mesh = new THREE.Mesh(bumpGeometry(bumps, field, detail), material)
    mesh.receiveShadow = true
    mesh.castShadow = true
    let cx = 0, cz = 0
    for (const bump of bumps) ((cx += bump.x), (cz += bump.z))
    chunks.push({ mesh, cx: cx / bumps.length, cz: cz / bumps.length, bumps, trimmed: false })
    group.add(mesh)
  }
  const rebuild = (chunk: (typeof chunks)[number], bumps: Mogul[]) => {
    chunk.mesh.geometry.dispose()
    chunk.mesh.geometry = bumpGeometry(bumps, field, detail)
  }
  const reach = detail.reach + detail.chunk * 0.5
  return {
    object: group,
    triangles: chunks.reduce((n, c) => n + (c.mesh.geometry.index?.count ?? 0) / 3, 0),
    /** Leave out the bumps `kept` does not hold (a race track's), or draw them all again with null. Only touched chunks are rebuilt. */
    keep(kept: ReadonlySet<Mogul> | null) {
      for (const chunk of chunks) {
        const bumps = kept ? chunk.bumps.filter((bump) => kept.has(bump)) : chunk.bumps
        const trimmed = bumps.length < chunk.bumps.length
        if (!trimmed && !chunk.trimmed) continue
        rebuild(chunk, bumps)
        chunk.trimmed = trimmed
      }
    },
    update(camera: { x: number; z: number }) {
      for (const chunk of chunks) chunk.mesh.visible = (chunk.cx - camera.x) ** 2 + (chunk.cz - camera.z) ** 2 < reach * reach
    },
    dispose() {
      for (const chunk of chunks) chunk.mesh.geometry.dispose()
    },
  }
}

function bumpGeometry(bumps: Mogul[], field: MogulField, detail: MogulDetail): THREE.BufferGeometry {
  const { segments, rings } = detail
  const positions: number[] = [], normals: number[] = [], indices: number[] = []
  for (const bump of bumps) {
    const start = positions.length / 3
    for (let ring = 0; ring <= rings; ring++) {
      for (let j = 0; j < segments; j++) {
        const angle = (j * Math.PI * 2) / segments
        const [x, z] = pointOnMogul(bump, (Math.cos(angle) * ring) / rings, (Math.sin(angle) * ring) / rings)
        const ground = field.sampleTerrain(x, z)
        positions.push(x, ground?.height ?? 0, z)
        normals.push(ground?.normal.x ?? 0, ground?.normal.y ?? 1, ground?.normal.z ?? 0)
        if (!ring) continue
        const a = start + ring * segments + j
        const b = start + ring * segments + ((j + 1) % segments)
        indices.push(a - segments, b, a)
        if (ring > 1) indices.push(a - segments, b - segments, b)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}
