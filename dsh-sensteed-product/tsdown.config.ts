import { defineConfig } from 'tsdown'

const PACKAGE_NAME = '@dofe/dsh-sensteed-product'

export default defineConfig([
  {
    name: PACKAGE_NAME,
    entry: {
      index: 'src/index.ts',
      'dofe-models': 'src/dofe-models.ts',
      'dofe-plugins': 'src/dofe-plugins.ts',
      'dofe-auth-contract': 'src/dofe-auth-contract.ts',
      'dofe-auth-oidc': 'src/dofe-auth-oidc.ts',
      'finance-mcp': 'src/finance-mcp.ts',
      'knowledge-routing': 'src/knowledge-routing.ts',
    },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
  },
])
