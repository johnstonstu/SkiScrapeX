/**
 * Surface mask packed into a nearest-filtered RGBA texture.
 * It is data, not a colour: leave the texture in NoColorSpace.
 *
 * R: surface id × 32 → 0 groomed, 32 powder, 64 ice, 96 rock, 128 under-tree, 160 park
 * G: groom heading / (2π). Heading 0 points +X east, π/2 points +Z south.
 * B: 255 on packed, skier-tracked groomed snow (no corduroy, worn look), else 0
 * A: 255
 *
 * World address: uv = (x - originX) / sizeX, (z - originZ) / sizeZ
 * with +X east and +Z south. Row 0 of the buffer is the north (min Z) edge.
 */

export const Surface = {
  groomed: 0,
  powder: 1,
  ice: 2,
  rock: 3,
  underTree: 4,
  park: 5,
} as const;

export type SurfaceId = (typeof Surface)[keyof typeof Surface];

/** Heading of a world XZ direction. 0 is east, π/2 is south. */
export function headingFromDirection(x: number, z: number): number {
  return Math.atan2(z, x);
}

export function writeMaskTexel(
  data: Uint8Array,
  texel: number,
  surface: SurfaceId,
  headingRadians: number,
): void {
  const offset = texel * 4;
  data[offset] = surface * 32;
  const turns = headingRadians / (Math.PI * 2);
  const wrapped = ((turns % 1) + 1) % 1;
  data[offset + 1] = Math.round(wrapped * 255);
  data[offset + 2] = 0;
  data[offset + 3] = 255;
}
