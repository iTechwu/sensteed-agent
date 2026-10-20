# Host MCP 注册冲突审查

## 结论与证据

`supply-chain`、`finance` 的 `serverName already in use` 来自两个传输所有者：旧 `dofe-managed` 直接创建客户端，供应链、财务插件又向 `hubMcp` 声明同名客户端。Tools 的十二条路由也有相同重叠。Harness 的同名保护正常工作，不应放宽它或给重复客户端改名来绕过检查。

本机 2026-10-20 的 Host 历史日志确认了这两种名称的冲突。源码还存在两条放大链路：

- Host 每 60 秒核验权限时先销毁所有客户端，再重建；失败注册因而持续重试，并让正常连接和权限状态反复变化。
- SSO 续期会重新保存 Models key；即使值相同也会发出凭据更新事件。非财务路由的旧签名又包含未使用的 SSO token，导致额外重连。

联合回归以真实 Cordis 加载离线快照里的财务、供应链、Tools 插件，仅用无网络传输模拟 Harness 的名称占用与释放。对隔离的原始 `dofe-managed` 运行，两种加载顺序均失败，捕获 `finance`、`supply-chain`、`tools-*` 重复注册；修复后两种顺序均通过。

## 传输归属

| 路由 | 声明方 | 传输所有者 |
| --- | --- | --- |
| `finance` | 财务插件 | Host `hubMcp` |
| `supply-chain` | 供应链情报插件 | Host `hubMcp` |
| 十二条 `tools-*` | Tools 插件 | Host `hubMcp` |
| `video-processing` | 视频笔记插件 | Host `hubMcp` |
| `knowledge`、`openmontage`、`media` | 产品内置路由 | `dofe-managed` |

旧 managed 不再请求财务权限，其系统提示读取 Host 的实时 `dofeAccess`。业务插件源文件和 `.ci` 快照的声明无需修改；本次修复属于产品 Host 层。

## 生命周期约束

- 合并同批注册及设置通知；轮询继续请求财务权限，但不重建签名相同的客户端，不将已授权状态每分钟先置为拒绝。
- Models key 实际改变才轮换相关连接；SSO bearer 改变只轮换使用该 bearer 的 finance。身份、租户或本地授权失效仍撤销相应连接。
- 财务权限拒绝、响应异常和超时均关闭财务 gate 并停止 finance，不影响供应链和其他路由。慢财务检查不阻塞其他路由；取消或过期结果不能重新授权。
- 保留 Cordis 启动时立即返回的可销毁 handle；停止中的 Promise 由调用方共享，待旧名称释放后才能创建替代连接。清理失败则保留名称，阻止再次注册。
- 注销幂等；旧 registration 不可删除新 registration；Host 关闭时停止定时器并取消检查，迟到的启动或请求不能复活客户端。
- 名称校验与 Harness 的 32 字符上限一致，finance 名称和路径均保留给财务能力。错误日志只包含固定文案和已校验名称，不输出外部异常或凭据。

## 验证范围

Host 单元回归覆盖稳定轮询、注册合并、同值凭据通知、凭据轮换、权限拒绝与失败、慢请求取消、启动中关停、异步注销和清理失败。联合回归验证两种加载顺序、连续三个 60 秒周期、十四条业务路由单活，以及卸载后名称全部释放。

`corepack pnpm --filter @dofe/dsh-sensteed-product check` 已通过品牌校验、构建、类型检查和 57 个文件的 363 项测试，`corepack pnpm check:layout` 通过。SSO 回环登录测试需要允许监听本地端口，使用无 GUI 的沙箱外检查。未重新打包、安装或重启本机应用；历史日志用于定位，不作为已安装版本修复后的运行证据。
