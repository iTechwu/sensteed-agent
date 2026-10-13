import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { createPackageWithOptions, extractFile, statFile, uncacheAll } from '@electron/asar'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  hydratePackagedMacRuntime,
  hydratePackagedMacCloudflaredRuntime,
  hydratePackagedMacCpuFeaturesRuntime,
  hydratePackagedMacFsExtRuntime,
  MACOS_UNIVERSAL_NATIVE_ENTRIES,
  prepareInstalledMacUniversalRuntime,
  prepareMacUniversalRuntime,
  disablePackagedMacSshCryptoRuntime,
} from '../scripts/mac-universal.ts'

describe('universal macOS native runtime preparation', () => {
  it.each([
    [1, 'x86_64'],
    [3, 'arm64'],
  ] as const)('hydrates cloudflared for Electron Builder arch %s', (electronBuilderArch, arch) => {
    const calls: string[] = []
    hydratePackagedMacCloudflaredRuntime({
      unpackedRoot: '/package',
      electronBuilderArch,
      exists: () => true,
      copy: (source, target) => calls.push(`copy:${source}:${target}`),
      chmod: (path, mode) => calls.push(`chmod:${path}:${mode.toString(8)}`),
      versionOf: binary => {
        calls.push(`version:${binary}`)
        return '2026.8.3'
      },
      ensureBinary: (version, requestedArch) => {
        calls.push(`ensure:${version}:${requestedArch}`)
        return `/cache/${requestedArch}/cloudflared`
      },
      verifyArch: (binary, requestedArch) => calls.push(`verify:${binary}:${requestedArch}`),
    })

    const target = join('/package', 'node_modules/cloudflared/bin/cloudflared')
    expect(calls).toEqual([
      `version:${target}`,
      `ensure:2026.8.3:${arch}`,
      `verify:/cache/${arch}/cloudflared:${arch}`,
      `copy:/cache/${arch}/cloudflared:${target}`,
      `chmod:${target}:755`,
      `verify:${target}:${arch}`,
    ])
  })

  it('verifies both cloudflared slices after universal assembly', () => {
    const verified: string[] = []
    hydratePackagedMacCloudflaredRuntime({
      unpackedRoot: '/package',
      electronBuilderArch: 4,
      exists: () => true,
      copy: vi.fn(),
      chmod: vi.fn(),
      versionOf: vi.fn(() => '2026.8.3'),
      ensureBinary: vi.fn(() => '/unused'),
      verifyArch: (binary, arch) => verified.push(`${binary}:${arch}`),
    })

    const target = join('/package', 'node_modules/cloudflared/bin/cloudflared')
    expect(verified).toEqual([`${target}:x86_64`, `${target}:arm64`])
  })

  it.each([
    [1, 'x86_64'],
    [3, 'arm64'],
  ] as const)('hydrates cpu-features for Electron Builder arch %s', (electronBuilderArch, arch) => {
    const calls: string[] = []
    hydratePackagedMacCpuFeaturesRuntime({
      unpackedRoot: '/package',
      electronBuilderArch,
      exists: () => true,
      copy: (source, target) => calls.push(`copy:${source}:${target}`),
      chmod: (path, mode) => calls.push(`chmod:${path}:${mode.toString(8)}`),
      versionOf: root => {
        calls.push(`version:${root}`)
        return '0.0.10'
      },
      ensureBinary: (version, requestedArch) => {
        calls.push(`ensure:${version}:${requestedArch}`)
        return `/cache/${requestedArch}/cpufeatures.node`
      },
      verifyArch: (binary, requestedArch) => calls.push(`verify:${binary}:${requestedArch}`),
    })

    const target = join(
      '/package',
      'node_modules/cpu-features/build/Release/cpufeatures.node',
    )
    expect(calls).toEqual([
      'version:/package',
      `ensure:0.0.10:${arch}`,
      `verify:/cache/${arch}/cpufeatures.node:${arch}`,
      `copy:/cache/${arch}/cpufeatures.node:${target}`,
      `chmod:${target}:755`,
      `verify:${target}:${arch}`,
    ])
  })

  it('verifies both cpu-features slices after universal assembly', () => {
    const verified: string[] = []
    hydratePackagedMacCpuFeaturesRuntime({
      unpackedRoot: '/package',
      electronBuilderArch: 4,
      exists: () => true,
      copy: vi.fn(),
      chmod: vi.fn(),
      versionOf: vi.fn(() => '0.0.10'),
      ensureBinary: vi.fn(() => '/unused'),
      verifyArch: (binary, arch) => verified.push(`${binary}:${arch}`),
    })

    const target = join(
      '/package',
      'node_modules/cpu-features/build/Release/cpufeatures.node',
    )
    expect(verified).toEqual([`${target}:x86_64`, `${target}:arm64`])
  })

  it.each([
    [1, 'x86_64'],
    [3, 'arm64'],
  ] as const)('hydrates fs-ext for Electron Builder arch %s', (electronBuilderArch, arch) => {
    const calls: string[] = []
    hydratePackagedMacFsExtRuntime({
      unpackedRoot: '/package',
      electronBuilderArch,
      exists: () => true,
      copy: (source, target) => calls.push(`copy:${source}:${target}`),
      chmod: (path, mode) => calls.push(`chmod:${path}:${mode.toString(8)}`),
      versionOf: root => {
        calls.push(`version:${root}`)
        return '2.1.1'
      },
      ensureBinary: (version, requestedArch) => {
        calls.push(`ensure:${version}:${requestedArch}`)
        return `/cache/${requestedArch}/fs_ext.node`
      },
      verifyArch: (binary, requestedArch) => calls.push(`verify:${binary}:${requestedArch}`),
    })

    const target = join('/package', 'node_modules/fs-ext/build/Release/fs_ext.node')
    expect(calls).toEqual([
      'version:/package',
      `ensure:2.1.1:${arch}`,
      `verify:/cache/${arch}/fs_ext.node:${arch}`,
      `copy:/cache/${arch}/fs_ext.node:${target}`,
      `chmod:${target}:755`,
      `verify:${target}:${arch}`,
    ])
  })

  it('verifies both fs-ext slices after universal assembly', () => {
    const verified: string[] = []
    hydratePackagedMacFsExtRuntime({
      unpackedRoot: '/package',
      electronBuilderArch: 4,
      exists: () => true,
      copy: vi.fn(),
      chmod: vi.fn(),
      versionOf: vi.fn(() => '2.1.1'),
      ensureBinary: vi.fn(() => '/unused'),
      verifyArch: (binary, arch) => verified.push(`${binary}:${arch}`),
    })

    const target = join('/package', 'node_modules/fs-ext/build/Release/fs_ext.node')
    expect(verified).toEqual([`${target}:x86_64`, `${target}:arm64`])
  })

  it('disables the SSH2 Node/OpenSSL accelerator in macOS packages', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-mac-sshcrypto-'))
    const binary = join(
      root,
      'node_modules/ssh2/lib/protocol/crypto/build/Release/sshcrypto.node',
    )
    try {
      mkdirSync(dirname(binary), { recursive: true })
      writeFileSync(binary, 'host-native')

      disablePackagedMacSshCryptoRuntime(root)

      expect(existsSync(binary)).toBe(true)
      expect(readFileSync(binary)).toHaveLength(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  // The actual macOS build needs Apple's compiler; injected inventory tests run on every host.
  // The real-filesystem preparation compiles both system bindings, so give it
  // room beyond vitest's 5s default on loaded shared runners.
  it.skipIf(process.platform !== 'darwin')('prepares every native file from the installed desktop deploy root', () => {
    const desktopRoot = fileURLToPath(new URL('../', import.meta.url))

    expect(() => prepareInstalledMacUniversalRuntime(desktopRoot)).not.toThrow()
  }, 30_000)

  it('requires every CPU-specific file and repairs both node-pty helpers', () => {
    const chmod = vi.fn()
    const desktopRoot = resolve('/desktop')

    prepareMacUniversalRuntime({ desktopRoot, exists: () => true, chmod })

    expect(chmod.mock.calls).toEqual([
      [join(desktopRoot, 'node_modules/@dataiku/uv-darwin-arm64/bin/uv'), 0o755],
      [join(desktopRoot, 'node_modules/@dataiku/uv-darwin-x64/bin/uv'), 0o755],
      [join(desktopRoot, 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper'), 0o755],
      [join(desktopRoot, 'node_modules/node-pty/prebuilds/darwin-x64/spawn-helper'), 0o755],
    ])
  })

  it('fails before changing permissions when one architecture is incomplete', () => {
    const chmod = vi.fn()
    const desktopRoot = resolve('/desktop')
    const missing = MACOS_UNIVERSAL_NATIVE_ENTRIES.at(-1)!.path

    expect(() => prepareMacUniversalRuntime({
      desktopRoot,
      exists: path => path !== join(desktopRoot, missing),
      chmod,
    })).toThrow(join(desktopRoot, missing))
    expect(chmod).not.toHaveBeenCalled()
  })

  it('hydrates arm64 native packages and version-matched nested Koffi packages', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-mac-runtime-'))
    const desktopRoot = join(root, 'desktop')
    const unpackedRoot = join(root, 'app.asar.unpacked')
    const installedModules = join(desktopRoot, 'node_modules')
    const packagedModules = join(unpackedRoot, 'node_modules')
    const installedKoffi = join(installedModules, 'koffi')
    const packagedKoffi = join(packagedModules, '@deepseek-ai', 'consumer', 'node_modules', 'koffi')
    const installedKoffiNative = join(
      installedModules,
      '@koromix',
      'koffi-darwin-arm64',
      'darwin_arm64',
    )
    const versionedKoffi = join(
      root,
      'node_modules',
      '.pnpm',
      'koffi@3.1.1',
      'node_modules',
      'koffi',
    )
    const versionedKoffiNative = join(
      dirname(versionedKoffi),
      '@koromix',
      'koffi-darwin-arm64',
      'darwin_arm64',
    )
    const aliasedKoffiX64 = join(installedModules, 'koffi-darwin-x64-3-1-1')
    const aliasedKoffiX64Native = join(aliasedKoffiX64, 'darwin_x64')
    const sharpNative = join(installedModules, '@img', 'sharp-darwin-arm64', 'lib')
    const packagedSharpNative = join(packagedModules, '@img', 'sharp-darwin-arm64', 'lib')

    try {
      mkdirSync(installedKoffi, { recursive: true })
      mkdirSync(join(installedModules, '@deepseek-ai', 'consumer'), { recursive: true })
      mkdirSync(packagedKoffi, { recursive: true })
      mkdirSync(join(packagedModules, 'koffi', 'node_modules'), { recursive: true })
      mkdirSync(installedKoffiNative, { recursive: true })
      mkdirSync(versionedKoffi, { recursive: true })
      mkdirSync(versionedKoffiNative, { recursive: true })
      mkdirSync(aliasedKoffiX64Native, { recursive: true })
      mkdirSync(sharpNative, { recursive: true })
      mkdirSync(packagedSharpNative, { recursive: true })
      writeFileSync(
        join(installedKoffi, 'package.json'),
        '{"name":"koffi","version":"3.1.5","exports":{".":"./index.js"}}',
      )
      writeFileSync(join(installedKoffi, 'index.js'), 'export default {}')
      writeFileSync(
        join(installedModules, '@deepseek-ai', 'consumer', 'package.json'),
        '{"name":"@deepseek-ai/consumer"}',
      )
      writeFileSync(join(packagedKoffi, 'package.json'), '{"name":"koffi","version":"3.1.1"}')
      writeFileSync(join(installedKoffiNative, 'koffi.node'), 'koffi-3.1.5-arm64')
      writeFileSync(join(versionedKoffi, 'package.json'), '{"name":"koffi","version":"3.1.1"}')
      writeFileSync(join(versionedKoffiNative, 'koffi.node'), 'koffi-3.1.1-arm64')
      writeFileSync(
        join(aliasedKoffiX64, 'package.json'),
        '{"name":"@koromix/koffi-darwin-x64","version":"3.1.1"}',
      )
      writeFileSync(join(aliasedKoffiX64Native, 'koffi.node'), 'koffi-3.1.1-x64')
      writeFileSync(join(sharpNative, 'sharp.node'), 'sharp-arm64')
      writeFileSync(join(dirname(sharpNative), 'README.md'), 'source documentation')
      writeFileSync(join(packagedSharpNative, 'sharp.node'), 'stale-arm64')
      const persistence = join(installedModules, '@deepseek-ai/dsh-session-persistence-jsonl')
      const system = join(persistence, 'node_modules/@deepseek-ai/node-addon-system')
      mkdirSync(system, { recursive: true })
      writeFileSync(join(persistence, 'package.json'), '{}')
      writeFileSync(join(system, 'package.json'), '{}')
      for (const arch of ['arm64', 'x64']) {
        const platform = join(system, `node_modules/@deepseek-ai/node-addon-system-darwin-${arch}`)
        mkdirSync(join(platform, 'bin'), { recursive: true })
        writeFileSync(join(platform, 'package.json'), JSON.stringify({ version: '0.1.2' }))
        writeFileSync(join(platform, 'bin/system.node'), `system-${arch}`)
      }

      hydratePackagedMacRuntime({ desktopRoot, unpackedRoot, arches: ['arm64', 'x86_64'] })

      for (const arch of ['arm64', 'x64']) {
        expect(readFileSync(join(packagedModules,
          `@deepseek-ai/node-addon-system-darwin-${arch}/bin/system.node`), 'utf8')).toBe(`system-${arch}`)
      }
      expect(readFileSync(join(
        packagedModules,
        '@img',
        'sharp-darwin-arm64',
        'lib',
        'sharp.node',
      ), 'utf8')).toBe('sharp-arm64')
      expect(existsSync(join(
        packagedModules,
        '@img',
        'sharp-darwin-arm64',
        'README.md',
      ))).toBe(false)
      expect(readFileSync(join(
        packagedModules,
        '@deepseek-ai',
        'consumer',
        'node_modules',
        '@koromix',
        'koffi-darwin-arm64',
        'darwin_arm64',
        'koffi.node',
      ), 'utf8')).toBe('koffi-3.1.1-arm64')
      expect(readFileSync(join(
        packagedModules,
        '@deepseek-ai',
        'consumer',
        'node_modules',
        '@koromix',
        'koffi-darwin-x64',
        'darwin_x64',
        'koffi.node',
      ), 'utf8')).toBe('koffi-3.1.1-x64')
      expect(lstatSync(join(packagedModules, '@img', 'sharp-darwin-arm64')).isSymbolicLink())
        .toBe(false)
      expect(existsSync(join(
        packagedModules,
        '@deepseek-ai',
        'consumer',
        'node_modules',
        '@koromix',
        'koffi-darwin-arm64',
        'darwin_arm64',
        'koffi.node',
      ))).toBe(true)
      expect(existsSync(join(packagedModules, '@img', 'sharp-darwin-x64'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// Exercise the same transitive merger electron-builder loads, including pnpm patches.
const builderRequire = createRequire(createRequire(import.meta.url).resolve('electron-builder'))
const universalRequire = createRequire(builderRequire.resolve('app-builder-lib'))
const { makeUniversalApp } = universalRequire('@electron/universal') as {
  makeUniversalApp: (options: {
    x64AppPath: string; arm64AppPath: string; outAppPath: string; mergeASARs: boolean
  }) => Promise<void>
}
const { mergeASARs } = createRequire(universalRequire.resolve('@electron/universal'))('./asar-utils.js') as {
  mergeASARs: (options: {
    x64AsarPath: string; arm64AsarPath: string; outputAsarPath: string
  }) => Promise<void>
}

const fixturePlist = '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleName</key><string>Fixture</string></dict></plist>'

describe.skipIf(process.platform !== 'darwin')('real universal macOS archive assembly', () => {
  it('keeps nested LibreOffice plists in one runtime archive while merging native slices', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-universal-app-'))
    const nestedPlist = 'node_modules/@deepseek-ai/libreoffice-kit-darwin-arm64/program/LibreOfficeDev.app/Contents/Info.plist'
    const native = 'node_modules/fixture/native.node'
    try {
      const apps = ['x64', 'arm64'].map(arch => join(root, `${arch}.app`))
      const cSource = join(root, 'native.c')
      writeFileSync(cSource, 'int fixture(void) { return 42; }\n')
      for (const [index, arch] of ['x86_64', 'arm64'].entries()) {
        const app = apps[index]!
        const source = join(root, `source-${arch}`)
        mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true })
        writeFileSync(join(app, 'Contents', 'Info.plist'), fixturePlist)
        for (const [path, content] of Object.entries({
          'package.json': '{"name":"fixture","main":"main.cjs"}',
          'main.cjs': 'module.exports = "packed runtime";',
          [nestedPlist]: fixturePlist,
        })) {
          mkdirSync(dirname(join(source, path)), { recursive: true })
          writeFileSync(join(source, path), content)
        }
        mkdirSync(dirname(join(source, native)), { recursive: true })
        execFileSync('cc', ['-arch', arch, '-dynamiclib', cSource, '-o', join(source, native)])
        await createPackageWithOptions(source, join(app, 'Contents/Resources/app.asar'), { unpackDir: 'node_modules' })
      }
      const config = JSON.parse(readFileSync(new URL('../electron-builder.json', import.meta.url), 'utf8')) as {
        mac: { mergeASARs: boolean }
      }
      const output = join(root, 'universal.app')
      await makeUniversalApp({ x64AppPath: apps[0]!, arm64AppPath: apps[1]!, outAppPath: output, mergeASARs: config.mac.mergeASARs })
      const archive = join(output, 'Contents/Resources/app.asar')
      expect(extractFile(archive, 'main.cjs').toString()).toBe('module.exports = "packed runtime";')
      expect(readFileSync(join(`${archive}.unpacked`, nestedPlist), 'utf8')).toContain('<string>Fixture</string>')
      expect(existsSync(join(output, 'Contents/Resources/app-arm64.asar'))).toBe(false)
      execFileSync('lipo', [join(`${archive}.unpacked`, native), '-verify_arch', 'x86_64', 'arm64'])
    } finally {
      uncacheAll()
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('merges a large exact unpacked set while preserving executable modes and symlinks', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-universal-many-'))
    try {
      const source = join(root, 'source')
      const directory = `node_modules/fixture/${'long-path-'.repeat(16)}`
      mkdirSync(join(source, directory), { recursive: true })
      writeFileSync(join(source, 'package.json'), '{"name":"fixture"}')
      const paths = Array.from({ length: 400 }, (_, index) => `${directory}/payload-${index}.dat`)
      expect(paths.join(',').length).toBeGreaterThan(65_536)
      for (const path of paths) writeFileSync(join(source, path), 'payload')
      const helper = 'node_modules/fixture/helper'
      const link = 'node_modules/fixture/helper-link'
      writeFileSync(join(source, helper), '#!/bin/sh\nexit 0\n')
      chmodSync(join(source, helper), 0o755)
      symlinkSync('helper', join(source, link))
      const x64 = join(root, 'x64.asar')
      const arm64 = join(root, 'arm64.asar')
      for (const archive of [x64, arm64]) {
        await createPackageWithOptions(source, archive, { unpackDir: 'node_modules' })
      }
      // Repack over the original archive, just as makeUniversalApp does.
      await mergeASARs({ x64AsarPath: x64, arm64AsarPath: arm64, outputAsarPath: x64 })
      for (const path of paths) {
        expect(extractFile(x64, path).toString()).toBe('payload')
        expect(statFile(x64, path)).toHaveProperty('unpacked', true)
      }
      expect(statFile(x64, 'package.json')).not.toHaveProperty('unpacked', true)
      expect(statSync(join(`${x64}.unpacked`, helper)).mode & 0o111).toBe(0o111)
      expect(readlinkSync(join(`${x64}.unpacked`, link))).toBe('helper')
      expect(extractFile(x64, link).toString()).toBe('#!/bin/sh\nexit 0\n')
    } finally {
      uncacheAll()
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)
})
