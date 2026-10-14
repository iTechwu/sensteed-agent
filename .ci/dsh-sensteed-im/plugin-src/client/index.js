import { callManagementRpc } from '../management-rpc.mjs';
import * as React from 'react';
import manifest from '../../package.json' with { type: 'json' };

import {
  DingtalkLogoGlyph,
  FeishuLogoGlyph,
  OfficeLogoGlyph,
  QqLogoGlyph,
  WecomLogoGlyph,
  WeixinLogoGlyph,
  EmailLogoGlyph,
} from './channel-logos.js';
import { DINGTALK_RPC_CHANNEL } from './channels/dingtalk/api.js';
import { DingtalkSettingsTab } from './channels/dingtalk/index.js';
import { DISCORD_RPC_CHANNEL } from './channels/discord/api.js';
import { FeishuSettingsTab } from './channels/feishu/index.js';
import { FEISHU_RPC_CHANNEL } from './channels/feishu/api.js';
import { installFeishuStyles } from './channels/feishu/styles.js';
import { QQ_RPC_CHANNEL } from './channels/qq/api.js';
import { QqSettingsTab } from './channels/qq/index.js';
import { installQqStyles } from './channels/qq/styles.js';
import { OFFICE_RPC_CHANNEL } from './channels/office/api.js';
import { OfficeSettingsTab } from './channels/office/index.js';
import { installOfficeStyles } from './channels/office/styles.js';
import { SLACK_RPC_CHANNEL } from './channels/slack/api.js';
import { TELEGRAM_RPC_CHANNEL } from './channels/telegram/api.js';
import { WECOM_RPC_CHANNEL } from './channels/wecom/api.js';
import { WecomSettingsTab } from './channels/wecom/index.js';
import { installWecomStyles } from './channels/wecom/styles.js';
import { WECOM_APP_RPC_CHANNEL } from './channels/wecom-app/api.js';
import { WecomAppSettingsTab } from './channels/wecom-app/index.js';
import { installWecomAppStyles } from './channels/wecom-app/styles.js';
import { WeixinSettingsTab } from './channels/weixin/index.js';
import { WEIXIN_RPC_CHANNEL } from './channels/weixin/api.js';
import { installWeixinStyles } from './channels/weixin/styles.js';
import { WHATSAPP_RPC_CHANNEL } from './channels/whatsapp/api.js';
import { IMESSAGE_RPC_CHANNEL } from './channels/imessage/api.js';
import { EMAIL_RPC_CHANNEL } from './channels/email/api.js';
import { EmailSettingsTab, useEmailChannelEnabled } from './channels/email/index.js';
import { installEmailStyles } from './channels/email/styles.js';
import { MATRIX_RPC_CHANNEL } from './channels/matrix/api.js';
import { en, h, IM_LOCALE_NAMESPACE, setImTranslator, zh } from './i18n.js';
import {
  HOST_LANGUAGE_RPC_CHANNEL,
  installInterfaceLanguageMirror,
} from './interface-language.js';
import { BotSettingsContext } from './channel-card-meta.js';
import {
  DELIVERY_RPC_CHANNEL,
  DeliveryTargetSettingsPage,
} from './delivery-settings.js';
import {
  GLOBAL_SETTINGS_RPC_CHANNEL,
  GLOBAL_SETTINGS_TAB_ID,
  GlobalSettingsLogoGlyph,
  GlobalSettingsPanel,
} from './global-settings.js';
import {
  createLoopbackAwareRpcCalls,
  replacePageLocation,
} from './loopback-recovery.js';
import { installImStyles } from './styles.js';
import { installSessionChannelLogos } from './session-channel-logos.js';
import { UpdatePanel, UPDATE_RPC_CHANNEL } from './update-panel.js';
import { WorkspaceDirectoryPickerContext } from './workspace-editor.js';
import { IMPanelErrorBoundary } from './panel-error-boundary.js';
import { installImPluginPage } from './plugin-page.js';

export const name = 'im-settings';
export const inject = ['slots', 'connection', 'locale', 'workspaces'];
export const IM_PLUGIN_VERSION = manifest.version;

function callWorkspaceDirectoryApi(ctx, method, ...args) {
  // Current 哪吒 Agent owns directory operations on uiWorkspace; legacy Hosts keep them on workspaces.
  const uiWorkspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined;
  const service = typeof uiWorkspace?.[method] === 'function' ? uiWorkspace : ctx.workspaces;
  if (typeof service?.[method] !== 'function') {
    throw new Error('无法读取目录，请重试。');
  }
  return service[method](...args);
}

// Only domestic IM and office extensions have settings entries. Legacy RPC
// callers remain compatible with embedded clients and existing Host services.
const CHANNELS = Object.freeze([
  { id: 'weixin', label: '微信', description: '在微信私聊中向哪吒 Agent 发起任务。' },
  { id: 'feishu', label: '飞书', description: '在飞书私聊和群聊中，与哪吒 Agent 协作。' },
  { id: 'dingtalk', label: '钉钉', description: '把哪吒 Agent 带入钉钉，随时处理工作任务。' },
  { id: 'wecom', label: '企业微信', description: '通过企业微信机器人连接团队与哪吒 Agent。' },
  { id: 'qq', label: 'QQ', description: '在 QQ 私聊和群聊中使用哪吒 Agent。' },
  { id: 'wecomApp', label: '企业微信应用', note: '实验功能', extended: true, description: '通过企业自建应用接入，适合有应用管理权限的团队。' },
  { id: 'email', label: '邮箱', note: '实验功能', extended: true, description: '用邮件提交任务，并通过回信接收处理结果。' },
  { id: 'office', label: 'AI Office', note: '实验功能', extended: true, description: '连接办公系统，配置任务接收与结果回传。' },
]);

function WeixinLogo() {
  return h('span', { className: 'dim-logo dim-logoWeixin', 'aria-hidden': 'true' },
    h(WeixinLogoGlyph));
}

function FeishuLogo() {
  return h('span', { className: 'dim-logo dim-logoFeishu', 'aria-hidden': 'true' },
    h(FeishuLogoGlyph));
}

function DingtalkLogo() {
  return h('span', { className: 'dim-logo dim-logoDingtalk', 'aria-hidden': 'true' },
    h(DingtalkLogoGlyph));
}

function QqLogo() {
  return h('span', { className: 'dim-logo dim-logoQq', 'aria-hidden': 'true' }, h(QqLogoGlyph));
}

function WecomLogo() {
  return h('span', { className: 'dim-logo dim-logoWecom', 'aria-hidden': 'true' }, h(WecomLogoGlyph));
}

function WecomAppLogo() {
  return h('span', { className: 'dim-logo dim-logoWecomApp', 'aria-hidden': 'true' }, h(WecomLogoGlyph));
}

function EmailLogo() {
  return h('span', { className: 'dim-logo dim-logoEmail', 'aria-hidden': 'true' },
    h(EmailLogoGlyph));
}

function OfficeLogo() {
  return h('span', { className: 'dim-logo dim-logoOffice', 'aria-hidden': 'true' },
    h(OfficeLogoGlyph));
}

function ChannelLogo({ channel }) {
  if (channel === 'weixin') return h(WeixinLogo);
  if (channel === 'feishu') return h(FeishuLogo);
  if (channel === 'dingtalk') return h(DingtalkLogo);
  if (channel === 'wecom') return h(WecomLogo);
  if (channel === 'wecomApp') return h(WecomAppLogo);
  if (channel === 'qq') return h(QqLogo);
  if (channel === 'email') return h(EmailLogo);
  return h(OfficeLogo);
}

export function LoopbackRecoveryNotice({ recovery, onNavigate = replacePageLocation }) {
  return h('div', {
    className: 'dim-loopbackRecovery',
    role: 'alert',
  },
  h('div', { className: 'dim-loopbackRecoveryCopy' },
    h('strong', null, '请改用 localhost 重新打开'),
    h('p', null, '页面会在当前端口重新打开，机器人配置不会改变。'),
    h('code', null, recovery.origin)),
  h('button', {
    type: 'button',
    className: 'dim-loopbackRecoveryAction',
    onClick: () => onNavigate(recovery.url),
  }, '使用 localhost 重新打开'));
}

export function IMSettingsTab({
  dingtalkRpcCall,
  discordRpcCall,
  feishuRpcCall,
  imessageRpcCall,
  emailRpcCall,
  matrixRpcCall,
  qqRpcCall,
  slackRpcCall,
  telegramRpcCall,
  wecomRpcCall,
  wecomAppRpcCall,
  weixinRpcCall,
  whatsappRpcCall,
  officeRpcCall,
  updateRpcCall,
  deliveryRpcCall,
  globalSettingsRpcCall,
  workspaceDirectoryPicker,
  preferredSectionId,
  browserLocation = globalThis.location,
  navigateToRecoveryUrl = replacePageLocation,
}) {
  const [selected, setSelected] = React.useState(() => (
    preferredSectionId === GLOBAL_SETTINGS_TAB_ID
      || CHANNELS.some((channel) => channel.id === preferredSectionId)
      ? preferredSectionId : 'weixin'
  ));
  const [loopbackRecovery, setLoopbackRecovery] = React.useState(null);
  // The brand line shows the Host (harness) version and falls back to v0.0.1
  // until an update snapshot confirms the running Host identity.
  const [hostVersion, setHostVersion] = React.useState(null);
  const [deliverySettings, setDeliverySettings] = React.useState(null);
  // The Host owns email availability and reports it over RPC. The
  // mailbox entry point is omitted entirely while it is closed, and the visible
  // channel list is what every later lookup (active tab, rail) reads from.
  const emailEnabled = useEmailChannelEnabled(emailRpcCall);
  const visibleChannels = React.useMemo(
    () => CHANNELS.filter((channel) => channel.id !== 'email' || emailEnabled),
    [emailEnabled],
  );
  const generalSettingsTooltipId = React.useId();
  const globalSettingsSelected = selected === GLOBAL_SETTINGS_TAB_ID;
  const active = visibleChannels.find((channel) => channel.id === selected) ?? visibleChannels[0];
  const activeTabId = globalSettingsSelected
    ? 'dim-general-settings-trigger'
    : `dim-tab-${active.id}`;
  const activePanelId = globalSettingsSelected
    ? `dim-panel-${GLOBAL_SETTINGS_TAB_ID}`
    : `dim-panel-${active.id}`;
  const reportLoopbackRecovery = React.useCallback((recovery) => {
    setLoopbackRecovery((current) => current?.url === recovery.url ? current : recovery);
  }, []);
  const reportUpdateStatus = React.useCallback((snapshot) => {
    setHostVersion(typeof snapshot.hostVersion === 'string' ? snapshot.hostVersion : null);
  }, []);
  const railRef = React.useRef(null);
  const selectChannel = React.useCallback((channelId) => {
    setSelected(channelId);
    setDeliverySettings(null);
  }, []);
  const handleChannelKeyDown = React.useCallback((event, channelId) => {
    const currentIndex = visibleChannels.findIndex((channel) => channel.id === channelId);
    if (currentIndex < 0) return;
    let nextIndex;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = currentIndex + 1;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = currentIndex - 1;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = visibleChannels.length - 1;
    else return;
    event.preventDefault();
    const nextChannel = visibleChannels[(nextIndex + visibleChannels.length) % visibleChannels.length];
    selectChannel(nextChannel.id);
    railRef.current?.querySelector(`[id="dim-tab-${nextChannel.id}"]`)?.focus();
  }, [selectChannel, visibleChannels]);
  const rpcCalls = React.useMemo(() => createLoopbackAwareRpcCalls({
    dingtalkRpcCall,
    discordRpcCall,
    feishuRpcCall,
    qqRpcCall,
    slackRpcCall,
    telegramRpcCall,
    wecomRpcCall,
    wecomAppRpcCall,
    weixinRpcCall,
    whatsappRpcCall,
    officeRpcCall,
    updateRpcCall,
    deliveryRpcCall,
    globalSettingsRpcCall,
    imessageRpcCall,
    emailRpcCall,
    matrixRpcCall,
  }, {
    location: browserLocation,
    onRecovery: reportLoopbackRecovery,
  }), [
    browserLocation,
    dingtalkRpcCall,
    discordRpcCall,
    deliveryRpcCall,
    feishuRpcCall,
    globalSettingsRpcCall,
    imessageRpcCall,
    emailRpcCall,
    matrixRpcCall,
    officeRpcCall,
    qqRpcCall,
    reportLoopbackRecovery,
    slackRpcCall,
    telegramRpcCall,
    updateRpcCall,
    wecomRpcCall,
    wecomAppRpcCall,
    weixinRpcCall,
    whatsappRpcCall,
  ]);
  const botSettingsContext = React.useMemo(() => Object.freeze({
    openBotSettings: setDeliverySettings,
  }), []);
  return h(WorkspaceDirectoryPickerContext.Provider, { value: workspaceDirectoryPicker },
    h('section', { className: 'dim-page', 'aria-label': 'IM机器人设置' },
    h('header', { className: 'dim-title' },
      h('div', { className: 'dim-brand' },
        h('div', { className: 'dim-brandHeading' },
          h('strong', { className: 'dim-brandName' }, 'sensteed-im'),
          h('span', { className: 'dim-brandVersion' }, `v${hostVersion ?? '0.0.1'}`)),
        h('p', null, '把哪吒 Agent 接入常用消息平台')),
      h('div', { className: 'dim-titleActions' },
        h(UpdatePanel, {
          rpcCall: rpcCalls.updateRpcCall,
          clientVersion: IM_PLUGIN_VERSION,
          onStatus: reportUpdateStatus,
        }),
      h('span', { className: 'dim-generalSettingsAction' },
        h('button', {
          type: 'button',
          id: 'dim-general-settings-trigger',
          className: 'dim-generalSettingsButton',
          'aria-label': '通用设置',
          'aria-describedby': generalSettingsTooltipId,
          'aria-controls': `dim-panel-${GLOBAL_SETTINGS_TAB_ID}`,
          'aria-current': globalSettingsSelected ? 'page' : undefined,
          onClick: () => {
            setSelected(GLOBAL_SETTINGS_TAB_ID);
            setDeliverySettings(null);
          },
        }, h(GlobalSettingsLogoGlyph, { size: 17 }), h('span', null, '通用设置')),
        h('span', {
          id: generalSettingsTooltipId,
          className: 'dim-generalSettingsTooltip',
          role: 'tooltip',
        }, '通用设置'))),
    ),
    h('div', { className: 'dim-layout' },
      h('nav', { ref: railRef, className: 'dim-rail', role: 'tablist', 'aria-label': 'IM 设置导航' },
        visibleChannels.map((channel, index) => h(React.Fragment, { key: channel.id },
          index === 0 || channel.extended && !visibleChannels[index - 1]?.extended
            ? h('div', { className: 'dim-railHeading', role: 'presentation' }, channel.extended ? '扩展接入' : '常用 IM')
            : null,
          h('button', {
          key: channel.id,
          type: 'button',
          role: 'tab',
          id: `dim-tab-${channel.id}`,
          className: 'dim-channel',
          'aria-selected': !globalSettingsSelected && channel.id === active.id,
          'aria-controls': `dim-panel-${channel.id}`,
          tabIndex: channel.id === active.id ? 0 : -1,
          onClick: () => selectChannel(channel.id),
          onKeyDown: (event) => handleChannelKeyDown(event, channel.id),
        },
        h(ChannelLogo, { channel: channel.id }),
        h('span', { className: 'dim-channelCopy' },
          h('strong', null, channel.label),
          channel.note ? h('small', { className: 'dim-channelNote' }, channel.note) : null,
        ))))),
      h('div', { className: 'dim-divider', 'aria-hidden': 'true' }),
      h('main', {
        className: 'dim-panel',
        role: 'tabpanel',
        id: activePanelId,
        'aria-labelledby': activeTabId,
        tabIndex: 0,
      },
      !globalSettingsSelected && !deliverySettings ? h('header', { className: 'dim-panelHeading' },
        h(ChannelLogo, { channel: active.id }),
        h('div', { className: 'dim-panelHeadingCopy' },
          h('div', { className: 'dim-panelHeadingTitle' },
            h('h2', null, active.label),
            active.note ? h('span', { className: 'dim-experimentalBadge' }, active.note) : null),
          h('p', null, active.description))) : null,
      loopbackRecovery
        ? h(LoopbackRecoveryNotice, {
            recovery: loopbackRecovery,
            onNavigate: navigateToRecoveryUrl,
          })
        : null,
      h(BotSettingsContext.Provider, { value: botSettingsContext },
        globalSettingsSelected
          ? h(GlobalSettingsPanel, { rpcCall: rpcCalls.globalSettingsRpcCall })
          : deliverySettings?.channel === active.id
          ? h(DeliveryTargetSettingsPage, {
              channel: active.id,
              account: deliverySettings,
              rpcCall: rpcCalls.deliveryRpcCall,
              accessRpcCall: rpcCalls[`${active.id}RpcCall`],
              onBack: () => setDeliverySettings(null),
            })
          : active.id === 'weixin'
            ? h(WeixinSettingsTab, { rpcCall: rpcCalls.weixinRpcCall })
            : active.id === 'feishu'
              ? h(FeishuSettingsTab, { rpcCall: rpcCalls.feishuRpcCall })
              : active.id === 'dingtalk'
                ? h(DingtalkSettingsTab, { rpcCall: rpcCalls.dingtalkRpcCall })
                : active.id === 'wecom'
                  ? h(WecomSettingsTab, { rpcCall: rpcCalls.wecomRpcCall })
                : active.id === 'wecomApp'
                  ? h(WecomAppSettingsTab, { rpcCall: rpcCalls.wecomAppRpcCall })
                  : active.id === 'qq'
                    ? h(QqSettingsTab, { rpcCall: rpcCalls.qqRpcCall })
                    : active.id === 'email'
                      ? h(EmailSettingsTab, { rpcCall: rpcCalls.emailRpcCall })
                      : h(OfficeSettingsTab, { rpcCall: rpcCalls.officeRpcCall }))),
    ),
  ));
}

export function apply(ctx) {
  ctx.effect(
    () => ctx.locale.register(IM_LOCALE_NAMESPACE, { zh, en }),
    'im-settings: bilingual dictionaries',
  );
  const t = ctx.locale.bind(IM_LOCALE_NAMESPACE);
  setImTranslator(t);

  // The settings page is the only place that knows the locale the interface is
  // actually rendered in: 哪吒 Agent stores nothing when it came from the browser's
  // language list. Report it so bot messages follow the same language.
  ctx.effect(
    () => installInterfaceLanguageMirror(ctx, {
      rpcCall: (endpoint, payload, signal) =>
        callManagementRpc(ctx.connection, HOST_LANGUAGE_RPC_CHANNEL, endpoint, payload, signal),
    }),
    'im-settings: mirror the 哪吒 Agent interface language',
  );

  ctx.effect(() => installSessionChannelLogos(), 'im-settings: Session channel logos');

  ctx.effect(() => {
    const disposers = [
      installFeishuStyles(),
      installWeixinStyles(),
      installWecomStyles(),
      installWecomAppStyles(),
      installQqStyles(),
      installEmailStyles(),
      installOfficeStyles(),
      installImStyles(),
    ];
    return () => {
      for (const dispose of disposers.reverse()) dispose();
    };
  }, 'im-settings: install combined channel styles');

  const feishuRpcCall = (endpoint, payload, signal) =>
    callManagementRpc(ctx.connection, FEISHU_RPC_CHANNEL, endpoint, payload, signal);
  const weixinRpcCall = (endpoint, payload, signal) =>
    callManagementRpc(ctx.connection, WEIXIN_RPC_CHANNEL, endpoint, payload, signal);
  const dingtalkRpcCall = (endpoint, payload, signal) =>
    callManagementRpc(ctx.connection, DINGTALK_RPC_CHANNEL, endpoint, payload, signal);
  const qqRpcCall = (endpoint, payload, signal) =>
    callManagementRpc(ctx.connection, QQ_RPC_CHANNEL, endpoint, payload, signal);
  const wecomRpcCall = (endpoint, payload, signal) =>
    callManagementRpc(ctx.connection, WECOM_RPC_CHANNEL, endpoint, payload, signal);
  const wecomAppRpcCall = (endpoint, payload, signal) =>
    callManagementRpc(ctx.connection, WECOM_APP_RPC_CHANNEL, endpoint, payload, signal);
  const telegramRpcCall = (endpoint, payload, signal) =>
    callManagementRpc(ctx.connection, TELEGRAM_RPC_CHANNEL, endpoint, payload, signal);
  const discordRpcCall = (endpoint, payload, signal) =>
    callManagementRpc(ctx.connection, DISCORD_RPC_CHANNEL, endpoint, payload, signal);
  const whatsappRpcCall = (endpoint, payload, signal) =>
    callManagementRpc(ctx.connection, WHATSAPP_RPC_CHANNEL, endpoint, payload, signal);
  const imessageRpcCall = (endpoint, payload, signal) =>
    callManagementRpc(ctx.connection, IMESSAGE_RPC_CHANNEL, endpoint, payload, signal);
  const emailRpcCall = (endpoint, payload, signal) =>
    callManagementRpc(ctx.connection, EMAIL_RPC_CHANNEL, endpoint, payload, signal);
  const matrixRpcCall = (endpoint, payload, signal) =>
    callManagementRpc(ctx.connection, MATRIX_RPC_CHANNEL, endpoint, payload, signal);
  const slackRpcCall = (endpoint, payload, signal) =>
    callManagementRpc(ctx.connection, SLACK_RPC_CHANNEL, endpoint, payload, signal);
  const officeRpcCall = (endpoint, payload, signal) =>
    callManagementRpc(ctx.connection, OFFICE_RPC_CHANNEL, endpoint, payload, signal);
  const updateRpcCall = (endpoint, payload, signal) =>
    callManagementRpc(ctx.connection, UPDATE_RPC_CHANNEL, endpoint, payload, signal);
  const deliveryRpcCall = (endpoint, payload, signal) =>
    callManagementRpc(ctx.connection, DELIVERY_RPC_CHANNEL, endpoint, payload, signal);
  const globalSettingsRpcCall = (endpoint, payload, signal) =>
    callManagementRpc(ctx.connection, GLOBAL_SETTINGS_RPC_CHANNEL, endpoint, payload, signal);
  const workspaceDirectoryPicker = Object.freeze({
    listDirectory: (path, signal) =>
      callWorkspaceDirectoryApi(ctx, 'listDirectory', path, signal),
    pickDirectory: () => callWorkspaceDirectoryApi(ctx, 'pickDirectory'),
  });

  const panelDependencies = {
    dingtalkRpcCall,
    discordRpcCall,
    feishuRpcCall,
    qqRpcCall,
    slackRpcCall,
    telegramRpcCall,
    wecomRpcCall,
    wecomAppRpcCall,
    weixinRpcCall,
    whatsappRpcCall,
    imessageRpcCall,
    officeRpcCall,
    emailRpcCall,
    matrixRpcCall,
    updateRpcCall,
    deliveryRpcCall,
    globalSettingsRpcCall,
    workspaceDirectoryPicker,
  };
  const subscribeLocale = (listener) => typeof ctx.on === 'function'
    ? ctx.on('locale/change', listener) : () => {};
  const localeSnapshot = () => ctx.locale.getLocale?.()?.active ?? '';

  // Stable for this plugin lifetime: creating an element must not create a
  // new component type and reset the reader's selected tab or unsaved input.
  function IMPanel({ preferredSectionId }) {
    React.useSyncExternalStore(subscribeLocale, localeSnapshot, localeSnapshot);
    return h(IMPanelErrorBoundary, null,
      h(IMSettingsTab, { ...panelDependencies, preferredSectionId }));
  }
  const buildPanelElement = (props = {}) => h(IMPanel, {
    preferredSectionId: props.preferredSectionId,
  });

  installImPluginPage(ctx, { packageName: manifest.name, renderPanel: buildPanelElement });

  ctx.effect(() => {
    let disposed = false;
    let stopSettings = null;
    let registered = false;
    const setSettingsVisible = (visible) => {
      if (disposed) return;
      if (typeof visible !== 'boolean') throw new TypeError('visible must be a boolean');
      if (visible === (stopSettings !== null)) return;
      if (!visible) {
        const stop = stopSettings;
        stopSettings = null;
        stop();
        return;
      }
      // The existing slot controller owns late declarations, withdrawal and
      // re-declaration. Cancelling it also cancels a pending registration.
      stopSettings = ctx.slots.inject('settings.section', () => {
        const unregister = ctx.slots.register({
          name: 'settings.section',
          id: 'sensteed-im',
          order: 21,
          label: () => t('IM机器人'),
          locale: IM_LOCALE_NAMESPACE,
          inject: () => panelDependencies,
        }, buildPanelElement);
        registered = true;
        return () => {
          registered = false;
          unregister();
        };
      });
    };

    // Publish only after the default registration is established, so a
    // consumer hiding it during service discovery cannot be overridden.
    setSettingsVisible(true);
    if (typeof ctx.provide === 'function') {
      ctx.provide('dshImClient', Object.freeze({
        version: 1,
        render: (props) => disposed ? null : buildPanelElement(props),
        setSettingsVisible,
        settingsVisible: () => !disposed && registered,
      }));
    }
    return () => {
      disposed = true;
      const stop = stopSettings;
      stopSettings = null;
      registered = false;
      stop?.();
    };
  }, 'im-settings: client panel service');
}
