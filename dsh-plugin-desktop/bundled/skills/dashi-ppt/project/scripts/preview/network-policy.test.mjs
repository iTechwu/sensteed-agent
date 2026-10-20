import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { previewBindHost, previewHostname, previewPort, isPrivatePreviewAddress } from './network-policy.mjs';

test('preserves deliberate loopback and private LAN preview binding', () => {
  for (const host of ['127.0.0.1', 'localhost', '10.2.3.4', '172.16.0.1', '192.168.5.6', '169.254.1.2', '::1', 'fd12::1', 'fe80::1']) {
    assert.equal(previewBindHost(host), host);
  }
  assert.equal(isPrivatePreviewAddress('8.8.8.8'), false);
  assert.equal(isPrivatePreviewAddress('172.32.0.1'), false);
});
test('wildcard cannot expose a public interface and retains private-only LAN binding', () => {
  const original = os.networkInterfaces;
  try {
    os.networkInterfaces = () => ({ eth0: [{ address: '8.8.8.8', family: 'IPv4', internal: false }] });
    syncBuiltinESMExports();
    assert.throws(() => previewBindHost('0.0.0.0'));
    assert.throws(() => previewBindHost('::'));
    os.networkInterfaces = () => ({ eth0: [{ address: '192.168.1.2', family: 'IPv4', internal: false }] });
    syncBuiltinESMExports();
    assert.equal(previewBindHost('0.0.0.0'), '0.0.0.0');
    assert.equal(previewBindHost('::'), '::');
  } finally { os.networkInterfaces = original; syncBuiltinESMExports(); }
});
test('rejects public or injected host/name authorities', () => {
  for (const host of ['8.8.8.8', 'example.com', 'localhost@evil.test', '127.0.0.1/path', '127.0.0.1:8080', '::ffff:8.8.8.8', ' 127.0.0.1']) {
    assert.throws(() => previewBindHost(host));
  }
  for (const name of ['foo.local', 'foo@evil', 'foo/path', '-foo', 'foo-', 'a'.repeat(64), 'foo\nbar']) {
    assert.throws(() => previewHostname(name));
  }
  assert.equal(previewHostname('My-Mac'), 'my-mac');
});
test('ports remain bounded integers', () => {
  assert.equal(previewPort('4178'), 4178);
  for (const port of [0, 65536, -1, 1.2, '1@evil', Infinity]) assert.throws(() => previewPort(port));
});
