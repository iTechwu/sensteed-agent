import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export function includeSnapshotPath(path) {
  return !/(?:^|[\\/])(?:node_modules|\.git)(?:[\\/]|$)/u.test(path)
}

async function collect(dir, relative = '') {
  const files = new Map()
  for (const entry of await readdir(join(dir, relative), { withFileTypes: true })) {
    const key = relative ? `${relative}/${entry.name}` : entry.name
    if (!includeSnapshotPath(key)) continue
    if (entry.isSymbolicLink()) throw new Error(`snapshot source must not contain a symbolic link: ${key}`)
    if (entry.isDirectory()) {
      for (const [name, path] of await collect(dir, key)) files.set(name, path)
    } else if (entry.isFile()) files.set(key, join(dir, key))
    else throw new Error(`unsupported snapshot entry: ${key}`)
  }
  return files
}

/** Compare the complete file set in both directions, including new source files. */
export async function diffSnapshotTrees(source, snapshot) {
  const [sourceFiles, snapshotFiles] = await Promise.all([collect(source), collect(snapshot)])
  const problems = []
  for (const key of new Set([...sourceFiles.keys(), ...snapshotFiles.keys()])) {
    if (!sourceFiles.has(key)) problems.push(`snapshot-only file: ${key}`)
    else if (!snapshotFiles.has(key)) problems.push(`source-only file: ${key}`)
    else {
      const [a, b] = await Promise.all([readFile(sourceFiles.get(key)), readFile(snapshotFiles.get(key))])
      if (!a.equals(b)) problems.push(`content differs: ${key}`)
    }
  }
  return problems.sort()
}
