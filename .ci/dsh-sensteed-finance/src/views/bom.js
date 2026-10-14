// 成本 BOM 读视图：复用 CE 契约，金额为元，汇总只采用服务端成本树正算结果。
function BomView({ ctx, t }) {
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(null)
  const [packages, setPackages] = useState(null)
  const [listError, setListError] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailError, setDetailError] = useState(null)
  const [rollup, setRollup] = useState(null)
  const [rollupError, setRollupError] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    setPackages(null); setListError(null)
    api(`/bom/packages?page=${page}&limit=${PAGE_SIZE}`)
      .then(result => { if (!cancelled) setPackages(result.data) })
      .catch(error => { if (!cancelled) setListError(error.message) })
    return () => { cancelled = true }
  }, [page, ctx.revision, retry])

  useEffect(() => {
    let cancelled = false
    setDetail(null); setDetailError(null); setRollup(null); setRollupError(false)
    if (!selected) return undefined
    const path = `/bom/packages/${encodeURIComponent(selected)}`
    void api(path).then(result => { if (!cancelled) setDetail(result.data) })
      .catch(error => { if (!cancelled) setDetailError(error.message) })
    void api(`${path}/rollup`).then(result => { if (!cancelled) setRollup(result.data) })
      .catch(() => { if (!cancelled) setRollupError(true) })
    return () => { cancelled = true }
  }, [selected, ctx.revision, retry])

  const amount = value => formatNumber(value) ?? t('dash')
  const errorBlock = message => h('div', { role: 'alert', className: 'sf-fatal' }, h('strong', null, t('loadError')), h('span', null, message), h(GhostButton, { onClick: () => setRetry(value => value + 1) }, t('retry')))
  const loading = h('div', { className: 'sf-loading', role: 'status' }, t('loading'))
  const entries = new Map((rollup?.entries || []).map(entry => [entry.nodeId, entry]))
  return h('div', null,
    h('p', { className: 'sf-desc' }, t('bomScope')),
    h(Card, { title: t('bomPackages'), unit: t('unitYuan') },
      listError ? errorBlock(listError) : !packages ? loading : h(React.Fragment, null,
        h(Table, { tableId: 'bom-packages', rows: packages.list || [], empty: t('empty'), columns: [
          { key: 'name', label: t('bomPackages'), render: row => h(GhostButton, { onClick: () => setSelected(row.id), 'aria-pressed': row.id === selected }, row.name) },
          { key: 'modelCode', label: t('bomModel') },
          { key: 'version', label: t('bomVersion') },
          { key: 'status', label: t('bomStatus'), render: row => t(`bomStatus${row.status}`) },
          { key: 'targetCost', label: `${t('bomTarget')} (${t('unitYuan')})`, render: row => amount(row.targetCost) },
        ] }),
        h(Pager, { page, total: packages.total, limit: PAGE_SIZE, onPage: setPage }))),
    selected ? h(Card, { title: detail?.package?.name || t('bomDetail'), unit: t('unitYuan') },
      detailError ? errorBlock(detailError) : !detail ? loading : h(React.Fragment, null,
        h('div', { className: 'sf-kpis' },
          h(KpiCard, { label: t('bomTotal'), value: amount(detail.totalCost) }),
          h(KpiCard, { label: t('bomTarget'), value: amount(detail.targetCost) }),
          h(KpiCard, { label: t('bomNodeCount'), value: detail.nodeCount }),
          h(KpiCard, { label: t('bomLeafCount'), value: detail.leafCount })),
        rollupError ? h('p', { role: 'alert' }, t('bomRollupError'), ' ', h(GhostButton, { onClick: () => setRetry(value => value + 1) }, t('retry'))) : null,
        h(Table, { tableId: 'bom-nodes', rows: detail.nodes || [], empty: t('empty'), columns: [
          { key: 'partNo', label: t('bomPart') },
          { key: 'name', label: t('bomName') },
          { key: 'level', label: t('bomLevel') },
          { key: 'qty', label: t('bomQty') },
          { key: 'unitCost', label: `${t('bomUnit')} (${t('unitYuan')})`, render: row => amount(row.unitCost) },
          { key: 'extendedCost', label: `${t('bomExtended')} (${t('unitYuan')})`, sortValue: row => entries.get(row.id)?.extendedCost, render: row => amount(entries.get(row.id)?.extendedCost) },
        ] }))) : h('p', { className: 'sf-desc' }, t('bomSelect')))
}
