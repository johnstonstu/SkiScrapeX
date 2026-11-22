// Carved-turn balance, ported from clarajzt/ski-coach `js/physics.js`.
// Copyright (c) 2026 clarajzt
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// Source: https://github.com/clarajzt/ski-coach (MIT). See THIRD_PARTY_NOTICES.md.
//
// carved radius r = R_sidecut · cos(edge)
// balance (level) tan(lean) = v² / (g · r)
// edge angle edge = lean + angulation
//
// A pure carve with no angulation is self-consistent when sin(edge) = v² / (g · R_sidecut),
// which has no solution above the critical speed v = √(g · R_sidecut).

import { PHYSICS } from './constants'

/** Same gravity as `PHYSICS.gravity`. The ski-coach original inlines 9.81. */
const G = PHYSICS.gravity
export const ANG_MAX = 20 // degrees of angulation a body can realistically add
export const LOAD_MAX = 3 // × body weight
const DEG = Math.PI / 180

export type CarveStatus = 'over' | 'heavy' | 'fall' | 'under' | 'ok'

export interface CarveInput {
  /** Speed in kilometres per hour, matching the original function. */
  kmh: number
  /** Edge angle in degrees. */
  edge: number
  /** Sidecut radius in metres. */
  sidecut: number
}

export interface CarveResult {
  /** Carved radius in metres. */
  radius: number
  /** Lateral acceleration in units of g. */
  gLat: number
  /** Balance lean in degrees. */
  lean: number
  /** Resultant load in units of body weight. */
  load: number
  /** Angulation (edge − lean) in degrees. */
  ang: number
  /** Ideal edge in degrees for a pure carve, or null above the critical speed. */
  ideal: number | null
  /** Critical speed in km/h. */
  vCrit: number
  status: CarveStatus
}

export function carve({ kmh, edge, sidecut }: CarveInput): CarveResult {
  const v = kmh / 3.6
  const radius = sidecut * Math.cos(edge * DEG)
  const gLat = (v * v) / (G * radius)
  const lean = Math.atan(gLat) / DEG
  const load = Math.hypot(1, gLat)
  const ang = edge - lean
  const k = (v * v) / (G * sidecut)
  const ideal = k < 1 ? Math.asin(k) / DEG : null
  const vCrit = Math.sqrt(G * sidecut) * 3.6
  const status: CarveStatus =
    k >= 1 ? 'over' : load > LOAD_MAX ? 'heavy' : ang > ANG_MAX ? 'fall' : ang < -2 ? 'under' : 'ok'
  return { radius, gLat, lean, load, ang, ideal, vCrit, status }
}
