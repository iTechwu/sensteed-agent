/** Profile 模板选择区（docs/1022 §6.3 Tab A）。渲染进程只发意图；身份与校验都在 Host。 */
import { useEffect, useRef, useState } from 'react'
import { LayoutTemplate } from 'lucide-react'
import { hubInstantiateRequest, hubTemplatePreviewRequest, hubTemplatesRequest, type HubInstantiateResult, type HubTemplatePreview, type HubTemplatePublic } from './hub-setup-state.ts'
import { trackHubTemplate } from './hub-analytics.ts'
import type { DofeAccessLocaleKey } from './dofe-access.ts'
type Copy = (key: DofeAccessLocaleKey) => string

const countsLine = (t: Copy, template: HubTemplatePublic): string =>
  `${template.counts.skills} ${t('templateCountSkills')} / ${template.counts.plugins} ${t('templateCountPlugins')} / ${template.counts.mcpEndpoints} MCP`

export function ProfileTemplatesSection({ disabled, t, onRegistered }: {
  disabled?: boolean
  t: Copy
  onRegistered?: (result: HubInstantiateResult) => void
}) {
  const [templates, setTemplates] = useState<HubTemplatePublic[] | undefined>(undefined)
  const [loadError, setLoadError] = useState(false)
  const [reloadEpoch, setReloadEpoch] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [registered, setRegistered] = useState<HubInstantiateResult | null>(null)
  const [previews, setPreviews] = useState<Record<string, HubTemplatePreview | undefined>>({})
  const [previewFailed, setPreviewFailed] = useState<Record<string, boolean>>({})
  const previewRequests = useRef(new Map<string, AbortController>())
  useEffect(() => () => { for (const request of previewRequests.current.values()) request.abort() }, [])
  const loadPreview = (templateId: string): void => {
    previewRequests.current.get(templateId)?.abort()
    const request = new AbortController(); previewRequests.current.set(templateId, request)
    setPreviews(current => ({ ...current, [templateId]: undefined })); setPreviewFailed(current => ({ ...current, [templateId]: false }))
    void hubTemplatePreviewRequest(templateId, request.signal).then(preview => {
      if (request.signal.aborted) return
      if (!Array.isArray(preview.items)) throw new Error('malformed preview')
      setPreviews(current => ({ ...current, [templateId]: preview }))
      const blocked = preview.items.filter(entry => entry.disposition === 'blocked')
      trackHubTemplate({ event: 'PROFILE_TEMPLATE_PREVIEWED', properties: { blockedCount: blocked.length } })
      if (blocked.length) trackHubTemplate({ event: 'PROFILE_TEMPLATE_BLOCKED_ITEM_SHOWN', properties: { itemCount: blocked.length } })
    }).catch(() => { if (!request.signal.aborted) setPreviewFailed(current => ({ ...current, [templateId]: true })) })
  }

  useEffect(() => {
    if (disabled) return
    const controller = new AbortController()
    hubTemplatesRequest(controller.signal)
      .then(result => {
        setTemplates(result.list); setLoadError(false)
        if (reloadEpoch === 0) trackHubTemplate({ event: 'PROFILE_TEMPLATE_VIEWED', properties: { surface: 'list' } })
      })
      .catch(() => { if (!controller.signal.aborted) { setTemplates([]); setLoadError(true) } })
    return () => controller.abort()
  }, [disabled, reloadEpoch])

  if (disabled) return null
  if (templates === undefined) return <p className="dshHubHint">{t('hubWorking')}</p>
  if (loadError) return (
    <p className="dshHubHint">
      {t('templateLoadFailed')}
      {' '}
      <button type="button" className="dshHubSecondary" onClick={() => { setLoadError(false); setTemplates(undefined); setReloadEpoch(value => value + 1) }}>
        {t('templateRetry')}
      </button>
    </p>
  )
  if (templates.length === 0) return null

  const chosen = templates.find(template => template.id === selected) ?? null
  const create = async () => {
    if (!chosen || busy || !previews[chosen.id] || previewFailed[chosen.id]) return
    const profileName = name.trim()
    if (!profileName) { setNotice(t('templateNameRequired')); return }
    setBusy(true); setNotice('')
    try {
      const result = await hubInstantiateRequest({ templateId: chosen.id, templateRevision: previews[chosen.id]!.revision, profileName })
      trackHubTemplate({
        event: 'PROFILE_TEMPLATE_INSTANTIATED',
        properties: { planCount: result.items.length, skippedCount: result.skippedItems.length },
      })
      // 阻断项显式呈现，禁止静默跳过（docs/1022 §2/§6.3）
      setRegistered(result.skippedItems.length > 0 ? result : null)
      if (result.skippedItems.length > 0) trackHubTemplate({ event: 'PROFILE_TEMPLATE_BLOCKED_ITEM_SHOWN', properties: { itemCount: result.skippedItems.length } })
      setNotice(t('templateRegistered'))
      setName(chosen.displayName)
      onRegistered?.(result)
    } catch {
      trackHubTemplate({
        event: 'PROFILE_TEMPLATE_INSTANTIATED',
        properties: { planCount: 0, skippedCount: 0, errorClass: 'error' },
      })
      setNotice(t('templateCreateFailed'))
    } finally { setBusy(false) }
  }

  return (
    <section className="dshHubTemplates" aria-label={t('templateTitle')}>
      <h2 className="dshHubTemplatesTitle"><LayoutTemplate size={16} aria-hidden="true" />{t('templateTitle')}</h2>
      <p className="dshHubHint">{t('templateIntro')}</p>
      <ul className="dshHubCatalog">
        {templates.map(template => (
          <li className="dshHubCard" key={template.id}>
            <button
              type="button"
              className="dshHubCardHeading"
              aria-expanded={selected === template.id}
              onClick={() => {
                if (selected !== template.id) {
                  trackHubTemplate({ event: 'PROFILE_TEMPLATE_SELECTED', properties: { source: 'template' } })
                  setName(template.displayName)
                  loadPreview(template.id)
                }
                setSelected(selected === template.id ? null : template.id); setNotice('')
              }}
            >
              <span className="dshHubGlyph" aria-hidden="true">{template.displayName.slice(0, 1)}</span>
              <h3>{template.displayName}</h3>
              <span className="dshHubHint">{countsLine(t, template)}</span>
            </button>
            {selected === template.id ? (
              <div>
                <p className="dshHubHint">{template.description}</p>
                <p className="dshHubHint">
                  {template.useCases.map(useCase => <span key={useCase} className="dshHubChip">{useCase}</span>)}
                </p>
                {previews[template.id] ? (
                  <div className="dshHubSkipped">
                    <p>{t('templatePreviewTitle')}</p>
                    <ul>
                      {previews[template.id]!.items.map((entry, index) => {
                        const symbol = entry.item.kind === 'mcp.endpoint' ? `${entry.item.service}/${entry.item.domain}` : entry.item.identity ?? ''
                        return <li key={`${symbol}-${index}`}><code>{symbol}</code> — {entry.disposition === 'blocked' ? `${t('templatePreviewBlocked')}：${entry.reason ?? ''}` : t('templatePreviewInstallable')}</li>
                      })}
                    </ul>
                  </div>
                ) : previewFailed[template.id] ? <p role="alert" className="dshHubHint">{t('templatePreviewFailed')} <button type="button" onClick={() => loadPreview(template.id)}>{t('templateRetry')}</button></p> : <p className="dshHubHint">{t('hubWorking')}</p>}
                <label className="dshHubHint">
                  {t('templateNameLabel')}
                  <input
                    type="text"
                    value={name}
                    maxLength={24}
                    placeholder={`${template.displayName}`}
                    onChange={event => setName(event.target.value)}
                  />
                </label>
                <button type="button" className="dshHubSecondary" disabled={busy || !previews[template.id] || previewFailed[template.id]} onClick={() => { void create() }}>
                  {busy ? t('hubWorking') : t('templateCreate')}
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {registered ? (
        <div role="alert" className="dshHubSkipped">
          <p>{t('templateSkippedTitle')}</p>
          <ul>
            {registered.skippedItems.map((skipped, index) => {
              const item = skipped.item as { kind?: string; identity?: string; service?: string; domain?: string }
              const symbol = item.kind === 'mcp.endpoint' ? `${item.service}/${item.domain}` : item.identity ?? ''
              return <li key={`${symbol}-${index}`}><code>{symbol}</code> — {skipped.reason}</li>
            })}
          </ul>
        </div>
      ) : null}
      <p role="status" className="dshHubHint">{notice}</p>
    </section>
  )
}
