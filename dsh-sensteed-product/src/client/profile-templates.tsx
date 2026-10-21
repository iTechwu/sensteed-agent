/** Profile 模板选择区（docs/1022 §6.3 Tab A）。渲染进程只发意图；身份与校验都在 Host。 */
import { useEffect, useState } from 'react'
import { LayoutTemplate } from 'lucide-react'
import { hubInstantiateRequest, hubTemplatesRequest, type HubInstantiateResult, type HubTemplatePublic } from './hub-setup-state.ts'
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
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (disabled) return
    const controller = new AbortController()
    hubTemplatesRequest(controller.signal)
      .then(result => { setTemplates(result.list); setLoadError(false) })
      .catch(() => { if (!controller.signal.aborted) { setTemplates([]); setLoadError(true) } })
    return () => controller.abort()
  }, [disabled])

  if (disabled) return null
  if (templates === undefined) return <p className="dshHubHint">{t('hubWorking')}</p>
  if (loadError) return <p className="dshHubHint">{t('templateLoadFailed')}</p>
  if (templates.length === 0) return null

  const chosen = templates.find(template => template.id === selected) ?? null
  const create = async () => {
    if (!chosen || busy) return
    const profileName = name.trim()
    if (!profileName) { setNotice(t('templateNameRequired')); return }
    setBusy(true); setNotice('')
    try {
      const result = await hubInstantiateRequest({ templateId: chosen.id, profileName })
      setNotice(t('templateRegistered'))
      setName('')
      onRegistered?.(result)
    } catch { setNotice(t('templateCreateFailed')) } finally { setBusy(false) }
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
              onClick={() => { setSelected(selected === template.id ? null : template.id); setNotice('') }}
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
                <button type="button" className="dshHubSecondary" disabled={busy} onClick={() => { void create() }}>
                  {busy ? t('hubWorking') : t('templateCreate')}
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <p role="status" className="dshHubHint">{notice}</p>
    </section>
  )
}
