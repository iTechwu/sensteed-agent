/** Locate the complete installed Office package closure used by standalone CLI processes; ported from upstream. */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

interface PackageManifest {
  readonly name?: string
  readonly os?: readonly string[]
  readonly cpu?: readonly string[]
  readonly dependencies?: Readonly<Record<string, string>>
  readonly optionalDependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>
}

/** Distribution platform and CPU. */
export interface OfficeTarget {
  readonly platform: string
  readonly arch: string
}

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

/**
 * Require the declared native engine, or use WASM on other targets.
 * @param manifest - Installed kit manifest.
 * @param target - Distribution platform and CPU.
 * @returns Engine package suffix.
 */
export function selectOfficeEngine(manifest: PackageManifest, target: OfficeTarget): string {
  const native = `${target.platform}-${target.arch}`
  return Object.hasOwn(manifest.optionalDependencies ?? {}, `@deepseek-ai/libreoffice-kit-${native}`) ? native : 'wasm'
}

function supports(values: readonly string[] | undefined, value: string): boolean {
  return values === undefined || (!values.includes(`!${value}`)
    && (values.every(item => item.startsWith('!')) || values.includes(value) || values.includes('any')))
}

/**
 * Find every required package, retaining its installed dependency resolution and target engine.
 * @param root - Symlink-free installed Node project.
 * @param target - Distribution platform and CPU.
 * @returns Absolute package directories; rejects missing dependencies and paths outside the root.
 */
export function officePackageDirectories(root: string, target: OfficeTarget): string[] {
  const entry = join(root, 'node_modules', '@deepseek-ai', 'libreoffice-kit')
  const engineName = `@deepseek-ai/libreoffice-kit-${selectOfficeEngine(readManifest(join(entry, 'package.json')), target)}`
  // 返回包名而非物理路径：pnpm 的隔离布局把传递依赖放进 node_modules/.pnpm 虚拟商店，
  // 而 electron-builder 物料化的打包布局按包名提升归档，名字 glob 在两种布局下都成立。
  const packages = new Set<string>()

  function visit(packageDirectory: string): void {
    const manifestPath = join(packageDirectory, 'package.json')
    const manifest = readManifest(manifestPath)
    if (manifest.name === undefined) throw new Error(`Office dependency at ${packageDirectory} has no package name.`)
    packages.add(manifest.name)
    const require = createRequire(manifestPath)
    const dependencies = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ])
    for (const name of dependencies) {
      if (name.startsWith('@deepseek-ai/libreoffice-kit-')) continue
      const optional = manifest.optionalDependencies?.[name] !== undefined || manifest.peerDependenciesMeta?.[name]?.optional === true
      const dependencyDirectory = (require.resolve.paths(name) ?? [])
        .map(directory => join(directory, name))
        .find(directory => existsSync(directory))
      if (dependencyDirectory === undefined) {
        if (optional) continue
        throw new Error(`Office dependency ${name} required by ${manifest.name ?? manifestPath} is missing.`)
      }
      if (optional) {
        const dependency = readManifest(join(dependencyDirectory, 'package.json'))
        if (!supports(dependency.os, target.platform) || !supports(dependency.cpu, target.arch)) continue
      }
      visit(dependencyDirectory)
    }
  }

  visit(entry)
  // pnpm 按 os/cpu 守卫安装 optional 引擎：host 匹配的引擎缺失是打包硬错误；
  // 跨主机引擎只在对应平台的安装树中存在，开发树上跳过（打包期由 runtime 校验兜底）。
  const engineDirectory = (createRequire(join(entry, 'package.json')).resolve.paths(engineName) ?? [])
    .map(directory => join(directory, engineName))
    .find(directory => existsSync(directory))
  if (engineDirectory === undefined) {
    if (engineName.endsWith(`${process.platform}-${process.arch}`)) {
      throw new Error(`Office engine ${engineName} required for ${target.platform}/${target.arch} is missing.`)
    }
    return [...packages].sort()
  }
  visit(engineDirectory)
  return [...packages].sort()
}

/**
 * Archive unpack patterns for the Office closure of every CPU one package carries. The CLI and its
 * engine run under the bundled standalone Node, which reads no archive.
 * @param root - Installed application directory.
 * @param platform - Electron platform being packaged.
 * @param archs - CPUs whose engines the package carries.
 * @returns Sorted `asarUnpack` globs relative to the application directory.
 */
export function officeUnpackPatterns(root: string, platform: string, archs: readonly string[]): string[] {
  const names = new Set<string>()
  for (const arch of archs) for (const name of officePackageDirectories(root, { platform, arch })) names.add(name)
  return [...names].sort().map(name => `**/node_modules/${name}/**/*`)
}
