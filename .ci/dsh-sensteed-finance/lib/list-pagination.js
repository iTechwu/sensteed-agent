// Only complete catalog/evidence reads; caller-requested pages remain single-page.
export function needsCompleteList(path, query = {}) {
  if (query.page !== undefined || query.limit !== undefined) return false
  return /^\/finance\/(orgs|departments|budget\/versions|budget-snapshots|members|alert-rules|saved-views|carryover-rules)$/.test(path)
    || /^\/budget-engine\/versions\/[^/]+\/(params|sales-inputs|runs)$/.test(path)
    || /^\/budget-engine\/runs\/[^/]+\/outputs$/.test(path)
    || /^\/ce\/packages\/[^/]+\/(changes|quotes|param-versions|approvals)$/.test(path)
    || path === '/data-source/metrics'
}

export async function completeFinanceList(first, load) {
  // Permit the pre-pagination deployment during a coordinated rollout.
  if (Array.isArray(first) || Array.isArray(first?.orgs) || (first && Array.isArray(first.list) && first.total === undefined)) return first
  const list = [], ids = new Set()
  let current = first
  for (let page = 1; ; page++) {
    if (!current || !Array.isArray(current.list) || current.page !== page || !Number.isInteger(current.total) || current.total < 0 || !Number.isInteger(current.limit) || current.limit < 1 || current.list.length > current.limit) throw new Error('财务列表分页异常，请刷新重试')
    if (current.total !== first.total || current.limit !== first.limit) throw new Error('财务列表已变化，请刷新重试')
    for (const row of current.list) {
      if (typeof row?.id === 'string') {
        if (ids.has(row.id)) throw new Error('财务列表已变化，请刷新重试')
        ids.add(row.id)
      }
      list.push(row)
    }
    if (page * current.limit >= current.total) {
      if (list.length !== current.total) throw new Error('财务列表不完整，请刷新重试')
      return { ...first, list, page: 1, limit: Math.max(1, list.length) }
    }
    if (!current.list.length) throw new Error('财务列表不完整，请刷新重试')
    current = await load({ page: page + 1, limit: first.limit })
  }
}
