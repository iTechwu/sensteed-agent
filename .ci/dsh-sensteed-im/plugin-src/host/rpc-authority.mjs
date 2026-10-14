const RPC_AUTHORITIES = new Set(['loopback', 'trusted-host']);

/**
 * Resolve the browser authority accepted by an IM management RPC channel.
 * By default, use the browser authentication and Host/Origin trust checks
 * already enforced by 哪吒 Agent before it dispatches a management Fetch route.
 */
export function resolveRpcAuthority(value) {
  if (value === undefined) return 'trusted-host';
  if (RPC_AUTHORITIES.has(value)) return value;
  throw new TypeError('sensteed-im rpcAuthority must be "loopback" or "trusted-host"');
}
