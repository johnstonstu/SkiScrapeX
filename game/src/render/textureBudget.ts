import type { Texture } from 'three'

/** Session cap for canvas / map anisotropy (set from the quality profile). */
let maxAnisotropy = 4

export function setTextureAnisotropy(value: number) {
  maxAnisotropy = Math.max(1, Math.floor(value))
}

export function textureAnisotropy(): number {
  return maxAnisotropy
}

/** Apply the session anisotropy cap to a texture. */
export function applyTextureBudget(texture: Texture) {
  texture.anisotropy = maxAnisotropy
}
