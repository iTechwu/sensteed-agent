/** Conservative L0 ownership until a signed bootstrap manifest replaces this built-in policy. */
import { DESKTOP_PACKAGE_NAMES } from './product-identity.ts'

const HOST_OWNED = new Set([
  ...DESKTOP_PACKAGE_NAMES,
  'dsh-plugin-desktop-beta',
  '@dofe/dsh-sensteed-product',
  'electron',
  'react',
  'react-dom',
  'scheduler',
])
/** Callers cannot opt core ownership out by supplying a smaller protected list. */
export function hubPackageIsHostOwned(name: string): boolean {
  return name.startsWith('@deepseek-ai/') || HOST_OWNED.has(name)
}
