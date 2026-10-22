/** Real enterprise base Host smoke. The local target fixture grants no content or trusted target proof. */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DesktopHostProcess } from '../lib/host-process.js'
import { NextProfiles } from '../lib/profiles.js'
import { authenticateWebHost } from '../lib/web-document.js'
import { NATIVE_ACCESS_HEADER } from '../src/desktop-contract.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'next-enterprise-host-'))
const token = randomBytes(32).toString('base64url')
const profiles = new NextProfiles(home), profile = profiles.ensure('desktop')
// An unsigned Profile overlay must never enter the sealed enterprise graph.
writeFileSync(join(profile, 'cordis.patch.yml'), '- insert:\n    - id: unsigned-smoke\n      name: nonexistent-unsigned-smoke\n')
const target = {
  sensteedVersion: '2.0.19-next', harnessVersion: '0.2.1-rc.2', cordisVersion: '4.0.5',
  os: process.platform, arch: process.arch, nodeVersion: process.versions.node, nodeAbi: process.versions.modules,
  libc: process.platform === 'linux' ? 'glibc' : null, hostBuildDigest: 'b'.repeat(64), hostCapabilities: [],
}
let diagnostics = ''
const host = new DesktopHostProcess(process.execPath, root, profile, undefined, {
  ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DSH_NEXT_NATIVE_TOKEN: token,
  DSH_NEXT_HUB_BOOT: JSON.stringify({ target, userData: join(home, 'hub-content') }),
}, undefined, undefined, undefined, join(root, 'scripts', 'fixtures', 'isolated-user-host.mjs'), undefined, undefined,
  chunk => { diagnostics = (diagnostics + chunk).slice(-262144) })
let timer
try {
  const ready = await Promise.race([host.start(), new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error('Enterprise base Host startup exceeded 45 seconds')), 45_000)
  })]).finally(() => clearTimeout(timer))
  assert.doesNotMatch(diagnostics, /PackageOverlayNotFoundError|failed to import|never started|--expose-internals is required/)
  assert.ok(Array.isArray(ready.injections) && ready.injections.length > 0)
  const cookie = await authenticateWebHost(ready.url, token), origin = new URL(ready.url).origin
  const response = await fetch(`${origin}/api/desktop/hub/generations/profiles`, {
    method: 'POST', headers: { cookie, origin, 'content-type': 'application/json', [NATIVE_ACCESS_HEADER]: token },
    body: JSON.stringify({ action: 'status' }),
  })
  assert.equal(response.status, 200, await response.clone().text())
  assert.equal((await response.json()).appliedId, null)
  console.log('verify-enterprise-host: official injections, shared Profile route and unsigned-overlay exclusion passed (local protocol fixture only)')
} finally {
  clearTimeout(timer)
  await host.stop()
  rmSync(home, { recursive: true, force: true })
}
