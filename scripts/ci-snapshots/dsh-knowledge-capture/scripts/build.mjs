// Stub build script — this plugin ships only host-side (Electron main process)
// code and has no browser bundle to produce. Kept so `npm run check` in CI can
// still gate on a successful build step. If this plugin adds a browser entry,
// replace this no-op with a renderer bundle build.

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

console.log(`[dsh-knowledge-capture] build: no-op (host-side only) at ${root}`)
