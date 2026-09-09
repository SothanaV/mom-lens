import { useMemo } from 'react'
import { Link, matchPath, useLocation, useSearchParams } from 'react-router-dom'
import { findResourceKind } from '@shared/types'
import type { ShellStatus } from './AppLayout'
import { connectionMeta } from './connection'
import NamespaceSelect, { namespaceSummary, parseNamespaceSelection } from './NamespaceSelect'

interface TopBarProps {
  shell: ShellStatus
}

const LIST_PATH = '/cluster/resources/:resource'
const DETAIL_PATH = '/cluster/resources/:resource/:namespace/:name'

export default function TopBar({ shell }: TopBarProps): React.ReactElement {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()

  const route = useMemo(() => {
    const detail = matchPath(DETAIL_PATH, location.pathname)
    const list = detail ? null : matchPath(LIST_PATH, location.pathname)
    const resource = detail?.params.resource ?? list?.params.resource
    return {
      detail,
      resource,
      kind: resource ? findResourceKind(resource) : undefined
    }
  }, [location.pathname])

  const ns = searchParams.get('ns') ?? 'all'
  const nsSelection = parseNamespaceSelection(ns)
  const namespaced = route.kind ? route.kind.namespaced : true
  const meta = connectionMeta(shell.status)

  const setNamespace = (value: string): void => {
    const next = new URLSearchParams(searchParams)
    next.set('ns', value)
    setSearchParams(next, { replace: true })
  }

  const crumbLabel = route.kind
    ? route.kind.kind
    : route.resource
      ? route.resource
      : location.pathname.startsWith('/cluster/overview')
        ? 'Overview'
        : 'Catalog'

  return (
    <header className="topbar">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/" className="crumb" title={shell.context?.name ?? 'mom-lens'}>
          {shell.context?.name ?? 'mom-lens'}
        </Link>
        <span className="crumb-sep">/</span>
        {route.kind && route.resource ? (
          <Link to={`/cluster/resources/${route.resource}`} className="crumb">
            {crumbLabel}
          </Link>
        ) : (
          <span className="crumb current">{crumbLabel}</span>
        )}
        {route.detail?.params.name && (
          <>
            <span className="crumb-sep">/</span>
            <span className="crumb current mono">{route.detail.params.name}</span>
          </>
        )}
        {route.kind && route.kind.namespaced && !nsSelection.all && (
          <>
            <span className="crumb-sep">·</span>
            <span className="crumb ns-crumb" title={ns}>
              {namespaceSummary(ns)}
            </span>
          </>
        )}
      </nav>

      <div className="topbar-right">
        <div className="ns-picker" title={namespaced ? 'Namespace scope' : 'Cluster-scoped resource'}>
          <span className="ns-label">Namespace</span>
          <NamespaceSelect
            value={ns}
            onChange={setNamespace}
            disabled={!namespaced}
            contextKey={shell.context?.name ?? ''}
          />
        </div>
        <span className={`conn ${meta.className}`}>
          <span className={`status-dot ${meta.className}`} />
          {meta.label}
        </span>
      </div>
    </header>
  )
}
