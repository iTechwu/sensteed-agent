import type { Config as McpConfig } from '@deepseek-ai/dsh-mcp-client'

export const FINANCE_MCP_URL = 'https://ai.hozonauto.com/mcp/finance'

export function financeMcpConfig(modelsApiKey: string, accessToken: string): McpConfig {
  return {
    transport: 'streamable-http', serverName: 'finance', url: FINANCE_MCP_URL,
    headers: { Authorization: `Bearer ${modelsApiKey}`, 'X-Sensteed-SSO-Authorization': `Bearer ${accessToken}` },
    toolCallTimeoutMs: 120_000, failOnStartupError: false,
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
  }
}
