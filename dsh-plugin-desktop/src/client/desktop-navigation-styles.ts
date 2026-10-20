/** Theme-aware geometry scoped to the opted-in Desktop presentation. */
export function installDesktopNavigationStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const style = document.createElement('style')
  style.dataset.pluginCss = 'dsh-plugin-desktop/navigation'
  style.textContent = `
.sensteedNavigationFrame { display:flex; width:100%; height:100%; min-height:0; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); }
.sensteedNavigationContent { flex:1; min-width:0; height:100%; }
.sensteedModuleRail { box-sizing:border-box; width:52px; flex:none; display:flex; flex-direction:column; align-items:center; padding:12px 6px 10px; border-right:1px solid var(--dsw-alias-border-l1); }
.sensteedNavigationFrame[data-navigation-platform="darwin"] > .sensteedModuleRail { padding-top:52px; }
.sensteedNavigationFrame[data-navigation-platform="win32"] > .sensteedModuleRail { padding-top:40px; }
.sensteedModuleRail [role="tooltip"] { display:none !important; }
.sensteedRailTooltip { position:fixed; z-index:10000; transform:translateY(-50%); pointer-events:none; max-width:min(280px,calc(100vw - 68px)); overflow-wrap:anywhere; padding:6px 10px; border-radius:7px; border:1px solid var(--dsw-alias-border-l1); background:#292a2d; color:#fff; font-size:12px; line-height:18px; box-shadow:0 2px 8px #0002; }
.sensteedModuleBrand { height:40px; display:grid; place-items:center; margin-bottom:10px; }
.sensteedModuleBrand img { width:24px; height:24px; object-fit:contain; }
.sensteedModuleScroll { width:40px; flex:1; min-height:0; overflow-y:auto; scrollbar-width:none; }
.sensteedModuleScroll nav { display:flex; flex-direction:column; gap:8px; }
.sensteedModuleButton { position:relative; display:flex; align-items:center; justify-content:center; width:40px; height:40px; padding:0; border:0; border-radius:8px; background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer; flex:none; }
.sensteedModuleButton:hover { background:var(--dsw-alias-bg-layer-2); }
.sensteedModuleButton[aria-current="page"] { background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2)); color:var(--dsw-alias-label-primary); }
/* Rail owns module glyphs; plugin buttons retain their permission and navigation handlers. */
.sensteedPluginRailSeat[data-module-icon] { position:relative; width:40px; height:40px; }
.sensteedRailGlyph { position:absolute; inset:0; display:grid; place-items:center; pointer-events:none; color:var(--dsw-alias-label-secondary); }
.sensteedPluginRailSeat[data-module-icon] button svg { visibility:hidden; }
.sensteedModuleRail .sensteedModuleScroll button { display:flex; align-items:center; justify-content:center; box-sizing:border-box; width:40px; height:40px; border:0; border-radius:10px; padding:0; background:transparent; color:var(--dsw-alias-label-secondary); }
.sensteedModuleRail .sensteedModuleScroll svg { width:20px; height:20px; stroke-width:1.8; }
.sensteedModuleRail .sensteedModuleScroll button:hover { background:var(--dsw-alias-bg-layer-2); }
.sensteedModuleRail .sensteedModuleScroll button[aria-current="page"],
.sensteedModuleRail .sensteedModuleScroll [data-active] button { background:color-mix(in srgb,var(--dsw-alias-label-primary) 11%,var(--dsw-alias-bg-layer-1)); color:var(--dsw-alias-label-primary); }
.sensteedModuleRail .sensteedModuleScroll button[aria-current="page"] svg,
.sensteedModuleRail .sensteedModuleScroll [data-active] .sensteedRailGlyph { color:var(--dsw-alias-label-primary); stroke-width:2.4; }
.sensteedModuleRail .sensteedModuleScroll [data-active] .sensteedRailGlyph svg { stroke-width:2.4; }
.sensteedNavigationFrame button:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:-2px; }
.sensteedModuleFoot { width:40px; display:flex; flex-direction:column; align-items:center; gap:8px; padding-top:8px; }
.sensteedKnowledgeModule { margin-bottom:8px; }
.sensteedModuleExtensions:not(:has(button)) { display:none; }
.sensteedModuleExtensions { margin-top:16px; padding-top:12px; border-top:1px solid var(--dsw-alias-border-l1); }
body .sensteedNavigationFrame .sensteedModuleRail [data-slot="sidebar.footer.action"] { max-height:none; overflow:visible; scrollbar-gutter:auto; width:40px; margin:0; padding:0; gap:8px; }
body .sensteedNavigationFrame .sensteedModuleRail [data-slot="sidebar.footer.action"] button { box-sizing:border-box; width:40px; min-width:0; height:40px; margin:0; padding:0; justify-content:center; gap:0; border-radius:10px; }
body .sensteedNavigationFrame .sensteedModuleRail [data-slot="sidebar.footer.action"] button::after { content:none !important; }
.sensteedModuleRail [data-slot="sidebar.settings"] { width:40px; }
.sensteedModuleRail [data-slot="sidebar.settings"] > div:first-child { width:40px; }
.sensteedModuleRail [data-slot="sidebar.settings"] button { max-width:40px; }
.sensteedModuleRail .dshSensteedUserSettingsTrigger .dshDofeAccessAvatar { width:26px; height:26px; }
.sensteedModuleButton,.sensteedBusinessNavigation button { transition:background-color 150ms ease,color 150ms ease; }
@media(prefers-reduced-motion:reduce) { .sensteedModuleButton,.sensteedBusinessNavigation button { transition:none; } }
.sensteedContextSidebar { --dsh-sidebar-inline-padding:12px; box-sizing:border-box; height:100%; min-height:0; display:flex; flex-direction:column; padding:12px; background:var(--dsw-alias-bg-layer-1); }
.sensteedContextSidebar[data-preview] { position:fixed; z-index:9000; left:52px; top:44px; bottom:8px; height:auto; width:304px; border:1px solid var(--dsw-alias-border-l1); border-radius:12px; box-shadow:0 8px 28px #0002; }
.sensteedContextSidebar { font-size:14px; line-height:20px; font-weight:400; }
.sensteedContextSidebar[hidden],.sensteedContextHome[hidden] { display:none; }
.sensteedBusinessNavigation { overflow-y:auto; min-height:0; padding:0 4px 12px; }
.sensteedBusinessNavigation h3,.sensteedContextGroup { font-size:12px; color:var(--dsw-alias-label-secondary); margin:18px 8px 6px; font-weight:500; }
.sensteedBusinessNavigation button { display:block; width:100%; min-height:34px; border:0; border-radius:8px; padding:7px 10px; background:transparent; color:inherit; text-align:left; cursor:pointer; font:inherit; font-size:14px; line-height:20px; font-weight:400; }
.sensteedBusinessNavigation button:hover,.sensteedBusinessNavigation button[aria-current="page"] { background:var(--dsw-alias-bg-layer-2); }
.sensteedBusinessNavigation small { display:block; margin-top:4px; color:var(--dsw-alias-label-secondary); font-size:11px; }
.sensteedBusinessNavigation button svg { vertical-align:middle; margin-right:6px; }
.sensteedContextSearch { display:flex; align-items:center; gap:6px; margin:12px 0; padding:7px; border:1px solid var(--dsw-alias-border-l1); border-radius:8px; }
.sensteedContextSearch input { width:100%; min-width:0; border:0; background:transparent; color:inherit; font:inherit; outline-offset:2px; }
.sensteedBusinessNavigationStatus { padding:12px; color:var(--dsw-alias-label-secondary); }
.sensteedContextHeader { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:0 0 12px 8px; }
.sensteedContextHeader strong { font-size:16px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sensteedContextHome { flex:1; display:flex; flex-direction:column; min-height:0; }
.sensteedContextHome > [data-slot="sidebar.workspaces"] { flex:1; min-height:0; }
.sensteedContextNew { display:flex; align-items:center; gap:10px; width:100%; min-height:36px; padding:0 10px; margin-bottom:12px; border:0; border-radius:8px; background:transparent; color:inherit; cursor:pointer; text-align:left; }
.sensteedContextNew:hover { background:var(--dsw-alias-bg-layer-2); }
.sensteedModuleContext { padding:8px; color:var(--dsw-alias-label-secondary); font-size:13px; line-height:1.7; }
.sensteedModuleContext button { color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-2); border:1px solid var(--dsw-alias-border-l1); border-radius:8px; padding:8px 12px; cursor:pointer; }
`
  document.head.append(style)
  return () => style.remove()
}
