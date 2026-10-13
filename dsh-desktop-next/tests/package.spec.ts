import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { OPTIONAL_BUNDLES } from '@deepseek-ai/dsh-app-boot'
import { expect, it } from 'vitest'
const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
it('declares every official optional bundle as a discoverable, version-aligned installation dependency', () => {
  const next = read('../package.json')
  const require = createRequire(new URL('../package.json', import.meta.url))
  for (const name of OPTIONAL_BUNDLES) {
    expect(next.dependencies[name], name).toBe(next.dependencies['@deepseek-ai/dsh-app-boot'])
    const installed = JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8'))
    expect(installed.version, name).toBe(next.dependencies[name])
    expect(installed.dsh?.bundle?.patch, name).toBeTruthy()
  }
})

it('archives the application like upstream Desktop while keeping fuses and native inventory aligned with Beta', () => {
  const next = read('../package.json'); const beta = read('../../dsh-plugin-desktop/package.json')
  // Sensteed 的 stable 把 electron-builder 配置放在独立文件里，fuse 面与 x64 原生清单从这里读取。
  const betaBuilder = read('../../dsh-plugin-desktop/electron-builder.json')
  expect(next.version).toBe('2.0.17-next')
  expect(next.build.appId).toBe('ai.deepseek.dsh.desktop.next')
  expect(next.build.asar).toBe(true)
  for (const platform of ['mac', 'win', 'linux']) expect(next.build[platform].asar, platform).toBeUndefined()
  // Both CPU builds archive identical bytes, so the universal build keeps one archive. Merging would
  // rebuild it with one unpack glob per unpacked file and overflow minimatch, as 9ecf5ce32b found.
  expect(next.build.mac.mergeASARs).toBe(false)
  // Electron's own fs and dlopen read the archive; child processes, shells and nativeImage need these physically.
  expect(next.build.asarUnpack).toEqual(expect.arrayContaining(['**/*.{node,dylib,dll,so,exe}', '**/*.so.*', '**/spawn-helper',
    '**/@vscode/ripgrep-*/bin/rg', '**/@dataiku/uv-*/bin/uv', '**/node_modules/@deepseek-ai/libreoffice-kit-*/**/*', '**/node_modules/pnpm/**/*',
    '**/node_modules/@agents-anywhere/dsh-bridge-next/lib/bundled-connector/**/*', 'scripts/node-bin/**/*', 'assets/**/*', 'build/**/*']))
  // The Desktop file policy is applied by these globs; the afterPack audit rejects anything they miss.
  expect(next.build.files).toEqual(expect.arrayContaining(['!**/*.{js,cjs,mjs,ts,cts,mts,css}.map', '!**/*.d.{ts,cts,mts}', '!**/*.tsbuildinfo']))
  // Platform omissions join the single file set in beforePack; a platform-level files list would include everything else.
  for (const platform of ['mac', 'win', 'linux']) expect(next.build[platform].files, platform).toBeUndefined()
  expect(next.build.beforePack).toBe('./scripts/prepare-pack.ts')
  expect(next.build.afterPack).toBe('./scripts/verify-packaged.ts')
  expect(next.build.afterAllArtifactBuild).toBe('./scripts/verify-fuses.ts')
  expect(next.build.electronFuses).toEqual(betaBuilder.electronFuses)
  // The interpreter payloads of both CPUs are identical across the two CPU builds, so the universal merge keeps them as they are.
  // Sensteed 的 stable 原生清单额外携带 claude-agent-sdk/codex/lightningcss 三个自有条目，两侧 glob 不逐字相等，
  // 只断言 Next 侧包含 stable 的公共清单主体并追加 runtime 载荷。
  expect(next.build.mac.x64ArchFiles).toContain('**/node_modules/{')
  expect(next.build.mac.x64ArchFiles.endsWith(',Contents/Resources/runtime/**}')).toBe(true)
  // Both CPU payloads ride beside the archive as extra resources; electron-builder must not re-sign the pre-signed payloads.
  for (const platform of ['mac', 'win']) expect(next.build[platform].extraResources, platform).toEqual([{ from: '.desktop-build/runtime', to: 'runtime' }])
  expect(next.build.extraResources).toBeUndefined()
  expect(next.build.linux.extraResources).toBeUndefined()
  expect(next.build.mac.signIgnore).toContain('/Contents/Resources/runtime/(?:arm64|x64)/primary-runtime(?:/|$)')
  expect(next.scripts['prepare:runtime']).toBe('node scripts/prepare-runtime.ts')
  // Like upstream Desktop's dev launcher, every development launch prepares the payload before the shell starts.
  expect(next.scripts.dev).toBe('pnpm run build && pnpm run prepare:runtime && node scripts/start.mjs')
  expect(next.scripts.start).toBe('pnpm run prepare:runtime && node scripts/start.mjs')
  for (const name of ['@deepseek-ai/dsh-skill-office', '@deepseek-ai/dsh-tool-workspace-dependencies']) expect(next.dependencies[name], name).toBe(next.dependencies['@deepseek-ai/dsh'])
  expect(next.build.mac.icon).toBe('build/app-icon.icon')
  expect(existsSync(new URL('../build/app-icon.icon/icon.json', import.meta.url))).toBe(true)
  expect(next.build.nsis).toMatchObject({ oneClick: false, perMachine: false, allowElevation: true, allowToChangeInstallationDirectory: true })
  expect(next.build.mac.notarize).toBe(true)
  expect(next.build.files).toContain('lib/**')
  expect(next.build.files.some((path: string) => path.includes('.desktop-next'))).toBe(false)
})
