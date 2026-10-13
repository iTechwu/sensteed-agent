export function packagingVersion(sourceVersion: string, date?: Date): string
export function assertPackagingVersion(version: string, sourceVersion: string): void
export function assertHarnessReleaseManifest(manifest: { name?: string; version?: string }, sourceVersion: string): void
export function assertPackagingRelease(root?: string): {
  version: string
  source: { version: string; sourceVersion: string; repository: string; commit: string }
}
