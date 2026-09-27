/** Local Datasource is explicitly selected for the Sensteed desktop distribution. */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getCACertificates, setDefaultCACertificates } from 'node:tls'
import type { Config as McpConfig } from '@deepseek-ai/dsh-mcp-client'

export const LOCAL_FINANCE_MCP_URL = 'https://datasource.local.dofe.ai/api/mcp'
let trustPrepared = false

/** Add the user's mkcert CA without disabling server certificate verification. */
export function localFinanceMcpConfig(accessToken: string): McpConfig {
  if (!trustPrepared) {
    for (const path of [
      join(homedir(), 'Library', 'Application Support', 'mkcert', 'rootCA.pem'),
      join(homedir(), '.local', 'share', 'mkcert', 'rootCA.pem'),
    ]) {
      try {
        setDefaultCACertificates([...getCACertificates('default'), readFileSync(path, 'utf8')])
        trustPrepared = true
        break
      } catch { /* An absent CA keeps the normal TLS verification failure. */ }
    }
  }
  return {
    transport: 'streamable-http', serverName: 'finance', url: LOCAL_FINANCE_MCP_URL,
    headers: { Authorization: `Bearer ${accessToken}` }, toolCallTimeoutMs: 120_000,
    failOnStartupError: false,
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
  }
}
