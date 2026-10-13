/** Sensteed product layer: shell-independent Cordis rows for the product surface. */

/** The bundle package name used by both activation paths (launcher-owned Desktop layer and official `dsh plugin add`). */
export const PRODUCT_PACKAGE_NAME = '@dofe/dsh-sensteed-product'

/** Keep the package root mountable so the client module registry can inspect its dsh.client declaration. */
export function apply(): void {}
