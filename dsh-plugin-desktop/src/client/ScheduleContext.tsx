/** Project the native task catalog; never issue a second task query. */
import { useState, useSyncExternalStore } from 'react'
import { Plus, Search } from 'lucide-react'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScheduleCatalogEntry } from '@deepseek-ai/dsh-schedule/client'

/** Narrow read-only face of the native manager's injected catalog. */
export interface ScheduleContextSource {
  hooks: { catalog: HostObservable<{ records: readonly ScheduleCatalogEntry[]; status: 'loading' | 'ready' | 'error'; settled: boolean; readRequest: number }> }
  onNewTask: () => void
  onOpenSession: (id: ScheduleCatalogEntry['sessionId']) => void
  onRetry: (since: number) => unknown
}

export function ScheduleContext({ source }: { source: ScheduleContextSource | undefined }) {
  return source ? <ScheduleCatalogContext {...source} /> : <p role="status">正在加载任务导航…</p>
}
function ScheduleCatalogContext({ hooks, onNewTask, onOpenSession, onRetry }: ScheduleContextSource) {
  const catalog = useSyncExternalStore(hooks.catalog.subscribe, hooks.catalog.getSnapshot, hooks.catalog.getSnapshot)
  const [query, setQuery] = useState('')
  const records = catalog.records.filter(task => task.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <nav className="sensteedBusinessNavigation" aria-label="自动化任务导航">
    <button type="button" onClick={onNewTask}><Plus size={16} /> 新建任务</button>
    <label className="sensteedContextSearch"><Search size={15} /><input type="search" aria-label="搜索自动化任务" placeholder="搜索任务" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <h3>任务与会话</h3>
    {catalog.status === 'error' ? <><p role="alert">任务加载失败</p><button type="button" onClick={() => { void onRetry(catalog.readRequest) }}>重新加载</button></>
      : !catalog.settled ? <p role="status">正在加载任务…</p>
      : records.length === 0 ? <p role="status">{query ? '没有匹配的任务' : '暂无自动化任务'}</p>
      : records.map(task => <button key={task.id} type="button" onClick={() => onOpenSession(task.sessionId)} title="打开任务所属会话"><span>{task.title}</span><small>{task.status === 'active' ? '已开启' : '已结束'}</small></button>)}
  </nav>
}
