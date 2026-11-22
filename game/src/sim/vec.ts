export interface Vec3 {
  x: number
  y: number
  z: number
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

export function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s }
}

export function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z)
}

export function unit(a: Vec3): Vec3 {
  const len = length(a)
  if (len < 1e-8) return { x: 0, y: 1, z: 0 }
  return scale(a, 1 / len)
}

/** Component of `v` perpendicular to a unit normal `n`. */
export function projectOnPlane(v: Vec3, n: Vec3): Vec3 {
  return add(v, scale(n, -dot(v, n)))
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export function wrapAngle(angle: number): number {
  const turned = (angle + Math.PI) % (Math.PI * 2)
  if (turned < 0) return turned + Math.PI * 2 - Math.PI
  return turned - Math.PI
}

export function moveTowardAngle(current: number, target: number, maxDelta: number): number {
  const delta = wrapAngle(target - current)
  return wrapAngle(current + clamp(delta, -maxDelta, maxDelta))
}

export function moveTowardZero(value: number, amount: number): number {
  if (Math.abs(value) <= amount) return 0
  return value - Math.sign(value) * amount
}
