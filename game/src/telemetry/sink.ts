/**
 * Where a recording goes. Chunks are kept in memory for the Download button,
 * and when the page runs as a claude.ai artifact with the `db` capability
 * they are also saved to the artifact's database as they are made, so a
 * session comes back with no work from the player:
 *
 *   tele/<session id>                 the header and a running count
 *   tele/<session id>/chunks/<0000>   one chunk: { i, t0, t1, enc, data }
 *
 * `data` is the chunk's JSON, gzipped and base64 encoded (`enc: 'gz64'`) where
 * the browser can compress, plain JSON text (`enc: 'json'`) otherwise.
 * Outside an artifact (local dev) nothing leaves the page.
 */
import type { ChunkPayload, SessionMeta } from './analyze'

export interface StoredChunk {
  i: number
  t0: number
  t1: number
  enc: 'gz64' | 'json'
  data: string
}

/** The file the Download button saves, and what `window.__telemetry.export()` returns. */
export interface SessionFile {
  meta: SessionMeta
  chunks: StoredChunk[]
}

interface DocRef {
  set(data: Record<string, unknown>): Promise<void>
  update(data: Record<string, unknown>): Promise<void>
}
interface Db {
  doc(path: string): DocRef
}
interface Downloads {
  save(request: { filename: string; data: string | Blob }): Promise<unknown>
}
type ClaudeHost = { use(name: string): Promise<unknown> }

export interface SinkStatus {
  /** `db`: saving to the artifact database; `memory`: only in this page (use Download). */
  mode: 'starting' | 'db' | 'memory'
  chunks: number
  saved: number
  /** Wall clock of the last successful save. */
  savedAt: number
  bytes: number
  error: string
}

const host = (): ClaudeHost | null => (window as unknown as { claude?: ClaudeHost }).claude ?? null

async function encode(text: string): Promise<{ enc: StoredChunk['enc']; data: string }> {
  try {
    if (typeof CompressionStream === 'undefined') throw new Error('no CompressionStream')
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
    return { enc: 'gz64', data: btoa(binary) }
  } catch {
    return { enc: 'json', data: text }
  }
}

export function createSink(meta: SessionMeta) {
  const chunks: StoredChunk[] = []
  const status: SinkStatus = { mode: 'starting', chunks: 0, saved: 0, savedAt: 0, bytes: 0, error: '' }
  let db: Db | null = null
  let headerWritten = false
  let summary: Record<string, unknown> = {}
  /** One write at a time, in order. */
  let queue: Promise<void> = Promise.resolve()
  const pending: StoredChunk[] = []

  const claude = host()
  const ready: Promise<void> = claude
    ? claude.use('db').then(
        (found) => {
          db = (found as Db | null) ?? null
          status.mode = db ? 'db' : 'memory'
        },
        () => {
          status.mode = 'memory'
        },
      )
    : Promise.resolve().then(() => {
        status.mode = 'memory'
      })

  const fail = (error: unknown) => {
    const code = (error as { code?: string } | null)?.code ?? ''
    status.error = code || String((error as Error)?.message ?? error)
    // Not a passing condition: stop trying and keep the recording in the page.
    if (code && code !== 'unavailable' && code !== 'resource_exhausted') {
      db = null
      status.mode = 'memory'
    }
  }

  async function drain() {
    await ready
    if (!db) return
    const base = `tele/${meta.id}`
    try {
      if (!headerWritten) {
        await db.doc(base).set({ ...meta, chunks: 0, t1: 0, savedAt: new Date().toISOString() })
        headerWritten = true
      }
      while (pending.length && db) {
        const chunk = pending[0]
        const ref = db.doc(`${base}/chunks/${String(chunk.i).padStart(4, '0')}`)
        try {
          await ref.set({ ...chunk })
        } catch (error) {
          // One retry for a passing fault, after a short random wait.
          if ((error as { code?: string } | null)?.code !== 'unavailable') throw error
          await new Promise((done) => setTimeout(done, 400 + Math.random() * 800))
          await ref.set({ ...chunk })
        }
        pending.shift()
        status.saved++
        status.savedAt = Date.now()
        status.error = ''
      }
      if (db) await db.doc(base).update({ chunks: status.saved, t1: chunks[chunks.length - 1]?.t1 ?? 0, savedAt: new Date().toISOString(), summary })
    } catch (error) {
      fail(error)
    }
  }

  return {
    status,
    /** Add a chunk: kept in memory, and saved to the artifact database when there is one. */
    push(payload: ChunkPayload, t0: number, t1: number, running: Record<string, unknown>) {
      const i = status.chunks++
      summary = running
      queue = queue
        .then(() => encode(JSON.stringify(payload)))
        .then((encoded) => {
          const chunk: StoredChunk = { i, t0, t1, ...encoded }
          chunks.push(chunk)
          pending.push(chunk)
          status.bytes += chunk.data.length
          return drain()
        })
        .catch(fail)
      return queue
    },
    /** Everything recorded so far, as one file. */
    async export(): Promise<SessionFile> {
      await queue
      return { meta: { ...meta, summary }, chunks: [...chunks] }
    },
    /** Offer the recording as a file. Call from a click. */
    async download(): Promise<boolean> {
      await queue
      const text = JSON.stringify({ meta: { ...meta, summary }, chunks })
      const filename = `skiscrapex-playtest-${meta.id}.json`
      const downloads = (await host()?.use('downloads').catch(() => null)) as Downloads | null | undefined
      if (downloads) {
        try {
          await downloads.save({ filename, data: new Blob([text], { type: 'application/json' }) })
          return true
        } catch {
          return false
        }
      }
      const link = document.createElement('a')
      link.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
      link.download = filename
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 10000)
      return true
    },
  }
}

export type Sink = ReturnType<typeof createSink>
