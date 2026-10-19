// Datasource packages/constants/src/finance-permissions.ts 的展示快照；check:datasource 检查漂移，不参与鉴权。
const FINANCE_PERMISSION_NAMES = {
  "budget.activity.read": "查看预算填报活动",
  "budget.activity.manage": "创建/发布/关闭填报活动",
  "budget.activity.reopen": "重开已关闭活动",
  "budget.entry.write": "填报本人预算",
  "budget.entry.initial-review": "部门对接人初审",
  "budget.entry.final-review": "部门负责人终审",
  "budget.department.submit": "提交部门预算",
  "budget.submission.read": "查看预算填报",
  "budget.submission.edit": "代部门修改填报",
  "budget.submission.verify": "确认/退回填报",
  "budget.adjustment.approve": "审核预算调整",
  "budget.version.manage": "创建/编辑预算版本",
  "budget.version.publish": "发布正式预算版本",
  "budget.compare.read": "查看预算比较",
  "budget.execution.read": "查看预算执行",
  "cash.plan.read": "查看资金计划",
  "cash.plan.write": "填报资金计划",
  "cash.plan.verify": "确认资金计划",
  "cash.plan.adjustment.approve": "资金计划调整审批",
  "finance.source.review": "来源数据清洗/确认/退回",
  "finance.invoice.check": "发票重复/真伪校验",
  "finance.archive.read": "电子档案查询",
  "finance.assistant.read": "查看 AI 财务助手",
  "cost.engineering.read": "查看成本工程",
  "finance.permission.manage": "管理财务权限"
}
const FINANCE_PERMISSION_GROUPS = [
  {
    "domain": "预算填报活动",
    "permissions": [
      "budget.activity.read",
      "budget.activity.manage",
      "budget.activity.reopen"
    ]
  },
  {
    "domain": "预算填报",
    "permissions": [
      "budget.entry.write",
      "budget.entry.initial-review",
      "budget.entry.final-review",
      "budget.department.submit",
      "budget.submission.read",
      "budget.submission.edit",
      "budget.submission.verify"
    ]
  },
  {
    "domain": "预算调整与版本",
    "permissions": [
      "budget.adjustment.approve",
      "budget.version.manage",
      "budget.version.publish",
      "budget.compare.read",
      "budget.execution.read"
    ]
  },
  {
    "domain": "资金",
    "permissions": [
      "cash.plan.read",
      "cash.plan.write",
      "cash.plan.verify",
      "cash.plan.adjustment.approve"
    ]
  },
  {
    "domain": "来源与质量",
    "permissions": [
      "finance.source.review",
      "finance.invoice.check",
      "finance.archive.read"
    ]
  },
  {
    "domain": "财务工具",
    "permissions": [
      "finance.assistant.read",
      "cost.engineering.read"
    ]
  },
  {
    "domain": "权限管理",
    "permissions": [
      "finance.permission.manage"
    ]
  }
]
const FINANCE_HIGH_RISK_PERMISSIONS = [
  "budget.activity.reopen",
  "budget.version.publish",
  "finance.permission.manage",
  "cash.plan.adjustment.approve"
]
const FINANCE_ROLE_PERMISSION_BASELINE = {
  "FINANCE_OWNER": [
    "budget.activity.read",
    "budget.activity.manage",
    "budget.activity.reopen",
    "budget.entry.write",
    "budget.entry.initial-review",
    "budget.entry.final-review",
    "budget.department.submit",
    "budget.submission.read",
    "budget.submission.edit",
    "budget.submission.verify",
    "budget.adjustment.approve",
    "budget.version.manage",
    "budget.version.publish",
    "budget.compare.read",
    "budget.execution.read",
    "cash.plan.read",
    "cash.plan.write",
    "cash.plan.verify",
    "cash.plan.adjustment.approve",
    "finance.source.review",
    "finance.invoice.check",
    "finance.archive.read",
    "finance.assistant.read",
    "cost.engineering.read",
    "finance.permission.manage"
  ],
  "FINANCE_STAFF": [
    "budget.activity.read",
    "budget.activity.manage",
    "budget.activity.reopen",
    "budget.entry.write",
    "budget.submission.read",
    "budget.submission.edit",
    "budget.submission.verify",
    "budget.adjustment.approve",
    "budget.version.manage",
    "budget.version.publish",
    "budget.compare.read",
    "budget.execution.read",
    "cash.plan.read",
    "cash.plan.write",
    "cash.plan.verify",
    "finance.source.review",
    "finance.invoice.check",
    "finance.archive.read"
  ],
  "DEPT_LEADER": [
    "budget.entry.write",
    "budget.entry.final-review",
    "budget.department.submit",
    "budget.activity.read",
    "budget.submission.read",
    "budget.submission.edit"
  ],
  "DEPT_FILLER": [
    "budget.entry.write",
    "budget.activity.read",
    "budget.submission.read",
    "budget.submission.edit"
  ],
  "DEPT_COLLABORATOR": [
    "budget.entry.write",
    "budget.entry.initial-review",
    "budget.activity.read",
    "budget.submission.read"
  ],
  "BOSS": [
    "budget.activity.read",
    "budget.submission.read",
    "budget.execution.read",
    "budget.compare.read",
    "cash.plan.read"
  ],
  "MANAGEMENT": [
    "budget.activity.read",
    "budget.submission.read",
    "budget.execution.read",
    "budget.compare.read",
    "cash.plan.read"
  ]
}
const FINANCE_POLICY_ROLE_NAMES = {
  "DEPT_FILLER": "部门填报人",
  "DEPT_LEADER": "部门负责人",
  "DEPT_COLLABORATOR": "部门对接人（初审）",
  "BOSS": "老板（终审）",
  "FINANCE_STAFF": "财务专员",
  "FINANCE_OWNER": "财务负责人",
  "MANAGEMENT": "管理层（只读）"
}
