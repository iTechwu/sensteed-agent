import { readFile } from 'node:fs/promises'

export async function readCiPackageManifests(ciRoot, directoryNames) {
  const packages = []
  for (const name of directoryNames) {
    try {
      const source = await readFile(new URL(`${name}/package.json`, ciRoot), 'utf8')
      packages.push({ name, manifest: JSON.parse(source) })
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
  }
  return packages
}

/** The enterprise entry is a static settings pointer, not an overlay installer. */
export function auditThinHubSettingsEntry(manifest, source) {
  const failures = []
  if (manifest.exports?.['./client'] !== './thin/client.js'
    || manifest.exports?.['.'] !== './thin/index.js'
    || JSON.stringify(manifest.files) !== JSON.stringify(['cordis.patch.yml', 'thin/index.js', 'thin/client.js'])
    || Object.keys(manifest.dependencies ?? {}).length) {
    failures.push('thin Hub entry must publish only its reviewed Host/settings entry points without dependencies')
  }
  if (!source.includes("ctx.slots.inject('settings.section'")
    || !source.includes("name: 'settings.section'")
    || !source.includes("'aria-labelledby': 'hub-management-location'")
    || !source.includes("h('h2', { id: 'hub-management-location' }")) {
    failures.push('thin Hub settings entry requires its labelled static settings section')
  }
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|postMessage)\s*\(|\b(?:import|require)\s*\(\s*['"](?:node:|https?:|@dofe\/)|\bctx\.(?!slots\b)[A-Za-z_$]/u.test(source)
    || /['"](?:shell\.overlay|sidebar\.footer\.action)['"]/u.test(source)) {
    failures.push('thin Hub settings entry cannot add networking, Host actions or a separate overlay installer')
  }
  return failures
}
