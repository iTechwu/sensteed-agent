/** Public verification anchors compiled into the sealed desktop base, never loaded from a plugin or Hub response. */
import type { HubReleaseTrust } from './hub-sync-verifier.ts'

const trust: HubReleaseTrust = Object.freeze({
  schemaVersion: 1,
  keys: Object.freeze({
    'hozonauto-hub-20261016-01': 'MCowBQYDK2VwAyEAuQTV6zGrFJu7/mUPRKYh0PJweY7o+gr5RTKxIfGhPo4=',
    'hozonauto-hub-20261017-02': 'MCowBQYDK2VwAyEAem03dQ4joPM3KRd1HJnWNcxPZ1TCOFHcxdhW2wO6Zzc=',
  }),
  revokedKeyIds: Object.freeze(['hozonauto-hub-20261016-01']),
})

export function readSealedHubReleaseTrust(): HubReleaseTrust { return trust }
