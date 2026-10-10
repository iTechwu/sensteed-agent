import { defineConfig } from 'vitest/config'

const HOST_BOOT_SPECS = ['tests/host-process-integration.spec.ts', 'tests/agent-error-logging.host.spec.ts']

// Desktop and sibling UI packages must share the renderer's React instance.
const SHARED_RESOLVE = { dedupe: ['react', 'react-dom'] } as const

export default defineConfig({
  resolve: SHARED_RESOLVE,
  test: {
    environment: 'node',
    globalSetup: process.platform === 'win32' ? ['../scripts/prepare-test-electron.mjs'] : [],
    // Keep patched packages in Vitest's module graph so mocks reach their
    // fs/promises and undici imports instead of using the live filesystem/network.
    server: {
      deps: {
        inline: ['@deepseek-ai/dsh-host-directory-picker-browse', '@deepseek-ai/dsh-client-ui-primitives'],
      },
    },
    projects: [
      {
        resolve: SHARED_RESOLVE,
        test: {
          name: 'unit',
          include: ['tests/**/*.spec.ts'],
          exclude: [...HOST_BOOT_SPECS],
          // Profile integration tests create a full package-junction closure; higher
          // Windows file concurrency makes their latency depend on NTFS/Defender load.
          maxWorkers: process.platform === 'win32' ? 2 : undefined,
        },
      },
      {
        resolve: SHARED_RESOLVE,
        test: {
          name: 'host',
          include: [...HOST_BOOT_SPECS],
          // These specs boot real Host processes; a loaded machine makes their
          // boot latency spike, so they never run concurrently with each other.
          fileParallelism: false,
          maxWorkers: 1,
          testTimeout: 300_000,
        },
      },
    ],
  },
})
