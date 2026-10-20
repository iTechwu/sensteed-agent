/** Preview-only addresses; these helpers do not authorize MCP connections. */
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';

export function previewHostname(value) {
  const name = String(value);
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(name)) {
    throw new Error('Preview hostname must be a single DNS label');
  }
  return name.toLowerCase();
}

export function isPrivatePreviewAddress(value) {
  if (isIP(value) === 4) {
    const [a, b] = value.split('.').map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (isIP(value) === 6) {
    const lower = value.toLowerCase();
    return lower === '::1' || /^f[cd][0-9a-f]{2}:/.test(lower) || /^fe[89ab][0-9a-f]:/.test(lower);
  }
  return false;
}

export function previewBindHost(value) {
  const host = String(value);
  // Wildcard bind keeps the existing deliberate LAN-serving feature. Readiness
  // always connects to literal loopback; wildcard is never a URL authority.
  if (host === '0.0.0.0' || host === '::') {
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries || []) {
        if (entry.internal || (host === '0.0.0.0' && entry.family !== 'IPv4')) continue;
        if (!isPrivatePreviewAddress(entry.address)) throw new Error('Wildcard preview would expose a public interface; choose a private bind IP');
      }
    }
    return host;
  }
  if (host === 'localhost' || isPrivatePreviewAddress(host)) return host;
  throw new Error('Preview bind host must be loopback, private LAN, or a wildcard bind');
}

export function previewPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid preview port');
  return port;
}
