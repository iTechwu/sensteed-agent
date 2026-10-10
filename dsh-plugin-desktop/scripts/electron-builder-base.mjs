/**
 * Static electron-builder settings shared by every brand.
 *
 * `scripts/generate-product-identity.mjs` merges these with the brand fields
 * from brand/brand.config.json and emits the committed electron-builder.json
 * that every builder CLI invocation reads. Only identity-dependent fields
 * (appId, productName, artifact names, shortcut name) are brand-rendered;
 * everything here is layout/packaging policy and changes rarely.
 */

const MACOS_UNUSED_PLATFORM_RUNTIMES = [
  '!node_modules/**/@anthropic-ai/claude-agent-sdk-{linux,win32}-*/**',
  '!node_modules/**/@dataiku/uv-{linux,win32}-*/**',
  '!node_modules/**/@deepseek-ai/libreoffice-kit-{linux,win32}-*/**',
  '!node_modules/**/@openai/codex-{linux,win32}-*/**',
  '!node_modules/**/@trycua/cua-driver-{linux,win32}-*/**',
  '!node_modules/**/@ubjs/node-{linux,win32}-*/**',
  '!node_modules/**/@vscode/ripgrep-{linux,win32}-*/**',
  '!node_modules/**/lightningcss-{android,linux,win32}-*/**',
  '!node_modules/**/node-addon-require-builtin-{linux,win32}-*/**',
  '!node_modules/**/sherpa-onnx-{linux,win32}-*/**',
  '!node_modules/**/@img/sharp-{linux,win32}-*/**',
  '!node_modules/**/@img/sharp-libvips-{linux,win32}-*/**',
  '!node_modules/**/@koromix/koffi-{linux,win32,freebsd,openbsd}-*/**',
]

const WINDOWS_UNUSED_PLATFORM_RUNTIMES = [
  '!node_modules/**/@anthropic-ai/claude-agent-sdk-{darwin,linux}-*/**',
  '!node_modules/**/@dataiku/uv-{darwin,linux}-*/**',
  '!node_modules/**/@deepseek-ai/libreoffice-kit-{darwin,linux}-*/**',
  '!node_modules/**/@openai/codex-{darwin,linux}-*/**',
  '!node_modules/**/@trycua/cua-driver-{darwin,linux}-*/**',
  '!node_modules/**/@ubjs/node-{darwin,linux}-*/**',
  '!node_modules/**/@vscode/ripgrep-{darwin,linux}-*/**',
  '!node_modules/**/lightningcss-{android,darwin,linux}-*/**',
  '!node_modules/**/node-addon-require-builtin-{darwin,linux}-*/**',
  '!node_modules/**/sherpa-onnx-{darwin,linux}-*/**',
  '!node_modules/**/@img/sharp-{darwin,linux}-*/**',
  '!node_modules/**/@img/sharp-libvips-{darwin,linux}-*/**',
  '!node_modules/**/@koromix/koffi-{darwin,linux,freebsd,openbsd}-*/**',
]

const LINUX_UNUSED_PLATFORM_RUNTIMES = [
  '!node_modules/**/@anthropic-ai/claude-agent-sdk-{darwin,win32}-*/**',
  '!node_modules/**/@dataiku/uv-{darwin,win32}-*/**',
  '!node_modules/**/@deepseek-ai/libreoffice-kit-{darwin,win32}-*/**',
  '!node_modules/**/@openai/codex-{darwin,win32}-*/**',
  '!node_modules/**/@trycua/cua-driver-{darwin,win32}-*/**',
  '!node_modules/**/@ubjs/node-{darwin,win32}-*/**',
  '!node_modules/**/@vscode/ripgrep-{darwin,win32}-*/**',
  '!node_modules/**/lightningcss-{android,darwin,win32}-*/**',
  '!node_modules/**/node-addon-require-builtin-{darwin,win32}-*/**',
  '!node_modules/**/sherpa-onnx-{darwin,win32}-*/**',
  '!node_modules/**/@img/sharp-{darwin,win32}-*/**',
  '!node_modules/**/@img/sharp-libvips-{darwin,win32}-*/**',
  '!node_modules/**/@koromix/koffi-{darwin,win32,freebsd,openbsd}-*/**',
  '!node_modules/**/{linux-arm,linux-arm64,linux-ia32,linux-loong64,linux-ppc64,linux-riscv64,linux-s390x,linuxmusl-*,linux-arm64-musl,linux-x64-musl}-*/**',
  '!node_modules/**/dsh-community-market/node_modules/**',
]

// Source maps are build/debug artifacts; keep executable code, declarations,
// native runtimes, manifests, and licenses in the installed product.
const RUNTIME_DEBUG_EXCLUSIONS = [
  '!**/*.{js,cjs,mjs,ts,cts,mts,css}.map',
]

const COMMON_APP_FILES = [
  'build/app-icon.ico',
  'build/app-icon.png',
  'build/app-icon-mac.png',
  'build/brand-logo.png',
  'build/tray-icon*.png',
  'cordis.patch.yml',
  'lib/**',
  'package.json',
  // a0a4298b0b 的运行时闭包：这些一方依赖的 pnpm store 拷贝会被
  // 图收集器丢弃，globs 是它们进入 ASAR 的通道。
  'node_modules/@opentelemetry/otlp-exporter-base/**',
  'node_modules/@opentelemetry/otlp-transformer/**',
  'node_modules/@opentelemetry/resources/**',
  'node_modules/@opentelemetry/sdk-logs/**',
  'node_modules/chokidar/**',
  'node_modules/execa/**',
  'node_modules/got/**',
  'node_modules/turndown/**',
  '!node_modules/koffi-darwin-*-3-1-1/**',
  '!node_modules/node-pty/build/**',
  ...RUNTIME_DEBUG_EXCLUSIONS,
]

export const ELECTRON_BUILDER_BASE = Object.freeze({
  electronLanguages: ['en-US', 'zh-CN'],
  asar: {
    smartUnpack: true,
  },
  beforePack: './scripts/mac-system-runtime.ts',
  afterPack: './scripts/verify-packaged-runtime.ts',
  electronDownload: {
    checksums: {
      'electron-v44.0.0-darwin-arm64.zip': '076d79742986e1b100b69ebecc691cb07368045e54c9087cef631b8622b76a80',
      'electron-v44.0.0-darwin-x64.zip': '28429e700ad68d9624aaa90b6543ffe891a48c14121fd904cd294e5edcee63ff',
      'electron-v44.0.0-linux-x64.zip': 'd65286d812719f2b4c1a1b806a80f288a1058c89c7b058dae1e03ab25e499446',
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
  files: COMMON_APP_FILES,
  mac: {
    asarUnpack: [
      'build/app-icon-mac.png',
      'build/tray-iconTemplate.png',
      'build/tray-iconTemplate@2x.png',
      'node_modules/fs-ext/**',
      'node_modules/@agents-anywhere/dsh-bridge-next/lib/bundled-connector/**',
      'node_modules/node-addon-require-builtin/**',
      'node_modules/node-addon-native-custom-loader/**',
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
      // Local stores can retain optional binaries for other platforms. Keep
      // both macOS slices, but never ship Linux/Windows tool runtimes here.
      '!node_modules/koffi-win32-x64-3-1-1/**',
      ...MACOS_UNUSED_PLATFORM_RUNTIMES,
      ...RUNTIME_DEBUG_EXCLUSIONS,
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
    // Keep the single app.asar layout consumed by afterPack and native-runtime
    // verification. The universal toolchain patch avoids oversized unpack globs.
    mergeASARs: true,
    notarize: true,
    signIgnore: [
      '\\.(?:pak|dat|wasm)$',
    ],
      x64ArchFiles: '**/node_modules/{@deepseek-ai/node-addon-system-darwin-*/**,@deepseek-ai/libreoffice-kit-darwin-*/**,node-pty/prebuilds/darwin-*/**,fs-ext/prebuilds/darwin-*/**,node-addon-require-builtin-darwin-*/**,@vscode/ripgrep-darwin-*/**,@img/sharp-darwin-*/**,@img/sharp-libvips-darwin-*/**,@koromix/koffi-darwin-*/**,lightningcss-darwin-*/**,@anthropic-ai/claude-agent-sdk-darwin-*/**,@openai/codex-darwin-*/**,@trycua/cua-driver-darwin-*/**,@ubjs/node-darwin-*/**,sherpa-onnx-darwin-*/**,@dataiku/uv-darwin-*/**}',
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
      'node_modules/node-addon-native-custom-loader/**',
      'node_modules/node-addon-require-builtin-win32-x64/**',
      'node_modules/node-addon-require-builtin-win32-arm64/**',
    ],
    files: [
      // The AA bridge junction is dropped from the archive by the Windows
      // dependency-tree copy; force it in through the top-level link and keep
      // the published tarball's residual nested node_modules out.
      'node_modules/@agents-anywhere/dsh-bridge-next/**',
      '!node_modules/@agents-anywhere/dsh-bridge-next/node_modules/**',
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
      ...WINDOWS_UNUSED_PLATFORM_RUNTIMES,
      ...RUNTIME_DEBUG_EXCLUSIONS,
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
    files: [
      ...COMMON_APP_FILES,
      ...LINUX_UNUSED_PLATFORM_RUNTIMES,
    ],
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
