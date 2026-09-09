import { useCallback, useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import type { ContextInfo } from '@shared/types'
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
      .then((ctx) => {
        if (cancelled) return
        setShell({
          context: ctx,
          status: ctx ? 'connected' : 'error',
          error: ctx ? null : 'No active kube context'
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
          <Outlet />
        </main>
      </div>
    </div>
  )
}
