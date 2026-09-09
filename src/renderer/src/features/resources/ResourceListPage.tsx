import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import type { KubeObject, ListRequest, ResourceEvent } from '@shared/types'
import { findResourceKind } from '@shared/types'
import ResourceTable from './ResourceTable'
import CreateModal from './CreateModal'
import { objKey, objName, objNamespace, sortItems } from './utils'

function applyEvent(items: KubeObject[], e: ResourceEvent): KubeObject[] {
  const key = objKey(e.object)
  const idx = items.findIndex((o) => objKey(o) === key)
  if (e.type === 'DELETED') {
    if (idx < 0) return items
    const next = items.slice()
    next.splice(idx, 1)
    return next
  }
  if (e.type !== 'ADDED' && e.type !== 'MODIFIED') return items
  const next = items.slice()
  if (idx >= 0) next[idx] = e.object
  else next.push(e.object)
  return next
}

export default function ResourceListPage() {
  const { resource } = useParams<{ resource: string }>()
  const [searchParams] = useSearchParams()
  const nsParam = searchParams.get('ns')
  const kind = resource ? findResourceKind(resource) : undefined

  // ?ns= grammar (see ARCHITECTURE.md): 'all'/empty/absent => all namespaces,
  // otherwise a comma-separated list of namespace names.
  const nsSelected = useMemo<string[]>(() => {
    if (!nsParam) return []
    const list = nsParam.split(',').map((s) => s.trim()).filter(Boolean)
    return list.length === 1 && list[0] === 'all' ? [] : list
  }, [nsParam])
  const allNamespaces = nsSelected.length === 0
  // Namespace column shows whenever we are not scoped to exactly one namespace.
  const showNamespace = !!kind?.namespaced && nsSelected.length !== 1

  const nsSet = useMemo(() => new Set(kind?.namespaced ? nsSelected : []), [kind, nsSelected])

  // For 0, 1 or many namespaces we always issue ONE request/watch:
  // many => list all namespaces once and filter client-side (avoids parallel watches).
  const req = useMemo<ListRequest | null>(() => {
    if (!kind) return null
    if (!kind.namespaced) return { scope: kind }
    if (nsSelected.length === 1) return { scope: kind, namespace: nsSelected[0] }
    return { scope: kind, allNamespaces: true }
  }, [kind, nsSelected])

  const [items, setItems] = useState<KubeObject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!req || !window.api) return
    let cancelled = false
    setLoading(true)
    setError(null)
    window.api.k8s
      .listResources(req)
      .then((list) => {
        if (cancelled) return
        setItems(sortItems(list, showNamespace))
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [req, reloadKey, showNamespace])

  useEffect(() => {
    if (!req || !window.api) return
    const id = crypto.randomUUID()
    const api = window.api
    void api.k8s.watchStart(id, req).catch(() => undefined)
    const off = api.events.onResourceEvent((e) => {
      if (e.id !== id) return
      // Ignore events outside the selected namespace set (multi-ns mode watches all).
      if (nsSet.size > 0 && !nsSet.has(objNamespace(e.object))) return
      setItems((prev) => {
        const next = applyEvent(prev, e)
        return next === prev ? prev : sortItems(next, showNamespace)
      })
    })
    return () => {
      off()
      void api.k8s.watchStop(id).catch(() => undefined)
    }
  }, [req, showNamespace, nsSet])

  const query = search.trim().toLowerCase()
  const visibleItems = useMemo(() => {
    let list = items
    if (nsSet.size > 0) list = list.filter((o) => nsSet.has(objNamespace(o)))
    if (query) list = list.filter((o) => objName(o).toLowerCase().includes(query))
    return list
  }, [items, nsSet, query])

  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(null), 5000)
    return () => window.clearTimeout(t)
  }, [notice])

  if (!kind) {
    return (
      <div className="page" style={{ padding: 24 }}>
        <h2>Unknown resource</h2>
        <p>
          No resource type named <code className="mono">{resource}</code> is known to mom-lens.
        </p>
        <p>
          Go back to the <Link to="/">cluster catalog</Link> and pick a resource from the list.
        </p>
      </div>
    )
  }

  const nsLabel = !kind.namespaced
    ? 'cluster-scoped'
    : allNamespaces
      ? 'all namespaces'
      : nsSelected.length === 1
        ? `namespace: ${nsSelected[0]}`
        : `namespaces: ${nsSelected.join(', ')}`
  const filtered = visibleItems.length !== items.length

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
      <div className="toolbar" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ margin: 0 }}>{kind.kind}</h2>
        <span className="chip">{filtered ? `${visibleItems.length} / ${items.length}` : items.length}</span>
        <span style={{ opacity: 0.7, fontSize: 12 }}>{nsLabel}</span>
        <span style={{ flex: 1 }} />
        <input
          className="search-input"
          type="text"
          placeholder={`Search ${kind.kind.toLowerCase()} by name…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 220, fontSize: 12, padding: '4px 8px' }}
        />
        {search && (
          <button className="btn" type="button" title="Clear search" onClick={() => setSearch('')}>
            ×
          </button>
        )}
        <button className="btn" type="button" onClick={() => setCreating(true)}>
          Create
        </button>
        <button
          className="btn"
          type="button"
          disabled={loading}
          onClick={() => setReloadKey((k) => k + 1)}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {notice && (
        <div className="chip" style={{ color: '#3fb950', whiteSpace: 'pre-wrap' }}>
          {notice}
        </div>
      )}

      {error && (
        <div className="chip" style={{ color: '#e5534b', whiteSpace: 'pre-wrap' }}>
          Error: {error}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div>Loading {kind.kind.toLowerCase()}…</div>
      ) : error && visibleItems.length === 0 ? (
        <div>Could not load {kind.resource}. Check that the cluster is reachable and your context has access.</div>
      ) : items.length === 0 ? (
        <div>No {kind.resource} found{kind.namespaced && !allNamespaces ? ` in ${nsLabel}` : ''}.</div>
      ) : visibleItems.length === 0 ? (
        <div>
          No {kind.kind.toLowerCase()} matches the current filters
          {query ? (
            <>
              {' '}
              for name “<span className="mono">{search.trim()}</span>”
            </>
          ) : null}
          .
        </div>
      ) : (
        <ResourceTable
          kind={kind}
          items={visibleItems}
          showNamespace={showNamespace}
          nsQuery={nsParam}
        />
      )}

      {creating && (
        <CreateModal
          kind={kind}
          namespace={nsSelected.length === 1 ? nsSelected[0] : null}
          onClose={() => setCreating(false)}
          onSaved={(message) => {
            setCreating(false)
            setNotice(message)
            setReloadKey((k) => k + 1)
          }}
        />
      )}
    </div>
  )
}
