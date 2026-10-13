import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { IMSettingsTab, IM_PLUGIN_VERSION } from '../../plugin-src/client/index.js';
import { en, localizeText, setImTranslator } from '../../plugin-src/client/i18n.js';
import { installImStyles } from '../../plugin-src/client/styles.js';
import { installWeixinStyles } from '../../plugin-src/client/channels/weixin/styles.js';
import { installFeishuStyles } from '../../plugin-src/client/channels/feishu/styles.js';
import { installWecomStyles } from '../../plugin-src/client/channels/wecom/styles.js';
import { installWecomAppStyles } from '../../plugin-src/client/channels/wecom-app/styles.js';
import { installQqStyles } from '../../plugin-src/client/channels/qq/styles.js';
import { installEmailStyles } from '../../plugin-src/client/channels/email/styles.js';
import { installOfficeStyles } from '../../plugin-src/client/channels/office/styles.js';

// This fixture never calls a platform or authorizes a real account.
const params = new URLSearchParams(location.search);
if (params.has('en')) setImTranslator(key => en[key] ?? key);
for (const install of [installWeixinStyles, installFeishuStyles, installWecomStyles,
  installWecomAppStyles, installQqStyles, installEmailStyles, installOfficeStyles, installImStyles]) install();
document.documentElement.dataset.theme = params.get('theme') ?? 'dark';
document.getElementById('app').style.width = `${Number(params.get('width')) || 880}px`;
const errors = [];
window.addEventListener('error', event => errors.push(event.message));
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
const calls = [];
let provisioning = null;
let starts = 0;
let polls = 0;
let connected = params.get('scenario') === 'connected';
const snapshot = () => ({
  schemaVersion: 1, revision: 1, state: connected ? 'connected' : 'idle', provisioning,
  bots: connected ? [{
    botId: 'wx_demo', configured: true, connected: true, state: 'connected',
    workspace: '/workspace/demo', bot: { name: '演示助手', accountIdMasked: 'demo•••' },
    health: { summary: '微信连接正常', lastCheckedAt: Date.now() },
  }] : [],
});
const rpcCall = async (endpoint) => {
  calls.push(endpoint);
  if (endpoint === 'channel.availability') return { ok: true, value: { enabled: !params.has('no-email') } };
  if (endpoint.startsWith('update.')) return { ok: true, value: {
    runningVersion: IM_PLUGIN_VERSION, hostVersion: '0.0.1', canInstall: false, blockedReason: 'source-install',
  } };
  if (endpoint === 'settings.inbound-ttl.get') return { ok: true, value: { ttlHours: 24 } };
  if (endpoint === 'settings.image-input.get') return { ok: true, value: { mode: 'auto' } };
  if (endpoint === 'provision.begin') {
    starts += 1;
    if (params.get('scenario') === 'error' || params.has('test') && starts === 1) {
      return { ok: false, error: { code: 'network-error', message: '暂时无法访问微信服务。' } };
    }
    provisioning = { attemptId: 'preview_attempt', status: 'pending',
      expiresAt: Date.now() + 300_000, pollIntervalMs: 500, qrCodeDataUrl: __FIXTURE_QR__ };
    return { ok: true, value: provisioning };
  }
  if (endpoint === 'provision.poll') {
    if (params.has('test') && starts > 2 && ++polls >= 2) {
      connected = true;
      provisioning = { ...provisioning, status: 'connected', botId: 'wx_demo' };
    }
    return { ok: true, value: provisioning };
  }
  if (endpoint === 'provision.cancel') {
    provisioning = null;
    return { ok: true, value: { cancelled: true } };
  }
  return { ok: true, value: snapshot() };
};
const props = Object.fromEntries(['weixin', 'feishu', 'dingtalk', 'wecom', 'wecomApp', 'qq',
  'email', 'office', 'update', 'globalSettings'].map(name => [`${name}RpcCall`, rpcCall]));
createRoot(document.getElementById('app')).render(React.createElement(IMSettingsTab, props));

const assert = (value, message) => { if (!value) throw new Error(message); };
const button = label => [...document.querySelectorAll('button')].find(el => el.textContent === localizeText(label));
const until = async (check, message) => {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};
async function run() {
  await until(() => button('生成微信二维码'), 'WeChat empty state did not mount');
  const tabs = () => [...document.querySelectorAll('.dim-rail [role="tab"]')];
  assert(!tabs().some(el => /slack|telegram|discord|whatsapp|imessage|matrix/i.test(el.id)), 'Overseas entry remains visible');
  assert(tabs().length === (params.has('no-email') ? 7 : 8), 'Wrong channel count');
  assert(!button('扫码接入机器人'), 'Empty state has duplicate setup actions');
  const key = (id, key) => document.getElementById(`dim-tab-${id}`).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  key('weixin', 'ArrowUp');
  await until(() => document.activeElement.id === 'dim-tab-office', 'Keyboard wrap failed');
  await until(() => document.querySelector('.dim-panel').id === 'dim-panel-office', 'Office navigation did not render');
  key('office', 'Home');
  await until(() => document.querySelector('.dim-panel').id === 'dim-panel-weixin', 'Home navigation failed');
  button('通用设置').click();
  await until(() => document.querySelector('.dim-panel').id === 'dim-panel-global-settings', 'General settings did not open');
  assert(tabs().filter(el => el.tabIndex === 0).length === 1, 'Rail is unreachable from general settings');
  key('weixin', 'ArrowDown');
  await until(() => document.activeElement.id === 'dim-tab-feishu', 'Keyboard cannot leave general settings');
  await until(() => document.querySelector('.dim-panel').id === 'dim-panel-feishu', 'Feishu navigation did not render');
  key('feishu', 'Home');
  await until(() => document.querySelector('.dim-panel').id === 'dim-panel-weixin' && button('生成微信二维码'), 'Return to WeChat failed');
  const page = document.querySelector('.dim-page');
  assert(page.scrollWidth <= page.clientWidth + 1, 'Page overflows its container');
  button('生成微信二维码').click();
  await until(() => button('重新生成二维码'), 'Error recovery did not mount');
  button('重新生成二维码').click();
  await until(() => document.querySelector('.dim-qrFrame img'), 'QR setup did not mount');
  button('取消').click();
  await until(() => document.activeElement === button('生成微信二维码'), 'Cancel did not restore focus');
  button('生成微信二维码').click();
  await until(() => document.querySelector('.dim-botCard'), 'Connected bot did not mount');
  assert(page.scrollWidth <= page.clientWidth + 1, 'Connected account overflows its container');
  assert(errors.length === 0, errors.join('; '));
  if (params.has('en')) assert(!/[\p{Script=Han}]/u.test(page.textContent.replace('演示助手', '')), 'UI is not fully translated');
  window.__imSettingsResult = { passed: true, width: page.clientWidth, calls, errors };
  document.getElementById('result').textContent = 'Passed: navigation, retry, cancel focus, connected state and layout';
}
if (params.has('test')) run().catch(error => {
  window.__imSettingsResult = { passed: false, error: error.message, calls, errors };
  document.getElementById('result').textContent = error.stack;
});
