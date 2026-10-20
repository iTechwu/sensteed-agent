/** Generated from the committed Tools plugin snapshot. Run node scripts/generate-tool-views.mjs. */
export const TOOL_CAPABILITY_VIEWS = [
  {
    "id": "tools-svc-content-douyin-ai",
    "kind": "business",
    "group": "creation",
    "name": "抖音账号 AI 表现分析",
    "description": "单账号 AI 表现分析异步任务与结果读取；域内唯一模型调用例外，可能计费。",
    "servers": [
      "tools-douyin-operation"
    ],
    "categoryId": "content-operations",
    "serviceId": "content.douyin-ai",
    "tools": [
      "douyin_account_ai_analysis_get",
      "douyin_account_ai_analysis_start"
    ],
    "legacyCapabilities": [
      "tools-social-operation"
    ]
  },
  {
    "id": "tools-svc-content-douyin-analytics",
    "kind": "business",
    "group": "creation",
    "name": "抖音作品与账号指标",
    "description": "账号总览、单账号分析与趋势等只读聚合；查询零外呼、零计费。",
    "servers": [
      "tools-douyin-operation"
    ],
    "categoryId": "content-operations",
    "serviceId": "content.douyin-analytics",
    "tools": [
      "douyin_account_analysis",
      "douyin_account_analysis_export",
      "douyin_account_list",
      "douyin_account_overview",
      "douyin_account_trend",
      "douyin_export",
      "douyin_hot_work_list",
      "douyin_overview_export",
      "douyin_work_get",
      "douyin_work_list",
      "douyin_work_trend"
    ],
    "legacyCapabilities": [
      "tools-social-operation"
    ]
  },
  {
    "id": "tools-svc-content-douyin-ingestion",
    "kind": "business",
    "group": "collaboration",
    "name": "抖音账号、设备状态与采集入库",
    "description": "账号保存、会话状态上报与采集运行入库；采集在用户设备端执行，写入需确认。",
    "servers": [
      "tools-douyin-operation"
    ],
    "categoryId": "content-operations",
    "serviceId": "content.douyin-ingestion",
    "tools": [
      "douyin_account_remove",
      "douyin_account_save",
      "douyin_collect_ingest_batch",
      "douyin_collect_ingest_daily",
      "douyin_collect_run_cancel",
      "douyin_collect_run_finish",
      "douyin_collect_run_get",
      "douyin_collect_run_heartbeat",
      "douyin_collect_run_set_list_meta",
      "douyin_collect_run_start",
      "douyin_session_status_report"
    ],
    "legacyCapabilities": [
      "tools-social-operation"
    ]
  },
  {
    "id": "tools-svc-content-viral-assets",
    "kind": "business",
    "group": "creation",
    "name": "爆款素材与媒体链接",
    "description": "素材归档、签名 URL 刷新与抖音直链解析；直链转 TOS 可能产生外部付费调用。",
    "servers": [
      "tools-viral-video"
    ],
    "categoryId": "content-operations",
    "serviceId": "content.viral-assets",
    "tools": [
      "viral_video_asset_url_refresh",
      "viral_video_assets_list",
      "viral_video_assets_process",
      "viral_video_douyin_download_url",
      "viral_video_douyin_tos_url"
    ],
    "legacyCapabilities": [
      "tools-viral-video"
    ]
  },
  {
    "id": "tools-svc-content-viral-discovery",
    "kind": "business",
    "group": "creation",
    "name": "爆款发现、候选归档与检索",
    "description": "关键词与对标账号发现、候选检索与导出；发现运行同步长阻塞，注意预算与幂等键防重复计费。",
    "servers": [
      "tools-viral-video"
    ],
    "categoryId": "content-operations",
    "serviceId": "content.viral-discovery",
    "tools": [
      "viral_video_archive_submit",
      "viral_video_async_submit_get",
      "viral_video_candidate_advance",
      "viral_video_candidates_export",
      "viral_video_candidates_list",
      "viral_video_discovery_run",
      "viral_video_export_get",
      "viral_video_search_submit",
      "viral_video_sources_list"
    ],
    "legacyCapabilities": [
      "tools-viral-video"
    ]
  },
  {
    "id": "tools-svc-content-viral-monitoring",
    "kind": "business",
    "group": "creation",
    "name": "爆款种子、计划与看板",
    "description": "维护发现种子、预览定时计划与读取看板；写操作需确认。",
    "servers": [
      "tools-viral-video"
    ],
    "categoryId": "content-operations",
    "serviceId": "content.viral-monitoring",
    "tools": [
      "viral_video_account_seeds_upsert",
      "viral_video_dashboard_get",
      "viral_video_keyword_seeds_upsert",
      "viral_video_scheduled_plan_get",
      "viral_video_seeds_list",
      "viral_video_status_get"
    ],
    "legacyCapabilities": [
      "tools-viral-video"
    ]
  },
  {
    "id": "tools-svc-content-viral-workflows",
    "kind": "business",
    "group": "creation",
    "name": "爆款拆解、仿写规则与故事板",
    "description": "视频分析链路、拆解详情、仿写规则与故事板生成；模型与计费按各工具契约执行。",
    "servers": [
      "tools-viral-video"
    ],
    "categoryId": "content-operations",
    "serviceId": "content.viral-workflows",
    "tools": [
      "viral_video_analysis_run",
      "viral_video_analysis_status_get",
      "viral_video_rewrite_rules_list",
      "viral_video_storyboard_export",
      "viral_video_storyboard_generate",
      "viral_video_storyboards_list",
      "viral_video_workflow_get",
      "viral_video_workflow_start"
    ],
    "legacyCapabilities": [
      "tools-viral-video"
    ]
  },
  {
    "id": "tools-svc-content-xhs-creation",
    "kind": "business",
    "group": "creation",
    "name": "小红书对标与内容创作",
    "description": "对标检索、风格获取与创作任务生命周期；检索缓存未命中可能计费，任务写操作需确认。",
    "servers": [
      "tools-xhs-operation"
    ],
    "categoryId": "content-operations",
    "serviceId": "content.xhs-creation",
    "tools": [
      "xhs_operation_account_search",
      "xhs_operation_feedback_save",
      "xhs_operation_reference_search",
      "xhs_operation_reference_select",
      "xhs_operation_result_get",
      "xhs_operation_style_get",
      "xhs_operation_task_cancel",
      "xhs_operation_task_create",
      "xhs_operation_task_get",
      "xhs_operation_task_retry"
    ],
    "legacyCapabilities": [
      "tools-social-operation"
    ]
  },
  {
    "id": "tools-svc-content-xhs-hotboard",
    "kind": "business",
    "group": "creation",
    "name": "小红书爆款看板与人工审核",
    "description": "爆款候选、打标与人工审核流转；审核发布属人工决策，工具只承载流转。",
    "servers": [
      "tools-xhs-operation"
    ],
    "categoryId": "content-operations",
    "serviceId": "content.xhs-hotboard",
    "tools": [
      "xhs_operation_hotboard_candidate_review",
      "xhs_operation_hotboard_candidates_list",
      "xhs_operation_hotboard_keyword_save",
      "xhs_operation_hotboard_keywords_list",
      "xhs_operation_hotboard_label_review",
      "xhs_operation_hotboard_label_save",
      "xhs_operation_hotboard_labels_list",
      "xhs_operation_hotboard_note_detail",
      "xhs_operation_hotboard_note_exclude",
      "xhs_operation_hotboard_note_tag_update",
      "xhs_operation_hotboard_overview",
      "xhs_operation_hotboard_run_get",
      "xhs_operation_hotboard_run_start",
      "xhs_operation_hotboard_settings_get",
      "xhs_operation_hotboard_settings_update"
    ],
    "legacyCapabilities": [
      "tools-social-operation"
    ]
  },
  {
    "id": "tools-svc-enterprise-business-context",
    "kind": "business",
    "group": "business",
    "name": "业务背景与人工分析",
    "description": "维护供应商业务背景、影响分析与人工判断版本；写操作带乐观并发校验。",
    "servers": [
      "tools-supply-chain"
    ],
    "categoryId": "enterprise-risk",
    "serviceId": "enterprise.business-context",
    "tools": [
      "supply_chain_business_analysis_list",
      "supply_chain_business_analysis_save",
      "supply_chain_business_context_get",
      "supply_chain_business_context_save"
    ],
    "legacyCapabilities": [
      "tools-supply-chain"
    ]
  },
  {
    "id": "tools-svc-enterprise-collection",
    "kind": "business",
    "group": "business",
    "name": "企业与媒体证据摄取",
    "description": "企业画像采集、社媒监控入库与新闻快照摄取；经授权来源执行，写操作需确认与幂等键。",
    "servers": [
      "tools-supply-chain"
    ],
    "categoryId": "enterprise-risk",
    "serviceId": "enterprise.collection",
    "tools": [
      "supply_chain_aiqicha_company_profile_collect",
      "supply_chain_aiqicha_mobile_snapshot_collect",
      "supply_chain_aiqicha_mobile_source_authorize",
      "supply_chain_company_profile_sync",
      "supply_chain_getone_social_source_authorize",
      "supply_chain_news_snapshot_ingest",
      "supply_chain_run_cancel",
      "supply_chain_run_get",
      "supply_chain_social_monitoring_collect"
    ],
    "legacyCapabilities": [
      "tools-supply-chain"
    ]
  },
  {
    "id": "tools-svc-enterprise-company-data",
    "kind": "business",
    "group": "business",
    "name": "企业识别与企查查数据",
    "description": "按名称搜索企业并读取注册、风险等工商数据；缓存未命中消耗企查查额度，30 分钟内复用缓存。",
    "servers": [
      "tools-supply-chain"
    ],
    "categoryId": "enterprise-risk",
    "serviceId": "enterprise.company-data",
    "tools": [
      "supply_chain_qcc_capabilities_get",
      "supply_chain_qcc_company_data_get",
      "supply_chain_qcc_company_data_list",
      "supply_chain_qcc_company_search"
    ],
    "legacyCapabilities": [
      "tools-supply-chain"
    ]
  },
  {
    "id": "tools-svc-enterprise-intelligence",
    "kind": "business",
    "group": "business",
    "name": "情报报告与时间线",
    "description": "读取证据时间线与聚合情报报告，可运行 LLM 情报摘要。",
    "servers": [
      "tools-supply-chain"
    ],
    "categoryId": "enterprise-risk",
    "serviceId": "enterprise.intelligence",
    "tools": [
      "supply_chain_intelligence_report_get",
      "supply_chain_intelligence_summary_run",
      "supply_chain_monitoring_timeline_get"
    ],
    "legacyCapabilities": [
      "tools-supply-chain"
    ]
  },
  {
    "id": "tools-svc-enterprise-relationships",
    "kind": "business",
    "group": "business",
    "name": "企业关系核验",
    "description": "供应商与法人实体的关系核验与审核；写操作需确认。",
    "servers": [
      "tools-supply-chain"
    ],
    "categoryId": "enterprise-risk",
    "serviceId": "enterprise.relationships",
    "tools": [
      "supply_chain_relationship_review_submit",
      "supply_chain_relationships_list"
    ],
    "legacyCapabilities": [
      "tools-supply-chain"
    ]
  },
  {
    "id": "tools-svc-enterprise-risk",
    "kind": "business",
    "group": "business",
    "name": "风险事件、预测与告警处置",
    "description": "风险事件审核、告警处置与风险预测运行；写操作需确认。",
    "servers": [
      "tools-supply-chain"
    ],
    "categoryId": "enterprise-risk",
    "serviceId": "enterprise.risk",
    "tools": [
      "supply_chain_alert_assign",
      "supply_chain_alert_create",
      "supply_chain_alert_resolve",
      "supply_chain_alerts_list",
      "supply_chain_event_analysis_run",
      "supply_chain_risk_event_review",
      "supply_chain_risk_events_list",
      "supply_chain_risk_forecast_run"
    ],
    "legacyCapabilities": [
      "tools-supply-chain"
    ]
  },
  {
    "id": "tools-svc-enterprise-suppliers",
    "kind": "business",
    "group": "business",
    "name": "供应商主数据",
    "description": "供应商建档、验证、更新与列表查询；公开目录共享，写操作需确认与版本校验。",
    "servers": [
      "tools-supply-chain"
    ],
    "categoryId": "enterprise-risk",
    "serviceId": "enterprise.suppliers",
    "tools": [
      "supply_chain_capabilities_get",
      "supply_chain_supplier_archive",
      "supply_chain_supplier_create",
      "supply_chain_supplier_get",
      "supply_chain_supplier_import",
      "supply_chain_supplier_update",
      "supply_chain_supplier_verify",
      "supply_chain_suppliers_list"
    ],
    "legacyCapabilities": [
      "tools-supply-chain"
    ]
  },
  {
    "id": "tools-svc-enterprise-weekly-reports",
    "kind": "business",
    "group": "business",
    "name": "周报计划、阅读与恢复",
    "description": "周报计划保存、报告阅读回执与失败重试；个人已读独立作用域。",
    "servers": [
      "tools-supply-chain"
    ],
    "categoryId": "enterprise-risk",
    "serviceId": "enterprise.weekly-reports",
    "tools": [
      "supply_chain_weekly_report_get",
      "supply_chain_weekly_report_mark_read",
      "supply_chain_weekly_report_plan_get",
      "supply_chain_weekly_report_plan_save",
      "supply_chain_weekly_report_retry",
      "supply_chain_weekly_reports_list"
    ],
    "legacyCapabilities": [
      "tools-supply-chain"
    ]
  },
  {
    "id": "tools-svc-enterprise-workbench",
    "kind": "business",
    "group": "business",
    "name": "风险工作台与证据阅读",
    "description": "工作台总览、供应商检索与证据阅读；纯数据库读取，零外呼、零计费。",
    "servers": [
      "tools-supply-chain"
    ],
    "categoryId": "enterprise-risk",
    "serviceId": "enterprise.workbench",
    "tools": [
      "supply_chain_workbench_evidence_get",
      "supply_chain_workbench_evidence_list",
      "supply_chain_workbench_overview_get",
      "supply_chain_workbench_suppliers_list"
    ],
    "legacyCapabilities": [
      "tools-supply-chain"
    ]
  },
  {
    "id": "tools-svc-growth-discovery",
    "kind": "business",
    "group": "research",
    "name": "线索发现与导入",
    "description": "按关键词发现线索候选、批量发现与手工导入；政策未审校，按未知费用处理。",
    "servers": [
      "tools-lead-discovery"
    ],
    "categoryId": "customer-growth",
    "serviceId": "growth.discovery",
    "tools": [
      "lead_discovery_batch_discover",
      "lead_discovery_discover",
      "lead_discovery_manual_import",
      "lead_discovery_result_page_get"
    ],
    "legacyCapabilities": [
      "tools-lead-discovery"
    ]
  },
  {
    "id": "tools-svc-growth-enrichment",
    "kind": "business",
    "group": "research",
    "name": "反馈、账号内容与评论补充",
    "description": "结构化反馈入库、账号内容采集与评论深化；受每日请求与计费响应上限约束。",
    "servers": [
      "tools-lead-discovery"
    ],
    "categoryId": "customer-growth",
    "serviceId": "growth.enrichment",
    "tools": [
      "lead_discovery_account_content_plan_get",
      "lead_discovery_account_content_run",
      "lead_discovery_account_verification_import",
      "lead_discovery_comment_fetch_plan_get",
      "lead_discovery_comment_fetch_report_get",
      "lead_discovery_comment_fetch_run",
      "lead_discovery_feedback_persist",
      "lead_discovery_feedback_validate",
      "lead_discovery_llm_analysis_run"
    ],
    "legacyCapabilities": [
      "tools-lead-discovery"
    ]
  },
  {
    "id": "tools-svc-growth-lead-pool",
    "kind": "business",
    "group": "research",
    "name": "正式业务线索池与关联证据",
    "description": "正式线索池只读查询与关联证据；只读不触发采集，零外呼、零计费。",
    "servers": [
      "tools-lead-discovery"
    ],
    "categoryId": "customer-growth",
    "serviceId": "growth.lead-pool",
    "tools": [
      "lead_pool_entries_list",
      "lead_pool_entry_evidence_list",
      "lead_pool_entry_get"
    ],
    "legacyCapabilities": [
      "tools-lead-discovery"
    ]
  },
  {
    "id": "tools-svc-growth-lead-query",
    "kind": "business",
    "group": "research",
    "name": "线索候选与洞察查询",
    "description": "候选列表、数据库检索、日报与效果洞察；只读数据库，零外呼、零计费。",
    "servers": [
      "tools-lead-discovery"
    ],
    "categoryId": "customer-growth",
    "serviceId": "growth.lead-query",
    "tools": [
      "lead_discovery_candidates_list",
      "lead_discovery_daily_report_get",
      "lead_discovery_database_search",
      "lead_discovery_insights_get",
      "lead_discovery_keyword_report_get",
      "lead_discovery_periodic_runs_list",
      "lead_discovery_status_get"
    ],
    "legacyCapabilities": [
      "tools-lead-discovery"
    ]
  },
  {
    "id": "tools-svc-growth-monitoring-config",
    "kind": "business",
    "group": "research",
    "name": "监测来源、栏目、账号与关键词",
    "description": "维护监测来源目录、栏目、账号与关键词种子；写操作需确认与版本校验。",
    "servers": [
      "tools-lead-monitor"
    ],
    "categoryId": "customer-growth",
    "serviceId": "growth.monitoring-config",
    "tools": [
      "lead_monitor_account_upsert",
      "lead_monitor_accounts_list",
      "lead_monitor_keyword_publish",
      "lead_monitor_keyword_upsert",
      "lead_monitor_keywords_list",
      "lead_monitor_source_section_upsert",
      "lead_monitor_source_sections_list",
      "lead_monitor_source_upsert",
      "lead_monitor_sources_list"
    ],
    "legacyCapabilities": [
      "tools-lead-discovery"
    ]
  },
  {
    "id": "tools-svc-growth-monitoring-results",
    "kind": "business",
    "group": "research",
    "name": "监测计划、运行、结果与效果",
    "description": "预览监测计划、启动运行并读取结果与效果；计划预览零费用，运行启动需确认。",
    "servers": [
      "tools-lead-monitor"
    ],
    "categoryId": "customer-growth",
    "serviceId": "growth.monitoring-results",
    "tools": [
      "lead_monitor_effectiveness_get",
      "lead_monitor_periodic_runs_list",
      "lead_monitor_plan_preview",
      "lead_monitor_result_page_get",
      "lead_monitor_results_list",
      "lead_monitor_run_get",
      "lead_monitor_run_start"
    ],
    "legacyCapabilities": [
      "tools-lead-discovery"
    ]
  },
  {
    "id": "tools-svc-growth-schedule-budget",
    "kind": "business",
    "group": "research",
    "name": "调度计划、恢复与预算通知",
    "description": "定时计划预览、受控重试与预算通知执行；写操作需确认。",
    "servers": [
      "tools-lead-discovery"
    ],
    "categoryId": "customer-growth",
    "serviceId": "growth.schedule-budget",
    "tools": [
      "lead_discovery_budget_notification_execute",
      "lead_discovery_budget_notification_get",
      "lead_discovery_scheduled_plan_get",
      "lead_discovery_scheduled_retry_plan_get",
      "lead_discovery_scheduled_retry_run"
    ],
    "legacyCapabilities": [
      "tools-lead-discovery"
    ]
  },
  {
    "id": "tools-svc-media-generic-upload",
    "kind": "business",
    "group": "collaboration",
    "name": "通用 TOS 上传授权",
    "description": "签发 TOS 预签名 PUT URL 供本地直传；授权域不触发模型调用。",
    "servers": [
      "tools-tos-upload"
    ],
    "categoryId": "media-assets",
    "serviceId": "media.generic-upload",
    "tools": [
      "tos_upload_authorize"
    ],
    "legacyCapabilities": [
      "tools-tos-upload"
    ]
  },
  {
    "id": "tools-svc-platform-discovery",
    "kind": "business",
    "group": "business",
    "name": "能力目录",
    "description": "按分类与服务组浏览全部业务能力，检索工具并读取契约与政策；纯本地目录，零外呼、零计费。",
    "servers": [
      "tools-platform"
    ],
    "categoryId": "platform",
    "serviceId": "platform.discovery",
    "tools": [
      "business_capabilities_list",
      "business_capability_get",
      "business_service_categories_list",
      "business_tool_contract_get",
      "business_tools_search"
    ],
    "legacyCapabilities": [
      "tools-business-discovery"
    ]
  },
  {
    "id": "tools-svc-platform-receipts",
    "kind": "business",
    "group": "business",
    "name": "通用运行与变更回执",
    "description": "查询命令运行回执与变更凭据，可取消未终结的运行；读取零外呼、零计费。",
    "servers": [
      "tools-platform"
    ],
    "categoryId": "platform",
    "serviceId": "platform.receipts",
    "tools": [
      "platform_mutation_receipts_get",
      "platform_run_cancel",
      "platform_run_get"
    ],
    "legacyCapabilities": [
      "tools-business-discovery"
    ]
  },
  {
    "id": "tools-svc-platform-text",
    "kind": "business",
    "group": "business",
    "name": "文本摘要",
    "description": "调用模型做文本摘要，显式外呼且可能计费。",
    "servers": [
      "tools-platform"
    ],
    "categoryId": "platform",
    "serviceId": "platform.text",
    "tools": [
      "text_summarize"
    ],
    "legacyCapabilities": [
      "tools-business-discovery"
    ]
  },
  {
    "id": "tools-svc-research-browser",
    "kind": "business",
    "group": "research",
    "name": "受控浏览器证据",
    "description": "预览浏览器采集计划、确认执行并读取归一化证据；计划预览零费用，运行执行需确认。",
    "servers": [
      "tools-browser-intelligence"
    ],
    "categoryId": "public-research",
    "serviceId": "research.browser",
    "tools": [
      "browser_intelligence_evidence_list",
      "browser_intelligence_plan_preview",
      "browser_intelligence_run_get",
      "browser_intelligence_run_start",
      "browser_intelligence_session_get"
    ],
    "legacyCapabilities": [
      "tools-market-research"
    ]
  },
  {
    "id": "tools-svc-research-hotspots",
    "kind": "business",
    "group": "research",
    "name": "热点检索与事件",
    "description": "预览热点检索计划、受理运行并读取事件结果；运行受理走全局预算门，读取零外呼、零计费。",
    "servers": [
      "tools-hotspot-discovery"
    ],
    "categoryId": "public-research",
    "serviceId": "research.hotspots",
    "tools": [
      "hotspot_discovery_event_get",
      "hotspot_discovery_events_list",
      "hotspot_discovery_plan_preview",
      "hotspot_discovery_run_get",
      "hotspot_discovery_run_start"
    ],
    "legacyCapabilities": [
      "tools-market-research",
      "tools-hotspot-discovery"
    ]
  },
  {
    "id": "tools-svc-research-social",
    "kind": "business",
    "group": "research",
    "name": "社媒公开读取目录与执行",
    "description": "读取微信、头条、西瓜等社媒公开内容的目录、参数与单页读取；缓存未命中可能外呼计费，先用读取准备做零成本校验。",
    "servers": [
      "tools-platform"
    ],
    "categoryId": "public-research",
    "serviceId": "research.social",
    "tools": [
      "getoneapi_social_capabilities_get",
      "getoneapi_social_read",
      "getoneapi_social_read_prepare"
    ],
    "legacyCapabilities": [
      "tools-public-social-research"
    ]
  },
  {
    "id": "tools-svc-talent-discovery",
    "kind": "business",
    "group": "research",
    "name": "人才发现与候选查询",
    "description": "跨平台人才发现、候选列表、简报与证据查询；账号模式当前域未启用，未知政策失败关闭。",
    "servers": [
      "tools-talent-discovery"
    ],
    "categoryId": "talent",
    "serviceId": "talent.discovery",
    "tools": [
      "talent_candidate_briefs_get",
      "talent_candidate_evidence_list",
      "talent_candidate_get",
      "talent_candidates_list",
      "talent_discovery_discover",
      "talent_discovery_result_page_get"
    ],
    "legacyCapabilities": [
      "tools-talent-discovery"
    ]
  },
  {
    "id": "tools-svc-talent-evaluation",
    "kind": "business",
    "group": "research",
    "name": "人才画像、反馈与评分",
    "description": "画像构建、反馈导入与只读评分调整；写操作需确认。",
    "servers": [
      "tools-talent-discovery"
    ],
    "categoryId": "talent",
    "serviceId": "talent.evaluation",
    "tools": [
      "talent_analysis_readiness_get",
      "talent_candidate_profile_get",
      "talent_feedback_import",
      "talent_feedback_scores_get",
      "talent_profiles_build"
    ],
    "legacyCapabilities": [
      "tools-talent-discovery"
    ]
  },
  {
    "id": "tools-svc-talent-outreach",
    "kind": "business",
    "group": "research",
    "name": "触达草稿、状态与成效",
    "description": "触达草稿构建、状态导入与漏斗成效；写操作需确认。",
    "servers": [
      "tools-talent-discovery"
    ],
    "categoryId": "talent",
    "serviceId": "talent.outreach",
    "tools": [
      "talent_metrics_snapshot_create",
      "talent_metrics_summary_get",
      "talent_outreach_drafts_build",
      "talent_outreach_report_get",
      "talent_outreach_status_import"
    ],
    "legacyCapabilities": [
      "tools-talent-discovery"
    ]
  },
  {
    "id": "tools-svc-vehicle-browser-intake",
    "kind": "business",
    "group": "research",
    "name": "改装浏览器证据交接",
    "description": "把浏览器采集证据收入汽车业务数据；写操作需确认与幂等键。",
    "servers": [
      "tools-custom-car-monitoring"
    ],
    "categoryId": "vehicle-intelligence",
    "serviceId": "vehicle.browser-intake",
    "tools": [
      "custom_car_monitoring_browser_evidence_intake",
      "custom_car_monitoring_browser_run_start"
    ],
    "legacyCapabilities": [
      "tools-custom-car-monitoring"
    ]
  },
  {
    "id": "tools-svc-vehicle-cases",
    "kind": "business",
    "group": "research",
    "name": "改装案例、分析与趋势",
    "description": "改装内容检索、确定性分析运行与趋势查询；改装案例库为唯一事实源。",
    "servers": [
      "tools-custom-car-monitoring"
    ],
    "categoryId": "vehicle-intelligence",
    "serviceId": "vehicle.cases",
    "tools": [
      "custom_car_monitoring_analysis_run",
      "custom_car_monitoring_contents_list",
      "custom_car_monitoring_result_page_get",
      "custom_car_monitoring_search",
      "custom_car_monitoring_trends_list"
    ],
    "legacyCapabilities": [
      "tools-custom-car-monitoring"
    ]
  },
  {
    "id": "tools-svc-vehicle-monitoring",
    "kind": "business",
    "group": "research",
    "name": "改装监测资产与运行",
    "description": "监测资产维护、计划预览与运行；写操作需确认与版本校验。",
    "servers": [
      "tools-custom-car-monitoring"
    ],
    "categoryId": "vehicle-intelligence",
    "serviceId": "vehicle.monitoring",
    "tools": [
      "custom_car_monitoring_asset_upsert",
      "custom_car_monitoring_assets_list",
      "custom_car_monitoring_periodic_runs_list",
      "custom_car_monitoring_plan_get",
      "custom_car_monitoring_run_get",
      "custom_car_monitoring_run_start"
    ],
    "legacyCapabilities": [
      "tools-custom-car-monitoring"
    ]
  }
] as const
