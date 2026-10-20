/** Sealed projection owned by docker-helm route-registry.yml.
 * Sync: python3 scripts/mcp_route_contract.py --capability-consumer ../sensteed-agent/dsh-sensteed-product/src/public-mcp-capabilities.json --write
 * Availability is not tenant authorization; Models and upstreams still enforce access.
 */
import projection from './public-mcp-capabilities.json' with { type:'json' }
export const PUBLIC_MCP_CAPABILITIES=Object.freeze(projection.endpoints.map(row=>Object.freeze({...row})))
export const HUB_HOST_CAPABILITIES=Object.freeze(['hub.requirements.v1','hub.requirements@1.0.0','hub.mcp@1.0.0',...PUBLIC_MCP_CAPABILITIES.map(row=>`mcp.endpoint:${row.service}/${row.domain}@1.0.0`)])
export function publicMcpEndpoint(ref:{readonly service:string;readonly domain:string}) {
 const row=PUBLIC_MCP_CAPABILITIES.find(row=>row.service===ref.service&&row.domain===ref.domain)
 if(!row||row.publicUrl!==`https://ai.hozonauto.com${row.route}`||!row.route.startsWith('/mcp/'))throw Error('HUB_MCP_ENDPOINT_UNAVAILABLE')
 return row
}
