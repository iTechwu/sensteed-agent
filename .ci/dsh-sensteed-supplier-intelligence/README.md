# dsh-sensteed-supplier-intelligence

Sensteed Agent 的供应商全量数据归集与舆情分析插件。默认安装后在原生侧栏增加“供应商风险”入口，在主内容区提供风险总览、供应商台账、工商与司法、媒体核验、业务影响和风险周报六个页面；不会替换或覆盖会话侧栏。

页面读取 Tools 供应链域持久化的数据，读取本身不会触发外部采集。新增供应商、批量导入、事件核验、业务判断和周报设置均通过显式确认及现有幂等命令提交；候选线索、已确认事实和人工判断保持分开。Agent 分析仍在原会话中运行。

Host 只从 Sensteed credential store 解析 `MODELS_API_KEY`，仅请求固定公共 MCP `https://ai.hozonauto.com/mcp/tools/supply-chain`。页面通过受同源校验的本机 Host 路由访问，不接收 URL、tenant、operator 或 credential 参数。

```bash
npm test
npm run check
```

逐页体验回归：`npm run test:ui` 使用独立 Chrome 与模拟接口测试六页任务、失败恢复、空态、明暗主题和三种宽度。需要可解析的 React、React DOM、esbuild、Playwright 测试依赖与 Chrome，可通过 `NODE_PATH` 提供可选依赖；`SUPPLIER_UX_OUTPUT` 指定截图目录。脚本不连接生产后端、不使用个人浏览器配置，不包含生产凭据。
