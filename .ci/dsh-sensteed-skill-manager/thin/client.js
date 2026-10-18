window.__ModuleLoader__.load({
  id: '@dofe/dsh-sensteed-skill-manager',
  factory: require => {
    const { createElement: h } = require('react')
    function HubManagementLocation() {
      return h('section', { style: { padding: 24 }, 'aria-labelledby': 'hub-management-location' },
        h('h2', { id: 'hub-management-location' }, '插件与技能管理 / Plugins and skills'),
        h('p', null, '请打开设置 → 插件与技能安装。该基础 Host 页面提供检查、完整计划预览、确认安装、状态恢复与重启激活。'),
        h('p', null, 'Open Settings → Install plugins and skills for Host-managed checks, full-plan preview, installation, recovery and activation.'),
        h('p', null, '已有本机自定义技能仍由 Harness 原生技能功能管理；本插件不会删除、迁移或覆盖它们。'),
        h('p', null, 'Existing local custom skills remain managed by the native Harness. This plugin does not download or install content.'))
    }
    return { inject: ['slots'], apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'hub-management-location', order: 13,
        label: () => '技能管理入口 / Skill management',
      }, HubManagementLocation))
    } }
  },
})
