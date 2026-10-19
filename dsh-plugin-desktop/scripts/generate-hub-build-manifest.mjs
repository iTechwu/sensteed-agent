/** Run against the final afterPack bytes; never includes writable Hub generations. */
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { calculateHubBuildManifest } from '../src/hub-build-identity.ts'
export async function generateHubBuildManifest(resourcesPath, outputPath = join(resourcesPath, 'hub-build-manifest.json')) {
  const manifest = await calculateHubBuildManifest(resourcesPath)
  writeFileSync(outputPath, `${JSON.stringify(manifest)}\n`, { mode: 0o644 })
  return manifest
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('usage: generate-hub-build-manifest.mjs <packaged-resources-directory>')
  await generateHubBuildManifest(resolve(process.argv[2]))
}
