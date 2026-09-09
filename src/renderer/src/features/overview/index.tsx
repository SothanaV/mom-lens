import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiVersionOf, findResourceKind } from '@shared/types'
import type {
  ContextInfo,
  KubeObject,
  NodeMetrics,
  PodMetrics,
  ResourceKind,
  SoLensApi
} from '@shared/types'

interface NodeStatusView {
  conditions?: { type?: string; status?: string }[]
  nodeInfo?: { kubeletVersion?: string }
}

interface NodeRow {
  name: string
  ready: boolean
  version: string
  cpuPct: number | null
  memPct: number | null
}

interface Snapshot {
  context: ContextInfo | null
  nodes: KubeObject[]
  namespaces: number
  pods: number
  deployments: number
  services: number
  nodeMetrics: NodeMetrics[]
  podMetrics: PodMetrics[]
  error: string | null
}

const EMPTY: Snapshot = {
  context: null,
  nodes: [],
  namespaces: 0,
  pods: 0,
  deployments: 0,
  services: 0,
  nodeMetrics: [],
  podMetrics: [],
  error: null
}

function requireKind(resource: string): ResourceKind {
  const k = findResourceKind(resource)
  if (!k) throw new Error(`Unknown resource kind: ${resource}`)
  return k
}

const PODS = requireKind('pods')
const DEPLOYMENTS = requireKind('deployments')
const SERVICES = requireKind('services')

function pick<T,>(res: PromiseSettledResult<T>): T | undefined {
  return res.status === 'fulfilled' ? res.value : undefined
}

function pct(used: number | undefined, cap: number | undefined): number | null {
  if (used == null || cap == null || cap <= 0) return null
  return (used / cap) * 100
}

function formatCpu(nano: number | undefined): string {
  if (nano == null || !isFinite(nano)) return '—'
  const cores = nano / 1e9
  if (cores >= 1) return `${cores.toFixed(2)} cores`
  return `${(nano / 1e6).toFixed(0)}m`
}

function formatBytes(bytes: number | undefined): string {
  if (bytes == null || !isFinite(bytes)) return '—'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

function formatGiB(bytes: number | undefined): string {
  if (bytes == null || !isFinite(bytes)) return '—'
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`
}

function nodeView(node: KubeObject, metric: NodeMetrics | undefined): NodeRow {
  const status = node.status as NodeStatusView | undefined
  const ready = status?.conditions?.some((c) => c.type === 'Ready' && c.status === 'True') ?? false
  return {
    name: node.metadata?.name ?? '—',
    ready,
    version: status?.nodeInfo?.kubeletVersion ?? '—',
    cpuPct: pct(metric?.cpuNano, metric?.cpuCapacityNano),
    memPct: pct(metric?.memBytes, metric?.memCapacityBytes)
  }
}

export default function OverviewPage(): React.ReactElement {
  const api: SoLensApi | undefined = window.api
  const hasApi = !!api && !!api.k8s

  const [snap, setSnap] = useState<Snapshot>(EMPTY)
  const [loading, setLoading] = useState<boolean>(hasApi)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (!hasApi || !api) return
    setLoading(true)
    try {
      const [ctx, nodes, ns, pods, dep, svc, tn, tp] = await Promise.allSettled([
        api.k8s.currentContext(),
        api.k8s.listNodes(),
        api.k8s.listNamespaces(),
        api.k8s.listResources({ scope: PODS, allNamespaces: true }),
        api.k8s.listResources({ scope: DEPLOYMENTS, allNamespaces: true }),
        api.k8s.listResources({ scope: SERVICES, allNamespaces: true }),
        api.k8s.topNodes(),
        api.k8s.topPods()
      ])

      const nodesVal = pick(nodes)
      const nsVal = pick(ns)
      const podsVal = pick(pods)
      const depVal = pick(dep)
      const svcVal = pick(svc)

      let error: string | null = null
      if (nodes.status === 'rejected') {
        error = nodes.reason instanceof Error ? nodes.reason.message : String(nodes.reason)
      }

      setSnap({
        context: pick(ctx) ?? null,
        nodes: nodesVal ?? [],
        namespaces: nsVal?.length ?? 0,
        pods: podsVal?.length ?? 0,
        deployments: depVal?.length ?? 0,
        services: svcVal?.length ?? 0,
        nodeMetrics: pick(tn) ?? [],
        podMetrics: pick(tp) ?? [],
        error
      })
      setUpdatedAt(Date.now())
    } catch (err) {
      setSnap((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setLoading(false)
    }
  }, [api, hasApi])

  useEffect(() => {
    if (!hasApi) return
    void load()
    const id = setInterval(() => void load(), 15000)
    return () => clearInterval(id)
  }, [hasApi, load])

  const metricsByName = useMemo(() => {
    const m = new Map<string, NodeMetrics>()
    for (const nm of snap.nodeMetrics) m.set(nm.name, nm)
    return m
  }, [snap.nodeMetrics])

  const rows = useMemo(
    () => snap.nodes.map((n) => nodeView(n, metricsByName.get(n.metadata?.name ?? ''))),
    [snap.nodes, metricsByName]
  )

  const topPods = useMemo(() => {
    return [...snap.podMetrics]
      .sort((a, b) => (b.cpuNano ?? 0) - (a.cpuNano ?? 0))
      .slice(0, 12)
  }, [snap.podMetrics])

  const readyNodes = rows.filter((r) => r.ready).length
  const hasMetrics = snap.nodeMetrics.length > 0

  const cpuTotal = totalOf(
    snap.nodeMetrics,
    (m) => m.cpuNano,
    (m) => m.cpuCapacityNano
  )
  const memTotal = totalOf(
    snap.nodeMetrics,
    (m) => m.memBytes,
    (m) => m.memCapacityBytes
  )

  if (!hasApi) {
    return (
      <Empty text="Electron API (window.api) is not available. mom-lens must run inside the Electron app." />
    )
  }

  return (
    <div style={{ padding: 20, maxWidth: 1160, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18, gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Cluster Overview</h1>
          <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {snap.context ? (
              <>
                <span className="chip">{snap.context.name}</span>
                <span className="mono" title={snap.context.server}>{snap.context.server}</span>
                <span>@ {snap.context.user}</span>
              </>
            ) : (
              <span>Not connected</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {updatedAt && (
            <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
              {loading ? 'refreshing…' : `updated ${new Date(updatedAt).toLocaleTimeString()}`}
            </span>
          )}
          <button className="btn" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
        </div>
      </header>

      {snap.error && (
        <div style={{ marginBottom: 16, padding: 10, borderRadius: 6, border: '1px solid #e5534b55', background: '#e5534b18', color: '#e5534b', fontSize: 12 }}>
          {snap.error}
        </div>
      )}

      {!hasMetrics && !loading && (
        <div style={{ marginBottom: 16, padding: 10, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elev)', color: 'var(--text-dim)', fontSize: 12 }}>
          metrics-server not detected — resource usage is unavailable, showing counts only.
        </div>
      )}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        <Tile label="Nodes" value={`${readyNodes}/${rows.length}`} to="/cluster/resources/nodes" accent />
        <Tile label="Namespaces" value={snap.namespaces} to="/cluster/resources/namespaces" />
        <Tile label="Pods" value={snap.pods} to="/cluster/resources/pods" />
        <Tile label="Deployments" value={snap.deployments} to="/cluster/resources/deployments" />
        <Tile label="Services" value={snap.services} to="/cluster/resources/services" />
      </section>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 12,
          marginBottom: 20
        }}
      >
        <UsageTile
          label="CPU"
          hasData={hasMetrics}
          used={cpuTotal.used}
          capacity={cpuTotal.cap}
          format={formatCpu}
        />
        <UsageTile
          label="Memory"
          hasData={hasMetrics}
          used={memTotal.used}
          capacity={memTotal.cap}
          format={formatGiB}
        />
      </section>

      <section className="panel" style={{ padding: 14, marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600 }}>
          Nodes <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>({rows.length})</span>
        </h2>
        {rows.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', padding: 12 }}>{loading ? 'Loading nodes…' : 'No nodes found.'}</div>
        ) : (
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--text-dim)', textAlign: 'left', fontSize: 11 }}>
                <th style={{ padding: '6px 8px' }}>Name</th>
                <th style={{ padding: '6px 8px' }}>Status</th>
                <th style={{ padding: '6px 8px' }}>CPU</th>
                <th style={{ padding: '6px 8px' }}>Memory</th>
                <th style={{ padding: '6px 8px' }}>Version</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px' }} className="mono">{r.name}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <span className="chip" style={{ color: r.ready ? '#7fd18a' : '#e5534b', borderColor: r.ready ? '#7fd18a55' : '#e5534b55' }}>
                      {r.ready ? 'Ready' : 'NotReady'}
                    </span>
                  </td>
                  <td style={{ padding: '6px 8px', width: 160 }}><Meter pct={r.cpuPct} /></td>
                  <td style={{ padding: '6px 8px', width: 160 }}><Meter pct={r.memPct} /></td>
                  <td style={{ padding: '6px 8px' }} className="mono">{r.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel" style={{ padding: 14 }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600 }}>Top Pods</h2>
        {topPods.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', padding: 12 }}>
            {loading ? 'Loading pod metrics…' : hasMetrics ? 'No pod metrics available.' : 'Pod metrics unavailable (metrics-server).'}
          </div>
        ) : (
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--text-dim)', textAlign: 'left', fontSize: 11 }}>
                <th style={{ padding: '6px 8px' }}>Namespace</th>
                <th style={{ padding: '6px 8px' }}>Pod</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>CPU</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Memory</th>
              </tr>
            </thead>
            <tbody>
              {topPods.map((p) => (
                <tr key={`${p.namespace}/${p.name}`} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px' }} className="mono">{p.namespace}</td>
                  <td style={{ padding: '6px 8px' }} className="mono">{p.name}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }} className="mono">{formatCpu(p.cpuNano)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }} className="mono">{formatBytes(p.memBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <footer style={{ marginTop: 18, display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
        <QuickLink to="/cluster/resources/pods" label="Pods" scope={PODS} />
        <QuickLink to="/cluster/resources/deployments" label="Deployments" scope={DEPLOYMENTS} />
        <QuickLink to="/cluster/resources/services" label="Services" scope={SERVICES} />
        <QuickLink to="/cluster/resources/namespaces" label="Namespaces" scope={requireKind('namespaces')} />
      </footer>
    </div>
  )
}

function sum(values: (number | undefined)[]): number | undefined {
  let total = 0
  let seen = false
  for (const v of values) {
    if (v != null && isFinite(v)) {
      total += v
      seen = true
    }
  }
  return seen ? total : undefined
}

interface Total {
  used?: number
  cap?: number
}

function totalOf<T>(
  items: T[],
  used: (t: T) => number | undefined,
  cap: (t: T) => number | undefined
): Total {
  return { used: sum(items.map(used)), cap: sum(items.map(cap)) }
}

function Meter({ pct: value }: { pct: number | null }): React.ReactElement {
  if (value == null) return <span style={{ color: 'var(--text-dim)' }}>—</span>
  const width = Math.max(0, Math.min(100, value))
  const color = value >= 90 ? '#e5534b' : value >= 70 ? '#c09853' : 'var(--accent)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', minWidth: 60 }}>
        <div style={{ width: `${width}%`, height: '100%', background: color }} />
      </div>
      <span className="mono" style={{ fontSize: 11, width: 34, textAlign: 'right' }}>{value.toFixed(0)}%</span>
    </div>
  )
}

function UsageTile({
  label,
  used,
  capacity,
  format,
  hasData
}: {
  label: string
  used: number | undefined
  capacity: number | undefined
  format: (n: number | undefined) => string
  hasData: boolean
}): React.ReactElement {
  const labelStyle: React.CSSProperties = {
    color: 'var(--text-dim)',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5
  }
  const value = hasData ? pct(used, capacity) : null

  if (value == null) {
    return (
      <div className="panel" style={{ padding: 14, height: '100%', boxSizing: 'border-box' }}>
        <div style={labelStyle}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4, color: 'var(--text-dim)' }}>n/a</div>
        <div style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 2 }}>metrics-server not detected</div>
      </div>
    )
  }

  const width = Math.max(0, Math.min(100, value))
  const color = value >= 90 ? '#e5534b' : value >= 70 ? '#c09853' : 'var(--accent)'
  return (
    <div className="panel" style={{ padding: 14, height: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={labelStyle}>{label}</span>
        <span className="mono" style={{ fontSize: 20, fontWeight: 600 }}>{value.toFixed(1)}%</span>
      </div>
      <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden', margin: '10px 0 8px' }}>
        <div style={{ width: `${width}%`, height: '100%', background: color }} />
      </div>
      <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-dim)' }}>
        <span>{format(used)} used</span>
        <span>{format(capacity)} total</span>
      </div>
    </div>
  )
}

function Tile({
  label,
  value,
  sub,
  to,
  accent
}: {
  label: string
  value: number | string
  sub?: string
  to?: string
  accent?: boolean
}): React.ReactElement {
  const inner = (
    <div className="panel" style={{ padding: 12, height: '100%', boxSizing: 'border-box', border: accent ? '1px solid var(--accent)' : undefined }}>
      <div style={{ color: 'var(--text-dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>{sub}</div>}
    </div>
  )
  return to ? <Link to={to} style={{ textDecoration: 'none', color: 'inherit' }}>{inner}</Link> : inner
}

function QuickLink({ to, label, scope }: { to: string; label: string; scope: ResourceKind }): React.ReactElement {
  return (
    <Link to={to} className="chip" style={{ textDecoration: 'none', color: 'inherit' }} title={apiVersionOf(scope)}>
      {label} →
    </Link>
  )
}

function Empty({ text }: { text: string }): React.ReactElement {
  return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>{text}</div>
  )
}
