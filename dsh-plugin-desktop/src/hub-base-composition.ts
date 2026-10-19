/** Enterprise composition is reconstructed from sealed install bundles by the launcher. */
import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { packageNameFromSpecifier } from './package-overlay.ts'
const forbidden = new Set(['@deepseek-ai/dsh-plugin-manager', '@deepseek-ai/dsh-plugin-manager/tools', '@deepseek-ai/dsh-client-ui-plugin-manager'])
/** Input must come from prepareSealedDesktopProfile, never an ordinary user-composed tree. */
export function hubBaseComposition(patches: readonly PatchOptions[]): PatchOptions[] {
  const entries = [...composeEntries([[...patches]])].filter(row => typeof row.name === 'string' && !forbidden.has(row.name))
  for (const row of entries) if (row.name === '@deepseek-ai/cordis-plugin-include' || row.name === 'cordis:include') throw new Error('Unsealed include carrier in Hub base composition')
  return [{ insert: entries }]
}
/** Managed package ownership also suppresses bundled rows when the signed plugin is disabled. */
export function hubOverlayComposition(base: readonly PatchOptions[], managed: PatchOptions, managedPackages: readonly string[] = []): PatchOptions[] {
  const incoming = [...composeEntries([[managed]])]
  const packages = new Set([...managedPackages, ...incoming.map(row => packageNameFromSpecifier(row.name))])
  const retained = [...composeEntries([[...base]])].filter(row => !packages.has(packageNameFromSpecifier(row.name)))
  if (incoming.some(row => retained.some(existing => existing.id === row.id))) throw new Error('Hub composition collides with unrelated entry')
  return [{ insert: [...retained, ...incoming] }]
}
