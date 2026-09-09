import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ContextInfo, KubeContext, SoLensApi } from '@shared/types'

type LoadState = 'loading' | 'ready' | 'empty' | 'error' | 'unavailable'

function isApiAvailable(api: SoLensApi | undefined): api is SoLensApi {
  return !!api && !!api.k8s
}

export default function CatalogPage(): React.ReactElement {
  const navigate = useNavigate()
  const api: SoLensApi | undefined = window.api

  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [contexts, setContexts] = useState<KubeContext[]>([])
  const [current, setCurrent] = useState<ContextInfo | null>(null)
  const [switching, setSwitching] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (!isApiAvailable(api)) {
      setState('unavailable')
      return
    }
    setState('loading')
    setError(null)
    try {
      const [ctxRes, curRes] = await Promise.allSettled([
        api.k8s.listContexts(),
        api.k8s.currentContext()
      ])
      if (ctxRes.status === 'rejected') {
        throw ctxRes.reason
      }
      const list = ctxRes.value ?? []
      setContexts(list)
      setCurrent(curRes.status === 'fulfilled' ? curRes.value : null)
      setState(list.length === 0 ? 'empty' : 'ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setState('error')
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  const selectContext = useCallback(
    async (name: string): Promise<void> => {
      if (!isApiAvailable(api) || switching) return
      setSwitching(name)
      setError(null)
      try {
        const info = await api.k8s.useContext(name)
        setCurrent(info)
        navigate('/cluster/overview')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setSwitching(null)
      }
    },
    [api, navigate, switching]
  )

  const activeName = current?.name ?? contexts.find((c) => c.current)?.name
  const activeNs = contexts.find((c) => c.name === activeName)?.namespace

  return (
    <div style={{ padding: 24, maxWidth: 1040, margin: '0 auto' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Welcome to mom-lens</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--text-dim)' }}>
          Select a Kubernetes context to connect to a cluster.
        </p>
      </header>

      {current && (
        <section className="panel" style={{ padding: 14, marginBottom: 20 }}>
          <div style={{ color: 'var(--text-dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>
            Current Connection
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <ConnField label="Context" value={current.name} />
            <ConnField label="Cluster" value={current.cluster} />
            <ConnField label="Server" value={current.server} mono />
            <ConnField label="User" value={current.user} mono />
            <ConnField label="Namespace" value={activeNs ?? 'default'} mono />
          </div>
        </section>
      )}

      {error && (
        <div style={{ marginBottom: 16, padding: 10, borderRadius: 6, border: '1px solid #e5534b55', background: '#e5534b18', color: '#e5534b' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
          Clusters {state === 'ready' ? `(${contexts.length})` : ''}
        </h2>
        <button className="btn" onClick={() => void load()} disabled={state === 'loading'}>
          {state === 'loading' ? 'Reloading…' : 'Reload'}
        </button>
      </div>

      {state === 'unavailable' && (
        <StateNote text="Electron API (window.api) is not available. mom-lens must run inside the Electron app." />
      )}

      {state === 'loading' && <StateNote text="Loading kube contexts…" />}

      {state === 'empty' && (
        <StateNote text="No kube contexts found. Check your KUBECONFIG / kubeconfig." />
      )}

      {state === 'ready' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
          {contexts.map((ctx) => {
            const active = ctx.name === activeName || ctx.current === true
            const busy = switching === ctx.name
            return (
              <button
                key={ctx.name}
                className="panel"
                onClick={() => void selectContext(ctx.name)}
                disabled={busy}
                style={{
                  textAlign: 'left',
                  cursor: busy ? 'progress' : 'pointer',
                  padding: 14,
                  border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
                  opacity: switching && !busy ? 0.55 : 1
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{ctx.name}</span>
                  {active ? (
                    <span className="chip" style={{ color: '#7fd18a', borderColor: '#7fd18a55' }}>active</span>
                  ) : busy ? (
                    <span className="chip">connecting…</span>
                  ) : null}
                </div>
                <div style={{ display: 'grid', gap: 4, color: 'var(--text-dim)', fontSize: 12 }}>
                  <Meta label="cluster" value={ctx.cluster} />
                  <Meta label="user" value={ctx.user} mono />
                  {ctx.namespace ? <Meta label="ns" value={ctx.namespace} mono /> : null}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ConnField({ label, value, mono }: { label: string; value: string; mono?: boolean }): React.ReactElement {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ color: 'var(--text-dim)', fontSize: 11, marginBottom: 2 }}>{label}</div>
      <div className={mono ? 'mono' : undefined} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={value}>
        {value || '—'}
      </div>
    </div>
  )
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }): React.ReactElement {
  return (
    <div style={{ display: 'flex', gap: 6, minWidth: 0 }}>
      <span style={{ minWidth: 44 }}>{label}</span>
      <span className={mono ? 'mono' : undefined} style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={value}>
        {value}
      </span>
    </div>
  )
}

function StateNote({ text }: { text: string }): React.ReactElement {
  return (
    <div className="panel" style={{ padding: 20, color: 'var(--text-dim)', textAlign: 'center' }}>
      {text}
    </div>
  )
}
