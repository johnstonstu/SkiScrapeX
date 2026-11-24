/**
 * A damped spring toward a moving target. Under-damped channels overshoot a
 * little, which reads as weight: the body sinks past the landing and comes
 * back, the hips swing through an edge change. Sub-stepped so a long frame
 * cannot blow it up.
 */
export class Spring {
  v = 0
  constructor(public x = 0) {}
  step(target: number, dt: number, hz: number, zeta: number): number {
    const w = 2 * Math.PI * hz
    for (let left = dt; left > 1e-6; left -= 1 / 120) {
      const h = Math.min(left, 1 / 120)
      this.v += (w * w * (target - this.x) - 2 * zeta * w * this.v) * h
      this.x += this.v * h
    }
    return this.x
  }
}
