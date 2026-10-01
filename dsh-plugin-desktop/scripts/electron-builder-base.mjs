/**
 * Static electron-builder settings shared by every brand.
 *
 * `scripts/generate-product-identity.mjs` merges these with the brand fields
 * from brand/brand.config.json and emits the committed electron-builder.json
 * that every builder CLI invocation reads. Only identity-dependent fields
 * (appId, productName, artifact names, shortcut name) are brand-rendered;
 * everything here is layout/packaging policy and changes rarely.
 */

export const ELECTRON_BUILDER_BASE = Object.freeze({
  asar: {
    smartUnpack: true,
  },
  beforePack: './scripts/mac-system-runtime.ts',
  afterPack: './scripts/verify-packaged-runtime.ts',
  electronDownload: {
    checksums: {
      'electron-v44.0.0-darwin-arm64.zip': '076d79742986e1b100b69ebecc691cb07368045e54c9087cef631b8622b76a80',
      'electron-v44.0.0-darwin-x64.zip': '28429e700ad68d9624aaa90b6543ffe891a48c14121fd904cd294e5edcee63ff',
      'electron-v44.0.0-win32-x64.zip': 'e61aa3bcea8152bc0730abd015e47c032d778a0ef10e2a1c78ba3c4ea47942f9',
    },
  },
  electronFuses: {
    enableEmbeddedAsarIntegrityValidation: false,
    onlyLoadAppFromAsar: false,
    resetAdHocDarwinSignature: true,
    runAsNode: true,
  },
  directories: {
    output: 'dist',
    buildResources: 'build',
  },
  toolsets: {
    nsis: '1.2.1',
  },
  files: [
    'build/app-icon.ico',
    'build/app-icon.png',
    'build/app-icon-mac.png',
    'build/brand-logo.png',
    'build/tray-icon*.png',
    'cordis.patch.yml',
    'lib/**',
    'package.json',
    '!node_modules/koffi-darwin-*-3-1-1/**',
    '!node_modules/node-pty/build/**',
  ],
  mac: {
    asarUnpack: [
      'build/app-icon-mac.png',
      'build/tray-iconTemplate.png',
      'build/tray-iconTemplate@2x.png',
      'node_modules/fs-ext/**',
      'node_modules/node-addon-require-builtin/**',
      'node_modules/node-addon-require-builtin-darwin-arm64/**',
      'node_modules/node-addon-require-builtin-darwin-x64/**',
    ],
    files: [
      'build/app-icon.png',
      'build/app-icon-mac.png',
      'build/brand-logo.png',
      'build/tray-icon*.png',
      'cordis.patch.yml',
      'lib/**',
      'package.json',
      '!node_modules/@img/sharp-linux*/**',
      '!node_modules/@img/sharp-libvips-linux*/**',
      '!node_modules/@koromix/koffi-linux*/**',
      '!node_modules/@koromix/koffi-freebsd*/**',
      '!node_modules/@koromix/koffi-openbsd*/**',
      '!node_modules/@koromix/koffi-win32*/**',
      '!node_modules/@img/sharp-win32*/**',
      '!node_modules/node-addon-require-builtin-linux*/**',
      '!node_modules/node-addon-require-builtin-win32*/**',
      '!node_modules/lightningcss-linux*/**',
      '!node_modules/**/lightningcss-linux*/**',
      '!node_modules/lightningcss-android*/**',
      '!node_modules/**/lightningcss-android*/**',
      '!node_modules/**/lightningcss-freebsd*/**',
      '!node_modules/lightningcss-win32*/**',
      '!node_modules/**/lightningcss-win32*/**',
      '!node_modules/**/@vscode/ripgrep-linux*/**',
      '!node_modules/**/@vscode/ripgrep-win32*/**',
      '!node_modules/koffi-win32-x64-3-1-1/**',
    ],
    target: [
      'dir',
    ],
    category: 'public.app-category.developer-tools',
    extendInfo: {
      CFBundleAllowMixedLocalizations: true,
      CFBundleDevelopmentRegion: 'en',
      CFBundleLocalizations: [
        'en',
        'zh_CN',
      ],
    },
    hardenedRuntime: true,
    icon: 'build/app-icon-mac.png',
    mergeASARs: false,
    notarize: true,
    signIgnore: [
      '\\.(?:pak|dat|wasm)$',
    ],
      x64ArchFiles: '**/node_modules/{@deepseek-ai/node-addon-system-darwin-*/**,@deepseek-ai/libreoffice-kit-darwin-*/**,node-pty/prebuilds/darwin-*/**,fs-ext/prebuilds/darwin-*/**,node-addon-require-builtin-darwin-*/**,@vscode/ripgrep-darwin-*/**,@img/sharp-darwin-*/**,@img/sharp-libvips-darwin-*/**,@koromix/koffi-darwin-*/**,lightningcss-darwin-*/**,@anthropic-ai/claude-agent-sdk-darwin-*/**,@openai/codex-darwin-*/**,@trycua/cua-driver-darwin-*/**,@ubjs/node-darwin-*/**,sherpa-onnx-darwin-*/**}',
  },
  win: {
    asarUnpack: [
      'build/app-icon.png',
      'build/tray-icon-blue.png',
      'build/tray-icon-blue@1.25x.png',
      'build/tray-icon-blue@1.5x.png',
      'build/tray-icon-blue@2x.png',
      'node_modules/@agents-anywhere/dsh-bridge-next/lib/bundled-connector/**',
      'node_modules/node-addon-require-builtin/**',
      'node_modules/node-addon-require-builtin-win32-x64/**',
      'node_modules/node-addon-require-builtin-win32-arm64/**',
    ],
    files: [
      '!node_modules/@img/sharp-darwin*/**',
      '!node_modules/@img/sharp-libvips-darwin*/**',
      '!node_modules/@img/sharp-win32-arm64*/**',
      '!node_modules/@img/sharp-win32-ia32*/**',
      '!node_modules/@koromix/koffi-darwin*/**',
      '!node_modules/@koromix/koffi-win32-arm64*/**',
      '!node_modules/@koromix/koffi-win32-ia32*/**',
      '!node_modules/**/@vscode/ripgrep-darwin*/**',
      '!node_modules/lightningcss-darwin*/**',
      '!node_modules/**/lightningcss-darwin*/**',
      '!node_modules/lightningcss-win32-arm64*/**',
      '!node_modules/**/lightningcss-win32-arm64*/**',
      '!node_modules/node-addon-require-builtin-darwin*/**',
      '!node_modules/node-addon-require-builtin-win32-arm64*/**',
      '!node_modules/node-addon-require-builtin-win32-ia32*/**',
      '!node_modules/koffi-darwin-*-3-1-1/**',
    ],
    target: [
      {
        target: 'nsis',
        arch: [
          'x64',
        ],
      },
    ],
    icon: 'build/app-icon.ico',
  },
  nsis: {
    include: 'installer.nsh',
    installerIcon: 'build/app-icon.ico',
    license: 'THIRD_PARTY_NOTICES.md',
    oneClick: false,
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    differentialPackage: false,
    useZip: false,
  },
  linux: {
    target: [
      {
        target: 'AppImage',
        arch: [
          'x64',
        ],
      },
      {
        target: 'deb',
        arch: [
          'x64',
        ],
      },
    ],
    icon: 'build/app-icon.png',
    category: 'Development',
    maintainer: 'Yootun <dshdesktop@dshdesktop.cn>',
    asarUnpack: [
      'build/app-icon.png',
      'build/tray-icon-blue.png',
      'build/tray-icon-blue@1.25x.png',
      'build/tray-icon-blue@1.5x.png',
      'build/tray-icon-blue@2x.png',
    ],
  },
  deb: {
    packageCategory: 'devel',
    priority: 'optional',
  },
})
