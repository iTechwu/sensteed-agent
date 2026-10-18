import { relative, isAbsolute, sep } from 'node:path'

/** Both credentials must stay outside every directory readable by candidate code. */
export function assertProofSecretsOutsideReadRoots(secretPaths, readRoots) {
  for (const secret of secretPaths) {
    for (const root of readRoots) {
      const path = relative(root, secret)
      if (path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))) {
        throw new Error('Hub proof CI: credentials overlap a sandbox read root')
      }
    }
  }
}
