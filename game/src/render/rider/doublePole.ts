const smooth = (t: number) => t * t * (3 - 2 * t)
/** Seconds per double-pole push. */
export const DOUBLE_POLE_CYCLE = 1.05

/**
 * Double-pole push at phase 0..1: reach forward and plant (0 to 0.35), drive
 * the hands down past the hips while the back crunches (to 0.75), then swing
 * the arms forward again. Hands in chest space, pole tips in root space.
 */
export function doublePolePose(phase: number, speed: number) {
  const reachEnd = 0.35
  const pushEnd = 0.75
  const forward = { handX: 0.27, handY: 0.12, handZ: 0.5 }
  const back = { handX: 0.33, handY: -0.32, handZ: -0.2 }
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  if (phase < reachEnd) {
    const t = smooth(phase / reachEnd)
    return {
      handX: lerp(back.handX, forward.handX, t),
      handY: lerp(back.handY, forward.handY, t),
      handZ: lerp(back.handZ, forward.handZ, t),
      tipY: lerp(0.35, 0.0, t),
      tipZ: lerp(-0.7, 0.4, t),
      crunch: 0,
    }
  }
  if (phase < pushEnd) {
    const t = (phase - reachEnd) / (pushEnd - reachEnd)
    const k = smooth(t)
    return {
      handX: lerp(forward.handX, back.handX, k),
      handY: lerp(forward.handY, back.handY, k),
      handZ: lerp(forward.handZ, back.handZ, k),
      // The tip stays put on the snow while the skier slides past it.
      tipY: -0.02,
      tipZ: 0.4 - speed * t * (pushEnd - reachEnd) * DOUBLE_POLE_CYCLE - k * 0.5,
      crunch: 0.75 * Math.sin(t * Math.PI),
    }
  }
  const t = smooth((phase - pushEnd) / (1 - pushEnd))
  return {
    handX: back.handX,
    handY: lerp(back.handY, back.handY + 0.1, t),
    handZ: back.handZ,
    tipY: lerp(0, 0.35, t),
    tipZ: -0.7,
    crunch: 0,
  }
}
