# 业务上下文导航契约 v1

状态：三个真实业务插件已接入；实现源位于 `../docker-helm.dofe.ai/plugins`。桌面仅拥有布局，插件继续拥有业务路由、权限和数据。

## 插槽

桌面自有侧栏声明 `desktop.navigation.context`，kind 为 keyed，scope 为 root，entryKey 等于真实主面板 key：

| 插件 | main / context key | 实际目录 |
| --- | --- | --- |
| 供应链管理 | supplier-risk | 风险总览、供应商台账、工商与司法、媒体舆情、业务影响、风险周报 |
| 财务管理 | sensteed-finance | 复用 FINANCE_NAVIGATION 的分组与权限过滤，含预算、资金、经营、审核等实际页面 |
| 知识与记忆 | sensteed-knowledge | 总览、Memory 召回/采集、知识管理、管理控制台、知识图谱、本体、断言与溯源 |

插件仅在插槽可用时注册上下文组件。compatibility 不声明该插槽，独立插件继续使用原页面导航。未适配插件仍显示原入口和返回主页，不能因为不支持新接口而失效。

Owner props：

```ts
interface BusinessNavigationOwnerProps {
  onAccessDenied(): void
  registerLeaveGuard(guard: (continueNavigation: () => void) => void): () => void
}
```

- 插件服务端确认失权后调用 `onAccessDenied`，回退不走未保存确认，防止继续展示无权页面。
- 财务把既有 dirty/busy guard 接入 `registerLeaveGuard`；侧栏主模块和业务扩展入口均通过该 guard。取消保留原页面，确认后才继续切换；后台权限失效直接清理。
- Context 组件订阅插件内部桥接状态，菜单只包含 `id`、`label`、可选 `group` 和 `activeId`，不把账户、凭据或业务记录交给桌面。
- 路由动作直接调用插件现有处理函数；财务目录逐项调用 `financeNavigationAllowed`，不通过 DOM 查找 tab，不生成模拟采购或财务路由。

## 状态与身份边界

同身份模块切换保留最近页面。供应链沿用按 scope 的筛选/选择记忆；财务保留路由参数、年份、机构筛选和视图状态；知识保留最近分类。没有跨身份复用路由或业务结果。

产品设置中的主体、认证模式或组变化触发无 payload 的 `sensteed:identity-changed`。插件收到后清空路由/描述符、取消旧请求并回主页。事件不携带用户 ID、tenant、token 或账号明文。

宿主 access 响应附带随机 `scopeId` 回执；finance/knowledge 不返回凭据指纹。scope 改变会重置桥接 epoch 并取消旧请求。数据请求使用当前 epoch 和 AbortSignal，旧响应不能覆盖新身份状态。已失权的 bridge 拒绝旧组件重新 publish，只有新的服务端允许响应才能恢复。

导航恢复只保存 UI 状态，不保存接口数据，不保存未提交表单。取消客户端请求不意味着已经提交的服务端操作被撤回，服务端鉴权仍是最终边界。

## 构建与验证

共享源 `plugins/desktop-navigation/client.js` 由同步脚本派生到三个插件各自的 `src/desktop-navigation.js`，并由本插件 build 内联，避免 CI 快照依赖外部 shared 目录。桥接测试校验派生文件逐字一致。

桌面 `.ci` 快照只通过 `scripts/sync-dofe-plugin-snapshot.mjs --write <plugin>` 生成。不能直接编辑快照修复行为。运行时本地依赖继续指向 sibling。

验证入口：

- 插件仓：`node --test plugins/desktop-navigation/bridge.test.mjs`，以及三个插件自己的 `npm run check`。
- 桌面仓：`corepack pnpm check`。
- 浏览器联调：`corepack pnpm --filter dsh-plugin-desktop exec node scripts/verify-business-navigation-browser.mjs`；可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定本地 Chrome。该入口使用实际插件 lib 和实际 React 侧栏组件，业务 HTTP 响应由隔离 fixture 提供，不连接生产。

真实企业账号权限矩阵、平台实机、SUS 和用户树测试仍需单独执行，不能用 fixture 结果代替。
