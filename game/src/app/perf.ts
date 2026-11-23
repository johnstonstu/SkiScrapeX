import type * as THREE from 'three'

/**
 * `?perf` probe: load-phase timings, per-frame CPU split (sim, scene update,
 * render submission) and renderer counts, exposed as `window.__perf` for
 * headless measurement. Software GPUs make absolute frame times meaningless;
 * draw calls, triangles and the relative split are what to compare.
 */
export function createPerfProbe(enabled: boolean) {
  const start = performance.now()
  const phases: Record<string, number> = {}
  let last = start
  const frames: Record<string, number[]> = { sim: [], update: [], render: [], frame: [] }
  let t0 = 0
  const report = {
    phases,
    frames: {} as Record<string, number>,
    renderer: {} as Record<string, number>,
    graphics: { level: '', reason: '', renderer: '' },
  }
  if (enabled) (window as unknown as { __perf: typeof report; __perfRaw: typeof frames }).__perf = report
  if (enabled) (window as unknown as { __perfRaw: typeof frames }).__perfRaw = frames
  return {
    /** The graphics level in use and why, for the report and the info overlay. */
    graphics(info: { level: string; reason: string; renderer: string }) {
      report.graphics = info
    },
    get graphicsInfo() {
      return report.graphics
    },
    /** End of a load phase. */
    phase(name: string) {
      if (!enabled) return
      const now = performance.now()
      phases[name] = Math.round(now - last)
      phases.total = Math.round(now - start)
      last = now
    },
    begin() {
      if (enabled) t0 = performance.now()
    },
    /** Time since `begin` or the previous `lap`, under `name`. */
    lap(name: 'sim' | 'update' | 'render') {
      if (!enabled) return
      const now = performance.now()
      frames[name].push(now - t0)
      t0 = now
    },
    end(renderer: THREE.WebGLRenderer, frameMs: number) {
      if (!enabled) return
      frames.frame.push(frameMs)
      for (const [name, list] of Object.entries(frames)) {
        if (list.length > 240) list.shift()
        const sorted = [...list].sort((a, b) => a - b)
        report.frames[`${name}Median`] = Number((sorted[Math.floor(sorted.length / 2)] ?? 0).toFixed(2))
      }
      report.renderer = {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs: renderer.info.programs?.length ?? 0,
        heapMB: Math.round(((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1e6),
      }
    },
  }
}
