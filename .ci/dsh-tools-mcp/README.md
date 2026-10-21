# Tools 能力展示与发现契约

通用业务 Agent 使用现有 `tools-platform` 连接，依次调用
`business_service_categories_list`、`business_tools_search`、
`business_tool_contract_get`。分类、服务组、输入 schema、成本和可用条件由
Tools 的本地注册目录提供；本插件只给导航，不复制逐工具契约。

搜索已有事实时可传 `externalCallsAllowed=false`、`chargeAllowed=false`；
先从类别目录的 `facets` 读取当前支持的维度和值，再组合 `domain`、
`dataSourcePolicy`、`modelUsage`、`businessPersistence`、`controlPersistence`、
`executionMode`、`policyReview`、`outputContractStatus`。所有条件取交集，
精确 `externalCallPolicy` / `costPolicy` 与两个布尔限制同时生效。
例如只查数据库且不调模型/不写业务状态，可加 `dataSourcePolicy=database`、
`modelUsage=never`、`businessPersistence=none`；要求无控制状态写入再加
`controlPersistence=none`。后者单独区分审计、收据与计划绑定。
异步模型分析入口可用 `modelUsage=possible` + `executionMode=async`；
分析结果读取工具仍独立筛选。`facets` 统计分页前全部命中集，保留 unknown
和零数量值；空结果不自动放宽筛选。旧版目录须先核对搜索的输入 schema，
不向尚不支持新参数的部署发送这些参数。

未知政策不能当作免费。只读动作可能访问外部或计费，写动作的确认、幂等与
版本字段按实际 schema 传入。目录读取为零业务外呼，注册成功不代表部署、
设备、身份或 worker 条件已经满足。旧 Tools 未发布新目录时回退 `tools/list`
和已存在的领域能力目录，不猜测新工具参数。

`package.json` 的 `dsh.capabilities` 与 `index.js` 的 `capabilities` 保持一致，
是保留的授权词汇（11 个旧 capability ID 不动）。`capability-views.json` 为
version 2：38 张服务组级卡片，来自 Tools 仓
`scripts/export_service_catalog_snapshot.py` 导出的
`service-catalog.snapshot.json`（8 分类 / 43 服务组 / 235 工具，含逐工具政策
元数据）。排除 `video-processing` 域的 5 个服务组（视频笔记插件独占）；每张
卡以 `tools-svc-` + 服务组 id 命名，携带 `categoryId`/`serviceId`/`servers`/
`tools`，并用 `legacyCapabilities` 回链旧 capability ID。这些桌面入口不是
服务端 8 类 taxonomy 的第二副本；Tools 分类更新后按以下顺序刷新：

1. tools 仓提交目录变更并重跑 `export_service_catalog_snapshot.py`（`--check` 守漂移）；
2. 拷贝快照进本目录，按需更新 `capability-views.json` 的名称/描述/分组；
3. 桌面仓 `sync-dofe-plugin-snapshot.mjs --write dsh-tools-mcp` 与
   `generate-tool-views.mjs` 重新生成派生视图并提交。

`scripts/test_mcp_discovery.py` 的 `PluginCatalogSnapshotTests` 离线校验
快照、视图与网关注册表三方一致性；快照源新鲜度由 tools 仓 `--check` 负责。
快照保留全部持久化/来源/审核政策、确认/幂等/版本要求、输出类型状态与
`facets`，不包含业务记录或凭据。既有路由门禁会校验逐工具政策与维度计数。
跨仓比对应检查完整内容，不能只比较 `catalogVersion`：

```bash
python3 scripts/mcp_route_contract.py --tools-service-snapshot ../tools.dofe.ai/docs/superpowers/catalogs/service-catalog-snapshot.json
../tools.dofe.ai/.venv/bin/python scripts/check_tools_discovery_inprocess.py --tools-root ../tools.dofe.ai
```

公开发现验收仍只调用三个目录工具；搜索调用携带多维交集，校验返回政策、
字段 schema 与统计总数。Tools 兼容版本发布后再启用 `MCP_VERIFY_TOOLS_DISCOVERY=1`；
新增字段缺失或条件不生效会拒绝通过，不能拿业务采集做探活。

客户端只通过 Host `hubMcp` 注册 allowlist 路径，Host 从凭据系统取得 Models
身份并连接 `https://ai.hozonauto.com/mcp`。Tools 返回的 `endpointRef` 使用
服务和规范域名，由网关注册表的
[`public-mcp-routes.json`](../../runtime/mcp-gateway/public-mcp-routes.json) 解析；
其中 `xhs_operation` / `douyin_operation` 对应公网短横线路径。
`video-processing` 仍由 `dsh-sensteed-video-notes` 注册，不在本插件重复激活。
没有相应客户端连接时报告缺少接入，不直连内部上游。

分类视图不创建安装包、授权项或独立开关；仍受 `tools` 包级授权与启用状态
控制。公开供应商事实不因客户端携带 tenant 自动分割，个人/团队业务状态仍
由服务端执行归属校验。正式线索池与人才 collectionRef 的语义由 Tools 持有。

本地验证：`node --test plugins/dsh-tools-mcp/test/*.test.mjs`。
更新客户端后，在桌面仓运行 `sync-dofe-plugin-snapshot.mjs --write dsh-tools-mcp`
与 `generate-tool-views.mjs`，提交源码、快照和派生视图。桌面布局和样式由产品仓
拥有；Hub 发布另走正式签名流程。此仓提交不表示桌面快照、Hub 发布或线上
Tools 已更新。
