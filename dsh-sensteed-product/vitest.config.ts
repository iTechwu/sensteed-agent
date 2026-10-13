import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The product client components and the shell-rendered React tree must share one instance.
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
})
