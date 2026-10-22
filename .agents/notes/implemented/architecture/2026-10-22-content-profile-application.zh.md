# Agent Note：内容 Profile 应用归属

状态：源码已实现；安装版与生产验收待完成

[English](2026-10-22-content-profile-application.md) | 中文

## 背景与决策

内容 Profile 是运行环境 Profile 内保存的期望内容集合，不提供账号、会话或工作区隔离。模板决定初始组合，之后的目录编辑属于该内容 Profile。创建入口位于企业技能目录，自定义组装复用既有目录勾选流程。

实例化只登记期望内容，应用沿用签名 generation 的 preview → execute → restart，取代最初四步 overlay 方案。切换不自动删除上一个 Profile 的安装内容；登记成功不能显示为健康激活。

## 权威与持久化

`ContentProfileStore` 分别保存登记、应用事务和最近健康选择。版本 1 文件采用增量迁移；整个读取、修改、写入持有文件锁，损坏状态拒绝使用并保留原文件。Host 在安装维护锁、选择锁内串行变更，等待持久化，未完成 generation 或强制更新阻断期间拒绝变更。渲染端 create、set-active、mark-applied 旁路被拒绝。

staging 前持久绑定内容 Profile id、selection digest、operation id、签名 plan digest、generation digest 和身份 scope。只有 Host 在 ACTIVATED 已确认且当前 managed 内容匹配后才能完成应用。启动和状态恢复会协调 staging 中断、失败回执及激活成功，不依赖页面保持打开。释放时等待恢复任务、排队变更和持久化结束。

Hub 保存精确不可变 release id、版本和启用位。显式空选择除 required 内容外保持为空；完整目录发现允许后续编辑，不重新加入无关 optional defaults。显式重选覆盖删除 tombstone，required、授权、依赖闭包及精确 target proof 仍须满足。

健康激活后，Host 通过 `POST /skillhub/v1/generations/selection` 登记精确操作选择。Hub 从已授权、已消费且 ACTIVATED 回执已确认的操作推导集合，拒绝 COMMITTED、已回滚和他人操作。Host 再与签名计划核对响应。以后回切恢复此选择，保留编辑及 MCP 条目，不用出生模板覆盖；历史操作登记不授予旧 execute 或 boot 权限。

## MCP 与界面

Host 只通过 `hubMcp.applyProfileEndpoints` 应用公共 MCP 的 service/domain/version/enabled 符号引用。路由投影、产品权益、用户偏好、业务 ACL 和凭据继续保有权威。插件和 Profile 请求共用单连接所有权，停止失败阻止替换。应用成功表示 Host 配置完成，不保证远端 MCP 服务在线。

切换器区分已应用与已登记/待应用，打开、事件和轮询时刷新。模板预览绑定当前修订，失败可重试，名称默认填写；新增跳转技能目录。加载、错误和键盘导航都有明确行为。

## Next 接入

普通 Next 保留官方前端与上游 `runProfile` 路径。封存安装版显式传入 `--enterprise-content` 后，使用固定安装 bundles、共享企业 Host 服务和 Next 自有监督器；此组合排除任意 Profile overlay 与普通安装器。开发目录不能制造 target。

启动器重新计算 app.asar/unpacked build 身份，监督子进程停止和替换，忽略旧子进程请求，获取新的 boot 授权，并要求当前文档 nonce 健康信号和实际加载证据。失败经 base Host 回滚。维护锁覆盖更新、generation 与 Profile 变更。退出前持久记录安装器交接，只有已验证目标 build 或 `--cancel-enterprise-update` 显式取消恢复才解除屏障。Next 保留原有更新传输，Models v2 制品支持不属于此次改动。

## 证据与剩余验收

回归覆盖持久化失败、并发登记、精确版本和启用位、空选择、MCP 所有权、应用回执恢复、操作选择回切、Next 组合与监督、旧子进程消息、文档 nonce 和更新维护。真实无头 Chrome 检查覆盖模板创建、待应用状态、portal 导航和键盘操作。根 `pnpm check` 是完整源码门禁；Hub API/contracts 定向测试另覆盖真实数据库的选择行为。

上述检查不构成可信 target proof、签名包发布、平台安装器验收、生产部署或采用率/成功率/耗时指标实测。后者须在 tagged 安装版通过真实已授权 Hub 流程验收。Hub 独立全量质量门目前仍报告 43 项既有前端国际化问题，相关 API、contracts 与模板门禁通过。
