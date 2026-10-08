import { useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import type { ContextInfo } from '@shared/types'
import ErrorBoundary from '@renderer/components/ui/ErrorBoundary'
import { ToastRegion } from '@renderer/components/ui/toast'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import type { ConnectionStatus } from './connection'

export interface ShellStatus {
  context: ContextInfo | null
  status: ConnectionStatus
  error: string | null
}

function getApi(): typeof window.api | undefined {
  return typeof window !== 'undefined' ? window.api : undefined
}

export default function AppLayout(): React.ReactElement {
  const location = useLocation()
  const [shell, setShell] = useState<ShellStatus>({ context: null, status: 'loading', error: null })
  const [reloadKey, setReloadKey] = useState(0)

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    const api = getApi()
    if (!api?.k8s?.currentContext) {
      setShell({ context: null, status: 'offline', error: null })
      return
    }
    setShell((s) => ({ ...s, status: 'loading', error: null }))
    api.k8s
      .currentContext()
      .then((res) => {
        if (cancelled) return
        setShell({
          context: res.context ?? null,
          status: res.context ? 'connected' : 'error',
          error: res.error?.hint
            ? `${res.error.message} — ${res.error.hint}`
            : (res.error?.message ?? 'No active kube context')
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setShell({
          context: null,
          status: 'error',
          error: err instanceof Error ? err.message : String(err)
        })
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  return (
    <div className="app-shell">
      <Sidebar shell={shell} onReload={reload} />
      <div className="app-main">
        <TopBar shell={shell} />
        <main className="app-content">
          {/*
           * B1: only the routed content is guarded, so the sidebar/topbar stay
           * usable when a page throws.
           * B1 auto-reset: `resetKey` is the router location (pathname + key —
           * `key` changes on every navigation, including a push to the same
           * URL). The boundary clears its captured error whenever it changes,
           * so navigating away/back (or clicking the same sidebar item again)
           * always retries the page instead of sticking on the panel.
           */}
          <ErrorBoundary resetKey={`${location.pathname}|${location.key}`}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      {/* One global stack for the whole shell (USX-04): toasts are queued in a
          module store, so a page unmounting mid-flight cannot take its own
          confirmation down with it. */}
      <ToastRegion />
    </div>
  )
}
