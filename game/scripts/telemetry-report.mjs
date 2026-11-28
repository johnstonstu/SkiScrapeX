#!/usr/bin/env node
/**
 * Turn a playtest recording into findings (see docs/telemetry.md).
 *
 *   node scripts/telemetry-report.mjs <recording> [--out report.md] [--json analysis.json] [--tracks tracks.json]
 *
 * <recording> is either the file the test build's Download button saves
 * (skiscrapex-playtest-<id>.json), or a folder of documents read from the
 * preview artifact's database (tele/<id>.json beside tele/<id>/chunks/*.json).
 * A folder holding several sessions reports each one.
 *
 * `--tracks` also writes the decoded session (samples, input, events) for
 * digging into one moment by hand.
 *
 * Needs Node 22.18 or newer: it loads src/telemetry/analyze.ts directly.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

const { analyze, buildSession, report } = await import(new URL('../src/telemetry/analyze.ts', import.meta.url).href)

const args = process.argv.slice(2)
const option = (name) => {
  const at = args.indexOf(name)
  return at >= 0 ? args.splice(at, 2)[1] : null
}
const outPath = option('--out')
const jsonPath = option('--json')
const tracksPath = option('--tracks')
const source = args[0]
if (!source || !existsSync(source)) {
  console.error('Usage: node scripts/telemetry-report.mjs <recording file or folder> [--out report.md] [--json analysis.json] [--tracks tracks.json]')
  process.exit(1)
}

/** A database read may wrap a document's fields (`data`, `fields`...): find the object that has the wanted key. */
function unwrap(value, key, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 3) return null
  if (key in value && (key !== 'data' || typeof value.data === 'string')) return value
  for (const inner of ['data', 'fields', 'doc', 'document', 'value']) {
    const found = unwrap(value[inner], key, depth + 1)
    if (found) return found
  }
  return null
}
const decode = (chunk) => JSON.parse(chunk.enc === 'gz64' ? gunzipSync(Buffer.from(chunk.data, 'base64')).toString('utf8') : chunk.data)
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

/** Sessions as { meta, chunks } from a download file or a folder of database documents. */
function load(path) {
  if (statSync(path).isFile()) {
    const file = readJson(path)
    return [{ meta: file.meta, chunks: file.chunks }]
  }
  const sessions = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (!statSync(full).isDirectory()) continue
      const chunkDir = join(full, 'chunks')
      if (existsSync(chunkDir)) {
        const header = existsSync(`${full}.json`) ? unwrap(readJson(`${full}.json`), 'started') : null
        const chunks = readdirSync(chunkDir).filter((file) => file.endsWith('.json')).map((file) => unwrap(readJson(join(chunkDir, file)), 'enc')).filter(Boolean)
        sessions.push({ meta: header ?? { format: 1, id: name, started: '', version: '' }, chunks })
      } else walk(full)
    }
  }
  walk(path)
  return sessions
}

const sessions = load(resolve(source))
if (!sessions.length) {
  console.error(`No recordings found in ${source}`)
  process.exit(1)
}
const reports = []
const analyses = []
const tracks = []
for (const { meta, chunks } of sessions.sort((a, b) => String(a.meta.started).localeCompare(String(b.meta.started)))) {
  const ordered = [...chunks].sort((a, b) => a.i - b.i)
  const missing = ordered.length ? ordered[ordered.length - 1].i + 1 - ordered.length : 0
  const session = buildSession(meta, ordered.map(decode))
  const analysis = analyze(session)
  analyses.push(analysis)
  tracks.push(session)
  reports.push(report(analysis) + (missing ? `\n\nNote: ${missing} chunk(s) of this session are missing, so some stretches are not covered.\n` : ''))
}
const text = reports.join('\n\n---\n\n')
if (outPath) writeFileSync(outPath, text)
else console.log(text)
if (jsonPath) writeFileSync(jsonPath, JSON.stringify(analyses.length === 1 ? analyses[0] : analyses, null, 1))
if (tracksPath) writeFileSync(tracksPath, JSON.stringify(tracks.length === 1 ? tracks[0] : tracks))
if (outPath) console.error(`${sessions.length} session(s) from ${basename(source)}: report in ${outPath}`)
