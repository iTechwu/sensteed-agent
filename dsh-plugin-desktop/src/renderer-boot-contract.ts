/** Loopback Host endpoint reserved for one renderer generation's terminal boot report. */
export const RENDERER_BOOT_REPORT_PATH = '/_dsh/desktop/renderer-boot'

/** One terminal renderer boot outcome reported to the desktop Host. */
export const RENDERER_BOOT_CHALLENGE_PARAM = '_dsh_renderer_boot'

export type RendererBootReport = (
  | { status: 'healthy' }
  | { status: 'failed', plugins: string[], error?: string }
) & { /** Main-owned fresh window challenge; never a renderer-supplied health decision. */ challenge?: string }
