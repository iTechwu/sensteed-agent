import { resolve } from 'node:path'

import { smokeInstalledSensteedClients } from './sensteed-client-runtime.mjs'

const manifestPath = resolve(import.meta.dirname, '../package.json')
const results = await smokeInstalledSensteedClients(manifestPath)

for (const result of results) {
  console.log(`verify-sensteed-client-runtime: ${result.pluginId} (${result.effects.length} effects, ${result.slots.length} slots)`)
}
if (!results.some(result => result.pluginId === '@dofe/dsh-sensteed-product')) {
  console.error('verify-sensteed-client-runtime: the launcher-owned product client is missing from the built-in set')
  process.exitCode = 1
}
console.log(`verify-sensteed-client-runtime: ${results.length} built-in plugins initialized successfully.`)
