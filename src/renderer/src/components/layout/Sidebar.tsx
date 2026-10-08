import { useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { RESOURCE_CATALOG } from '@shared/types'
import type { KubeContext, ResourceKind } from '@shared/types'
import type { ShellStatus } from './AppLayout'
import { toKubeApiError } from '@renderer/components/ui/CallError'
import { pushToast } from '@renderer/components/ui/toast'
import { connectionMeta } from './connection'

interface SidebarProps {
  shell: ShellStatus
  onReload: () => void
}

function getApi(): typeof window.api | undefined {
  return typeof window !== 'undefined' ? window.api : undefined
}

function pluralize(kind: string): string {
  if (/(s|x|z|ch|sh)$/i.test(kind)) return `${kind}es`
  if (/[^aeiou]y$/i.test(kind)) return `${kind.slice(0, -1)}ies`
  return `${kind}s`
}

function groupByCategory(kinds: ResourceKind[]): [string, ResourceKind[]][] {
  const groups: [string, ResourceKind[]][] = []
  for (const kind of kinds) {
    const found = groups.find(([category]) => category === kind.category)
    if (found) found[1].push(kind)
    else groups.push([kind.category, [kind]])
  }
  return groups
}

export default function Sidebar({ shell, onReload }: SidebarProps): React.ReactElement {
  const location = useLocation()
  const [contexts, setContexts] = useState<KubeContext[]>([])
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    let cancelled = false
    const api = getApi()
    if (!api?.k8s?.listContexts) return
    api.k8s
      .listContexts()
      .then((res) => {
        if (!cancelled) setContexts(res.items)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [shell.context])

  const groups = useMemo(() => groupByCategory(RESOURCE_CATALOG), [])
  const nsParam = useMemo(() => new URLSearchParams(location.search).get('ns'), [location.search])
  const nsSearch = nsParam ? `?ns=${encodeURIComponent(nsParam)}` : ''
  const resourceHref = (resource: string): string => `/cluster/resources/${resource}${nsSearch}`
  const clusterLabel = shell.context ? shell.context.cluster || shell.context.name : 'No cluster'
  const meta = connectionMeta(shell.status)

  const switchContext = async (name: string): Promise<void> => {
    const api = getApi()
    if (!api?.k8s?.useContext || switching || !name) return
    setSwitching(true)
    try {
      const info = await api.k8s.useContext(name)
      pushToast({ tone: 'success', title: `Connected to ${info.name}` })
    } catch (err) {
      // Was `catch {}`: the shell reload below just re-rendered the old state,
      // so a failed switch looked like a click that did nothing. The sidebar
      // status line is too easy to miss, so the reason goes out as a toast and
      // Retry is offered right there.
      const failure = toKubeApiError(err)
      // Stable key: a failed RETRY replaces this toast in its slot instead of
      // stacking a second identical error (repeat failures stay one readable
      // line; the count never inflates the stack).
      pushToast({
        key: `context-switch:${name}`,
        tone: 'error',
        title: `Could not switch to ${name}`,
        message: failure.hint ? `${failure.message} — ${failure.hint}` : failure.message,
        action: { label: 'Retry', onClick: () => void switchContext(name) }
      })
    } finally {
      setSwitching(false)
      onReload()
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand">
          mom<span className="brand-accent">-lens</span>
        </div>
        <div className="cluster-row">
          <span className={`status-dot ${meta.className}`} />
          <span className="cluster-name" title={clusterLabel}>
            {clusterLabel}
          </span>
        </div>
        <div className="cluster-status">
          {shell.error ? (
            <>
              <span className="error-text" title={shell.error}>
                {shell.error}
              </span>{' '}
              <button className="link-btn" onClick={onReload}>
                retry
              </button>
            </>
          ) : (
            meta.label
          )}
        </div>
      </div>

      <nav className="sidebar-nav">
        <NavLink to="/cluster/overview" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          Overview
        </NavLink>
        <NavLink
          to="/cluster/ai"
          className={({ isActive }) => `nav-item nav-ai${isActive ? ' active' : ''}`}
        >
          <span className="nav-ai-icon" aria-hidden="true">
            ✦
          </span>
          AI Assistant
        </NavLink>
        {groups.map(([category, kinds]) => (
          <div className="nav-group" key={category}>
            <div className="nav-group-title">{category}</div>
            {kinds.map((kind) => (
              <NavLink
                key={kind.resource}
                to={resourceHref(kind.resource)}
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                title={`${kind.kind} · ${kind.group || 'core'}/${kind.version}`}
              >
                {pluralize(kind.kind)}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {contexts.length > 1 && (
        <div className="sidebar-footer">
          <select
            className="select"
            aria-label="Switch kube context"
            disabled={switching}
            value={shell.context?.name ?? ''}
            onChange={(e) => void switchContext(e.target.value)}
          >
            <option value="" disabled>
              Switch context…
            </option>
            {contexts.map((ctx) => (
              <option key={ctx.name} value={ctx.name}>
                {ctx.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </aside>
  )
}
