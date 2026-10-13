import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { officePackageDirectories, officeUnpackPatterns, selectOfficeEngine } from '../scripts/office-packages.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const names = (platform: string, arch: string): string[] => officePackageDirectories(root, { platform, arch })

it('resolves the installed Office closure with the native engine of each Darwin CPU', () => {
  const arm64 = names('darwin', 'arm64')
  expect(arm64).toEqual(expect.arrayContaining(['@deepseek-ai/libreoffice-kit', '@deepseek-ai/libreoffice-kit-darwin-arm64', '@koromix/koffi-darwin-arm64', 'fflate', 'fontkit', 'koffi', 'saxes']))
  expect(arm64).not.toContain('@deepseek-ai/libreoffice-kit-darwin-x64')
  expect(arm64).not.toContain('@koromix/koffi-darwin-x64')
  const x64 = names('darwin', 'x64')
  expect(x64).not.toContain('@deepseek-ai/libreoffice-kit-darwin-arm64')
  // pnpm 按 os/cpu 守卫跳过跨平台 optional 引擎；x64 引擎仅在 x64 主机的安装树中出现。
  if (x64.includes('@deepseek-ai/libreoffice-kit-darwin-x64')) expect(x64).toContain('@koromix/koffi-darwin-x64')
})

it('unpacks the union of both CPUs once as application-relative globs', () => {
  const patterns = officeUnpackPatterns(root, 'darwin', ['arm64', 'x64'])
  for (const name of ['@deepseek-ai/libreoffice-kit', '@deepseek-ai/libreoffice-kit-darwin-arm64', 'fflate', 'fontkit', 'koffi', 'saxes']) {
    expect(patterns).toContain(`**/node_modules/${name}/**/*`)
  }
  if (patterns.some(pattern => pattern.includes('libreoffice-kit-darwin-x64'))) {
    expect(patterns).toContain('**/node_modules/@koromix/koffi-darwin-x64/**/*')
  }
  expect(new Set(patterns).size).toBe(patterns.length)
  expect(patterns.every(pattern => /^\*\*\/node_modules\/.+\/\*\*\/\*$/u.test(pattern))).toBe(true)
})

it('selects WASM for a target without a declared native engine', () => {
  const manifest = { optionalDependencies: { '@deepseek-ai/libreoffice-kit-darwin-arm64': '0.1.5' } }
  expect(selectOfficeEngine(manifest, { platform: 'darwin', arch: 'arm64' })).toBe('darwin-arm64')
  expect(selectOfficeEngine(manifest, { platform: 'linux', arch: 'x64' })).toBe('wasm')
})
