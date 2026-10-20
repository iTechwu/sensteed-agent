/** Reuse existing local data without moving or overwriting it during the brand rename. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
export function legacyBrandUserData(current: string, appData: string, channel: 'stable' | 'beta', exists = existsSync): string {
  if (exists(join(current, '.hozonauto-native-data'))) return current
  const legacy = join(appData, channel === 'beta' ? 'Sensteed-Agent Beta' : 'Sensteed-Agent')
  return exists(legacy) ? legacy : current
}
