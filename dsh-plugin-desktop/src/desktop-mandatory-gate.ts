/** Mandatory update gate: refuse profile/plugin mutations while a policy phase is active. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@dofe/dsh-sensteed-product/desktop-mandatory-policy'

/** The settings mutation paths a mandatory-update phase refuses (read/restart/terminal paths stay open). */
const DESKTOP_PLUGIN_MUTATION_PATHS = new Set([
  '/api/desktop/profiles/create',
  '/api/desktop/profiles/delete',
  '/api/desktop/profiles/select',
  '/api/desktop/aa/select',
  '/api/desktop/market/select',
])

export function isDesktopPluginMutationPath(path: string): boolean {
  return DESKTOP_PLUGIN_MUTATION_PATHS.has(path)
}

/** The probed Host-side policy surface (provided by the product update-policy row). */
export interface DesktopMandatoryUpdateGate {
  /** Current phase, or undefined when the product layer never reported one. */
  phase(): 'none' | 'notice' | 'blocking' | undefined
  minVersion(): string | undefined
}

/** Probe the Host context; a missing product row yields a gate that never blocks. */
export function desktopMandatoryGateFrom(ctx: Context): DesktopMandatoryUpdateGate {
  const probe = (): { phase: 'none' | 'notice' | 'blocking'; minVersion?: string } | undefined => {
    try {
      return (ctx as { sensteedMandatoryUpdatePolicy?: { snapshot(): DesktopMandatoryUpdateGateSnapshot } }).sensteedMandatoryUpdatePolicy?.snapshot()
    } catch {
      return undefined
    }
  }
  return {
    phase: () => probe()?.phase,
    minVersion: () => probe()?.minVersion,
  }
}

interface DesktopMandatoryUpdateGateSnapshot {
  readonly phase: 'none' | 'notice' | 'blocking'
  readonly minVersion?: string
}

/** Write the standardized 503 rejection and report whether it was written. */
export function writeDesktopMandatoryUpdateRejection(
  res: ServerResponse,
  gate: DesktopMandatoryUpdateGate,
  locale: string,
): boolean {
  const phase = gate.phase()
  if (phase !== 'notice' && phase !== 'blocking') return false
  const minVersion = gate.minVersion() ?? ''
  const zh = !locale.startsWith('en')
  const body = JSON.stringify({
    error: phase === 'blocking'
      ? (zh ? `需要更新到 ${minVersion} 后才能执行此操作。` : `Update to ${minVersion} is required before performing this action.`)
      : (zh ? `建议更新到 ${minVersion}，此操作暂不可用。` : `Update to ${minVersion} is recommended; this action is unavailable.`),
    reason: 'mandatory-update',
  })
  res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
  return true
}

/** Route-level guard: true when the request was answered with the rejection. */
export function rejectDesktopMandatoryUpdate(
  ctx: Context,
  req: IncomingMessage,
  res: ServerResponse,
  locale: string,
): boolean {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (!isDesktopPluginMutationPath(url.pathname)) return false
  return writeDesktopMandatoryUpdateRejection(res, desktopMandatoryGateFrom(ctx), locale)
}
