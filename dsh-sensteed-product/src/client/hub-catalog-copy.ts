/** Copy shared by the sidebar catalogs and their installation review. */
export const HUB_CATALOG_COPY = {
  zh: {
    catalogClearSearch: '清除搜索', catalogResults: '显示技能', catalogSkillDescription: '查看完整说明',
    catalogBackToAll: '查看全部内置能力',
    pluginsNav: '插件', skillsNav: '技能', pluginsIntro: '发现、创建和管理工作所需的插件。', skillsIntro: '发现、创建和管理 Agent 技能。',
    catalogTab: '企业目录', builtInTab: '内置插件', localSkillsTab: '可用技能', catalogSearch: '搜索名称', catalogAll: '全部', catalogInstalled: '已安装', catalogAvailable: '可安装', catalogFilter: '筛选安装状态',
    catalogEmpty: '目录中还没有内容', catalogNoMatches: '没有匹配的内容，请调整搜索或筛选条件。', catalogLoading: '正在读取目录…', catalogDetails: '查看详细信息', catalogRequired: '必需',
    catalogUnpublished: '尚未发布可安装版本', catalogUnavailable: '暂不可安装', catalogCurrent: '已是当前版本', catalogUpdate: '有新版本', catalogReady: '可安装', catalogRemoved: '已移除', catalogNotInstalled: '未通过企业目录安装',
    catalogUnpublishedHint: '发布可用版本后即可在这里安装。', catalogUnavailableHint: '当前版本或账号暂不满足安装条件，可查看详情后联系管理员。',
    catalogReviewHint: '企业目录管理独立发布的版本；随应用提供的插件或技能可在对应的本地列表中查看。安装或更新前，请预览并确认变更。', catalogFullPlan: '预览会包含插件和技能的完整变更，请一并核对。',
    createPluginAction: '创建插件', createSkillAction: '创建技能', catalogCreating: '正在打开…', catalogCreateFailed: '无法打开创建会话，请重试。',
    localSkillsIntro: '以下技能可在最近的会话中通过 /名称 调用。', localSkillsEmpty: '开始一个会话后，即可查看该会话可用的技能。', localSkillsFailed: '无法读取技能，请重试。', catalogRetry: '重试',
  },
  en: {
    catalogClearSearch: 'Clear search', catalogResults: 'Skills shown', catalogSkillDescription: 'Read full description',
    catalogBackToAll: 'All built-in capabilities',
    pluginsNav: 'Plugins', skillsNav: 'Skills', pluginsIntro: 'Discover, create, and manage plugins for your work.', skillsIntro: 'Discover, create, and manage Agent skills.',
    catalogTab: 'Company catalog', builtInTab: 'Built-in plugins', localSkillsTab: 'Available skills', catalogSearch: 'Search names', catalogAll: 'All', catalogInstalled: 'Installed', catalogAvailable: 'Available', catalogFilter: 'Filter installation status',
    catalogEmpty: 'The catalog is empty', catalogNoMatches: 'No matches. Try another search or filter.', catalogLoading: 'Loading catalog…', catalogDetails: 'View details', catalogRequired: 'Required',
    catalogUnpublished: 'No installable release yet', catalogUnavailable: 'Currently unavailable', catalogCurrent: 'Up to date', catalogUpdate: 'Update available', catalogReady: 'Ready to install', catalogRemoved: 'Removed', catalogNotInstalled: 'Not installed from company catalog',
    catalogUnpublishedHint: 'Installation will be available after a release is published.', catalogUnavailableHint: 'The current version or account does not meet installation requirements. See details or contact an administrator.',
    catalogReviewHint: 'Company releases are managed separately from built-in capabilities. Review and confirm changes before installing or updating.', catalogFullPlan: 'The preview includes all plugin and skill changes. Review them together.',
    createPluginAction: 'Create plugin', createSkillAction: 'Create skill', catalogCreating: 'Opening…', catalogCreateFailed: 'Could not open a creation conversation. Try again.',
    localSkillsIntro: 'Use /name in your most recent conversation to invoke these skills.', localSkillsEmpty: 'Start a conversation to see the skills available to it.', localSkillsFailed: 'Could not load skills. Try again.', catalogRetry: 'Retry',
  },
} as const
