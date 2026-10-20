# Tools 能力展示契约

`package.json` 的 `dsh.capabilities` 与 `index.js` 的 `capabilities` 声明相同的业务能力。`capability-views.json` 将这些能力关联到本插件已注册的连接；桌面生成分类视图时读取该文件和声明，完整覆盖所有 Tools 连接。

分类视图用于发现和查看能力，不创建新的安装包、授权项或独立开关。所有视图仍由 `tools` 包级授权和启用状态控制；公开资料读取可能消耗采集额度，写操作保留原确认与幂等契约。服务连接配置不等于连接健康状态。

更新后在桌面仓运行 `sync-dofe-plugin-snapshot.mjs --write dsh-tools-mcp` 与 `generate-tool-views.mjs`，提交源码、快照和派生视图。桌面布局和样式由产品仓拥有；Hub 发布另走正式签名流程。
