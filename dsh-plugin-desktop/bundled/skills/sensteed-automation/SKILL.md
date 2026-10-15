---
name: sensteed-automation
description: 在 Sensteed-Agent 中创建自动化任务、定时提醒或周期执行计划。用于自动化任务页面的新建向导，以及用户要求稍后、每天、每周或按间隔执行任务时。
---

# 自动化任务

把用户的执行意图保存为 Sensteed-Agent 当前会话中的真实调度任务，使用本机提供的 `schedule_create`、`schedule_list`、`schedule_update` 和 `schedule_delete` 工具。不要改用系统 cron、外部调度服务或手写调度文件。

## 从需求到创建

- 用户只点击了“新建自动化任务”时，先用简短中文询问“你希望自动执行什么、什么时候执行？例如：每个工作日上午 9 点整理项目进展。”此时没有任务内容或时间，不要创建示例任务。
- 已有明确需求就直接推进；只追问缺失且影响执行的信息，例如执行内容、目标项目、时间或时区。优先使用会话提供的当前时间与用户时区；没有可靠时区时询问，不能把中文等同于北京时间。用户已经明确要求创建且信息完整时，直接调用工具。
- `title` 是不超过 120 字符的简短任务名，仅包含核心动作和对象；频率、时间和时区放在调度参数。`prompt` 是到期时发送给当前会话的执行指令，写清对象、输入来源、预期结果和用户明确的约束。不要把“创建一个自动化任务”的向导指令放进 `prompt`，以免每次触发又创建任务。
- 调用前确认工具可用。不可用时说明当前环境无法保存自动化任务，不得声称创建成功。

## 选择时间参数

每次 `schedule_create` 必须提供 `title`、`prompt`，以及**恰好一个**时间参数：

| 意图 | 参数 |
| --- | --- |
| 过一段时间执行一次 | `after_seconds`：正整数秒 |
| 指定日期时间执行一次 | `at`：带偏移的 RFC 3339 时间，或 `{date: "YYYY-MM-DD", time: "HH:mm:ss", time_zone: "Area/Location"}` |
| 按固定间隔重复 | `every_seconds`：整数，至少 60 秒 |
| 每天某时 | `daily: {time: "HH:mm:ss", time_zone: "Area/Location"}` |
| 每周指定日某时 | `weekly: {time: "HH:mm:ss", time_zone: "Area/Location", weekdays: [1, 2, 3, 4, 5]}`，周一为 1、周日为 7 |
| 更复杂的周期 | `cron: {expression: "五字段 Vixie cron", time_zone: "Area/Location"}` |

例如用户已指定 Asia/Shanghai、每个工作日上午九点整理项目进展：

```json
{"title":"整理项目进展","prompt":"整理当前项目的最新进展，汇总已完成事项、阻塞和下一步，并在本会话给出结果。","weekly":{"time":"09:00:00","time_zone":"Asia/Shanghai","weekdays":[1,2,3,4,5]}}
```

## 验证与反馈

- 只有工具返回包含真实 `id` 和 `scheduledAt` 的成功记录，才能告知已创建。说明任务名、执行计划、时区和下一次执行时间；用户可在“自动化任务”查看和修改。新会话或一段计划文字都不代表已创建。
- 这些任务由本机 Host 投递到原会话；执行时需要 Sensteed-Agent 运行且模型与相关工具可用。不要承诺退出应用后仍会准点执行。重启后的周期任务只补投最近一次错过的触发；崩溃恢复可能重复投递，不能承诺恰好执行一次。
- 校验错误（如 `invalid_selector`、`invalid_time_zone`、`not_future` 或 `frequency_too_high`）根据返回原因修正；需要改变用户的执行时间或频率时先询问。通信中断或结果不明时，先 `schedule_list` 核对当前会话有无同一任务，避免盲目重试产生重复任务。
- 修改已有任务优先 `schedule_update` 保留 id；删除仅针对用户指定的任务。`schedule_list` 只列当前会话的活跃任务，不能据此宣称已检查全部会话。调度工具不能在委派子代理中使用，创建与核验留在当前主会话。
