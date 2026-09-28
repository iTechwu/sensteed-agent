import { existsSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
it('keeps Next installer topology, native modules, fuses and Composer source aligned with Beta', () => {
  const next = read('../package.json'); const betaBuilder = read('../../dsh-plugin-desktop/electron-builder.json')
  expect(next.version).toBe('2.0.14-next')
  expect(next.build.appId).toBe('ai.deepseek.dsh.desktop.next')
  expect(next.build.asar).toBe(false)
  // Beta 的 fuses 已迁至 electron-builder.json;两侧必须保持同一fuse开关面。
  expect(next.build.electronFuses).toEqual(betaBuilder.electronFuses)
  // 两侧 darwin 原生模块清单已各自演进;断言 Next 侧必需条目(mac x64 解包面)仍然齐全。
  const archFiles: string = next.build.mac.x64ArchFiles
  for (const entry of ['node-pty/prebuilds/darwin-*', 'fs-ext/prebuilds/darwin-*', 'node-addon-require-builtin-darwin-*',
    '@vscode/ripgrep-darwin-*', '@img/sharp-darwin-*', '@img/sharp-libvips-darwin-*', '@koromix/koffi-darwin-*',
    '@deepseek-ai/libreoffice-kit-darwin-*', 'sherpa-onnx-darwin-*', '@trycua/cua-driver-darwin-*', '@ubjs/node-darwin-*']) {
    expect(archFiles).toContain(`${entry}/**`)
  }
  expect(next.build.mac.icon).toBe('build/app-icon.icon')
  expect(existsSync(new URL('../build/app-icon.icon/icon.json', import.meta.url))).toBe(true)
  expect(next.build.nsis).toMatchObject({ oneClick: false, perMachine: false, allowElevation: true, allowToChangeInstallationDirectory: true })
  expect(next.build.mac.notarize).toBe(true)
  expect(next.build.files).toContain('lib/**')
  expect(next.build.files.some((path: string) => path.includes('.desktop-next'))).toBe(false)
})
