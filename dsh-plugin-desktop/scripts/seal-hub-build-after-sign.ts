/** Signing may change native payload bytes, so reseal before the final installer is built. */
import { dirname, join } from 'node:path'
import { generateHubBuildManifest } from './generate-hub-build-manifest.mjs'
import { resolvePackagedAsarPath, type PackagedRuntimeContext } from './verify-packaged-runtime.ts'
export default async function afterSign(context: PackagedRuntimeContext): Promise<void> {
  // Sidecar is outside the signed .app: modifying its Resources after signing invalidates it.
  await generateHubBuildManifest(dirname(resolvePackagedAsarPath(context)), join(context.appOutDir, 'hub-build-manifest.signed.json'))
}
