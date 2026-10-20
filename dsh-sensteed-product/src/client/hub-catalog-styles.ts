/** Catalog styles use the same semantic tokens as the Harness shell. */
const CSS = `
.dshHubPage{box-sizing:border-box;flex:1;min-width:0;height:100%;overflow:auto;padding:calc(32px + var(--dsh-frame-top-clearance,0px)) 40px 40px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}
.dshHubContent{max-width:1080px;margin:0 auto;display:flex;flex-direction:column;gap:24px}
.dshHubHeader{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px}
.dshHubHeader h1{display:flex;align-items:center;gap:12px;margin:0;font-size:24px;line-height:1.4;font-weight:600}
.dshHubHeader p{margin:8px 0 0;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:1.6}
.dshHubPage button,.dshHubSetup button{font:inherit;cursor:pointer}
.dshHubPage button:disabled,.dshHubSetup button:disabled{opacity:.5;cursor:default}
.dshHubPrimary{display:inline-flex;align-self:flex-start;align-items:center;justify-content:center;gap:8px;min-height:36px;padding:8px 16px;border:0;border-radius:8px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-size:13px!important}
.dshHubSecondary{display:inline-flex;align-self:flex-start;align-items:center;justify-content:center;min-height:36px;padding:6px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px!important}
.dshHubTabs{display:flex;gap:24px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dshHubTabs button{border:0;border-bottom:2px solid transparent;background:transparent;padding:8px 0 12px;font-size:14px;color:var(--dsw-alias-label-secondary)}
.dshHubTabs button[aria-pressed=true]{border-bottom-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary);font-weight:600}
.dshHubSetup{display:flex;flex-direction:column;gap:16px;min-width:0}
.dshHubSetup p{margin:0;line-height:1.6}
.dshHubSectionTitle{margin:0;font-size:16px;font-weight:600}
.dshHubToolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.dshHubSearch{display:flex;align-items:center;gap:8px;min-width:160px;flex:1;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:0 12px}
.dshHubSearch input{width:100%;min-width:0;border:0;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;height:36px}
.dshHubSearch:focus-within{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}
.dshHubPage select,.dshHubSetup select,.dshHubSkillSearch{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;min-height:36px;padding:6px 10px;max-width:100%}
.dshHubSkillSearch{box-sizing:border-box;width:100%;margin:12px 0 20px}
.dshHubCapabilityGroup{margin:24px 0}.dshHubCapabilityGroup h2{display:flex;align-items:center;gap:8px;font-size:16px;font-weight:600;margin:0 0 12px}.dshHubCapabilityGroup h2 small{font-size:12px;color:var(--dsw-alias-label-secondary);font-weight:400}.dshHubCapabilityGroup .dshDofePluginSummary{display:grid;gap:8px;line-height:1.6}.dshHubCapabilityGroup .dshDofePluginState{justify-self:start}.dshHubCapabilityGroup .dshHubSecondary{align-self:flex-start}
.dshHubCatalog{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px;list-style:none;padding:0;margin:0;align-items:start}
.dshHubCard{display:flex;flex-direction:column;gap:12px;min-width:0;padding:20px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-base)}
.dshHubCard h3{margin:0;font-size:15px;line-height:1.5;font-weight:600;overflow-wrap:anywhere}
.dshHubCardHeading{display:flex;align-items:center;gap:12px;min-width:0}
.dshHubGlyph{display:grid;place-items:center;flex:none;width:40px;height:40px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.dshHubCardTitle{min-width:0;flex:1}
.dshHubMeta,.dshHubHint{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.dshHubBadge{flex:none;font-size:11px;padding:2px 6px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.dshHubStatus{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.dshHubStatus[data-available=true]{color:var(--dsw-alias-label-primary)}
.dshHubCardFooter{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:auto}
.dshHubAction{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dshHubAction select{max-width:180px}
.dshHubDetails{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.6;overflow-wrap:anywhere}
.dshHubDetails summary{cursor:pointer;width:fit-content}
.dshHubDetails code{font-size:11px}
.dshHubEmpty{padding:48px 16px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:14px}
.dshHubPlan{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:12px;overflow-wrap:anywhere}
.dshHubPlan h3{margin:0;font-size:16px}
.dshHubPlan ul{padding-left:20px;display:grid;gap:16px;font-size:13px;line-height:1.6}
.dshHubPage :is(button,select,input,summary):focus-visible,.dshHubSetup :is(button,select,summary):focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:3px}
@media(max-width:700px){.dshHubPage{padding:calc(24px + var(--dsh-frame-top-clearance,0px)) 16px 24px}.dshHubCard{padding:16px}.dshHubContent{gap:20px}.dshHubHeader h1{font-size:22px}}
`
export function installHubCatalogStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.plugin = 'sensteed-hub-catalog'
  style.textContent = CSS
  document.head.append(style)
  return () => style.remove()
}
