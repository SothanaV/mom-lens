import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { dump } from 'js-yaml'
import type { KubeObject, NodeMetrics, PodMetrics, ResourceKind } from '@shared/types'
import { findResourceKind } from '@shared/types'
import { PodLogs, PodTerminal } from '@renderer/features/devtools'
import YamlView from './YamlView'
import YamlEditor from './YamlEditor'
import SecretDataPanel from './SecretDataPanel'
import {
  dataCount,
  endpointsSummary,
  nodeInternalIP,
  nodeRoles,
  nodeStatus,
  podPhase,
  servicePorts
} from './columns'
import { barColor, formatCpuNano, formatMemBytes, usagePercent } from './metrics'
import { getNum, getStr, listPath } from './utils'

function cleanForApply(obj: KubeObject): string {
  const clone = JSON.parse(JSON.stringify(obj)) as KubeObject
  if (clone.metadata) {
    const m = clone.metadata as Record<string, unknown>
    delete m.managedFields
    delete m.resourceVersion
    delete m.uid
    delete m.creationTimestamp
  }
  delete (clone as Record<string, unknown>).status
  return dump(clone, { noRefs: true, lineWidth: -1, sortKeys: false })
}

interface SummaryField {
  label: string
  value: string
}

function UsageBar({
  used,
  capacity,
  format
}: {
  used?: number
  capacity?: number
  format: (v: number | undefined) => string
}) {
  const pct = usagePercent(used, capacity)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          width: 160,
          height: 8,
          borderRadius: 4,
          background: 'rgba(128, 128, 128, 0.25)',
          overflow: 'hidden'
        }}
      >
        {pct !== null && (
          <div style={{ width: `${pct}%`, height: '100%', background: barColor(pct) }} />
        )}
      </div>
      <span className="mono" style={{ fontSize: 12 }}>
        {pct === null ? 'n/a' : `${pct.toFixed(1)}%`}
      </span>
      <span className="mono" style={{ fontSize: 12, opacity: 0.6 }}>
        {format(used)} / {format(capacity)}
      </span>
    </div>
  )
}

function push(fields: SummaryField[], label: string, value: string | undefined): void {
  if (value && value.length > 0) fields.push({ label, value })
}

function summaryFields(kind: ResourceKind, obj: KubeObject): SummaryField[] {
  const f: SummaryField[] = []
  switch (kind.resource) {
    case 'pods':
      push(f, 'Status', podPhase(obj))
      push(f, 'Node', getStr(obj, 'spec.nodeName'))
      push(f, 'Pod IP', getStr(obj, 'status.podIP'))
      push(f, 'Host IP', getStr(obj, 'status.hostIP'))
      break
    case 'deployments':
    case 'statefulsets':
    case 'replicasets':
      push(f, 'Desired', String(getNum(obj, 'spec.replicas') ?? 0))
      push(f, 'Ready', String(getNum(obj, 'status.readyReplicas') ?? 0))
      push(f, 'Updated', String(getNum(obj, 'status.updatedReplicas') ?? 0))
      break
    case 'daemonsets':
      push(f, 'Desired', String(getNum(obj, 'status.desiredNumberScheduled') ?? 0))
      push(f, 'Ready', String(getNum(obj, 'status.numberReady') ?? 0))
      break
    case 'services':
      push(f, 'Type', getStr(obj, 'spec.type') ?? 'ClusterIP')
      push(f, 'Cluster IP', getStr(obj, 'spec.clusterIP'))
      push(f, 'Ports', servicePorts(obj))
      break
    case 'jobs':
      push(
        f,
        'Completions',
        `${getNum(obj, 'status.succeeded') ?? 0}/${getNum(obj, 'spec.completions') ?? getNum(obj, 'spec.parallelism') ?? 1}`
      )
      break
    case 'cronjobs':
      push(f, 'Schedule', getStr(obj, 'spec.schedule'))
      push(f, 'Suspend', getStr(obj, 'spec.suspend') ?? 'false')
      break
    case 'nodes':
      push(f, 'Status', nodeStatus(obj))
      push(f, 'Roles', nodeRoles(obj))
      push(f, 'Internal IP', nodeInternalIP(obj))
      push(f, 'Version', getStr(obj, 'status.nodeInfo.kubeletVersion'))
      push(f, 'OS', getStr(obj, 'status.nodeInfo.osImage'))
      break
    case 'namespaces':
      push(f, 'Status', getStr(obj, 'status.phase'))
      break
    case 'configmaps':
      push(f, 'Data entries', dataCount(obj))
      break
    case 'secrets':
      push(f, 'Type', getStr(obj, 'type'))
      push(f, 'Data entries', dataCount(obj))
      break
    case 'endpoints':
      push(f, 'Endpoints', endpointsSummary(obj))
      break
    case 'storageclasses':
      push(f, 'Provisioner', getStr(obj, 'provisioner'))
      push(f, 'Reclaim Policy', getStr(obj, 'reclaimPolicy'))
      push(f, 'Volume Binding Mode', getStr(obj, 'volumeBindingMode'))
      push(f, 'Allow Expansion', getStr(obj, 'allowVolumeExpansion'))
      break
    case 'ingressclasses':
      push(f, 'Controller', getStr(obj, 'spec.controller'))
      break
    default:
      break
  }
  push(f, 'API Version', getStr(obj, 'apiVersion'))
  push(f, 'Created', obj.metadata?.creationTimestamp)
  push(f, 'UID', obj.metadata?.uid)
  return f
}

export default function ResourceDetailPage() {
  const { resource, namespace: nsParam, name } = useParams<{
    resource: string
    namespace: string
    name: string
  }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const kind = resource ? findResourceKind(resource) : undefined
  const namespace = nsParam && nsParam !== '-' ? nsParam : undefined

  const [obj, setObj] = useState<KubeObject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [yamlVisible, setYamlVisible] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [podMetrics, setPodMetrics] = useState<PodMetrics | null>(null)
  const [nodeMetrics, setNodeMetrics] = useState<NodeMetrics | null>(null)
  // Why metrics are missing here: null=none/absent, otherwise the failure text.
  const [metricsNote, setMetricsNote] = useState<string | null>(null)

  useEffect(() => {
    if (!kind || !name || !window.api) return
    let cancelled = false
    setLoading(true)
    setError(null)
    window.api.k8s
      .getResource({ scope: kind, namespace, name })
      .then((o) => {
        if (cancelled) return
        // In-band failure: never render an error result as if it were an object.
        if (o.error) {
          setError(o.error.hint ? `${o.error.message} — ${o.error.hint}` : o.error.message)
        } else {
          setObj(o)
        }
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
  }, [kind, namespace, name, reloadKey])

  useEffect(() => {
    if (!kind || !name || !window.api) return
    const isPod = kind.resource === 'pods' && !!namespace
    const isNode = kind.resource === 'nodes'
    if (!isPod && !isNode) return
    let cancelled = false
    const api = window.api
    const refresh = (): void => {
      if (isPod) {
        api.k8s
          .topPods(namespace)
          .then((res) => {
            if (cancelled) return
            setPodMetrics(
              res.items.find((m) => m.namespace === namespace && m.name === name) ?? null
            )
            // Absent metrics-server (notFound) reads as plain "no data";
            // any other failure states its real reason instead.
            setMetricsNote(res.error && res.error.code !== 'notFound' ? res.error.message : null)
          })
          .catch(() => {
            if (!cancelled) {
              setPodMetrics(null)
              setMetricsNote('metrics request failed')
            }
          })
      } else {
        api.k8s
          .topNodes()
          .then((res) => {
            if (cancelled) return
            setNodeMetrics(res.items.find((m) => m.name === name) ?? null)
            setMetricsNote(res.error && res.error.code !== 'notFound' ? res.error.message : null)
          })
          .catch(() => {
            if (!cancelled) {
              setNodeMetrics(null)
              setMetricsNote('metrics request failed')
            }
          })
      }
    }
    refresh()
    const timer = window.setInterval(refresh, 30000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [kind, namespace, name])

  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(null), 5000)
    return () => window.clearTimeout(t)
  }, [notice])

  const startEdit = useCallback((): void => {
    if (!obj) return
    setDraft(cleanForApply(obj))
    setError(null)
    setNotice(null)
    setEditing(true)
  }, [obj])

  const onSave = useCallback(async (): Promise<void> => {
    if (!kind || !name || saving || !window.api) return
    setSaving(true)
    setError(null)
    try {
      const res = await window.api.k8s.applyYaml(draft)
      if (!res.ok) {
        setError(res.message ?? 'Apply failed.')
        setSaving(false)
        return
      }
      setEditing(false)
      setSaving(false)
      setNotice(res.message ?? 'Applied.')
      setReloadKey((k) => k + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }, [kind, name, saving, draft])

  const onDelete = useCallback(async () => {
    if (!kind || !name || deleting || !window.api) return
    if (!window.confirm(`Delete ${kind.kind} "${name}"? This cannot be undone.`)) return
    setDeleting(true)
    try {
      const res = await window.api.k8s.deleteResource({ scope: kind, namespace, name })
      if (!res.ok) {
        setError(res.message ?? 'Delete failed')
        setDeleting(false)
        return
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setDeleting(false)
      return
    }
    navigate(listPath(kind.resource, searchParams.get('ns')))
  }, [kind, name, namespace, deleting, navigate, searchParams])

  const applySecretDoc = useCallback(async (text: string): Promise<void> => {
    if (!window.api) return
    const res = await window.api.k8s.applyYaml(text)
    if (!res.ok) throw new Error(res.message ?? 'Apply failed')
    setNotice(res.message ?? 'Applied.')
    setReloadKey((k) => k + 1)
  }, [])

  const askAi = useCallback((): void => {
    if (!obj || !kind || !name) return
    let yaml = cleanForApply(obj)
    if (yaml.length > 6000) yaml = `${yaml.slice(0, 6000)}\n# …truncated…`
    const where = namespace
      ? `${kind.kind} "${name}" in namespace "${namespace}"`
      : `${kind.kind} "${name}"`
    const prompt = `Explain this Kubernetes resource and suggest improvements:\n\n${where}\n\n${yaml}`
    navigate(`/cluster/ai?ask=${encodeURIComponent(prompt)}`)
  }, [obj, kind, name, namespace, navigate])

  if (!kind || !name) {
    return (
      <div className="page" style={{ padding: 24 }}>
        <h2>Unknown resource</h2>
        <p>
          Cannot resolve <code className="mono">{resource}</code>/<code className="mono">{name}</code>.
        </p>
        <p>
          Return to the <Link to="/">cluster catalog</Link>.
        </p>
      </div>
    )
  }

  const backTo = listPath(kind.resource, searchParams.get('ns'))
  const fields = obj ? summaryFields(kind, obj) : []
  const labels = obj?.metadata?.labels ?? {}
  const labelKeys = Object.keys(labels)
  const owners = obj?.metadata?.ownerReferences ?? []

  return (
    <div
      className="page"
      style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16, overflow: 'auto' }}
    >
      <div className="toolbar" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Link className="btn" to={backTo}>
          ← {kind.kind}
        </Link>
        <h2 style={{ margin: 0 }} className="mono">
          {name}
        </h2>
        <span className="chip">{kind.namespaced ? namespace ?? 'cluster-scoped' : 'cluster-scoped'}</span>
        <span style={{ flex: 1 }} />
        {obj && (
          <button className="btn" type="button" onClick={askAi}>
            Ask AI
          </button>
        )}
        {obj && !editing && (
          <button className="btn" type="button" onClick={startEdit}>
            Edit
          </button>
        )}
        <button className="btn" type="button" disabled={deleting || !obj} onClick={() => void onDelete()}>
          {deleting ? 'Deleting…' : 'Delete'}
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

      {loading && !obj ? (
        <div>Loading…</div>
      ) : obj ? (
        <>
          <section>
            <h3>Summary</h3>
            <table className="table">
              <tbody>
                {fields.map((f) => (
                  <tr key={f.label}>
                    <td style={{ width: 160, opacity: 0.7 }}>{f.label}</td>
                    <td className="mono">{f.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {labelKeys.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {labelKeys.map((k) => (
                  <span key={k} className="chip mono">
                    {k}={labels[k]}
                  </span>
                ))}
              </div>
            )}
            {owners.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {owners.map((o, i) => (
                  <span key={`${o.kind}-${o.name}-${i}`} className="chip mono">
                    owned by {o.kind}/{o.name}
                  </span>
                ))}
              </div>
            )}
          </section>

          {kind.resource === 'pods' && namespace && (
            <section>
              <h3>Metrics</h3>
              {metricsNote && (
                <div className="chip mono" style={{ color: '#e5534b', marginBottom: 8 }}>
                  {metricsNote}
                </div>
              )}
              <table className="table">
                <tbody>
                  <tr>
                    <td style={{ width: 160, opacity: 0.7 }}>CPU</td>
                    <td className="mono">{formatCpuNano(podMetrics?.cpuNano)}</td>
                  </tr>
                  <tr>
                    <td style={{ width: 160, opacity: 0.7 }}>Memory</td>
                    <td className="mono">{formatMemBytes(podMetrics?.memBytes)}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          )}

          {kind.resource === 'nodes' && (
            <section>
              <h3>Metrics</h3>
              {metricsNote && (
                <div className="chip mono" style={{ color: '#e5534b', marginBottom: 8 }}>
                  {metricsNote}
                </div>
              )}
              <table className="table">
                <tbody>
                  <tr>
                    <td style={{ width: 160, opacity: 0.7 }}>CPU</td>
                    <td>
                      <UsageBar
                        used={nodeMetrics?.cpuNano}
                        capacity={nodeMetrics?.cpuCapacityNano}
                        format={formatCpuNano}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td style={{ width: 160, opacity: 0.7 }}>Memory</td>
                    <td>
                      <UsageBar
                        used={nodeMetrics?.memBytes}
                        capacity={nodeMetrics?.memCapacityBytes}
                        format={formatMemBytes}
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>
          )}

          {kind.resource === 'secrets' && (
            <section>
              <h3>Data</h3>
              <SecretDataPanel
                key={String(obj.metadata?.resourceVersion ?? obj.metadata?.uid ?? name)}
                obj={obj}
                onApply={applySecretDoc}
              />
            </section>
          )}

          <section>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: yamlVisible || editing ? 0 : 8
              }}
            >
              <h3 style={{ margin: yamlVisible || editing ? undefined : 0 }}>YAML</h3>
              {!editing && (
                <>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setYamlVisible((v) => !v)}
                  >
                    {yamlVisible ? 'Hide' : 'View'}
                  </button>
                  <button className="btn" type="button" onClick={startEdit}>
                    Edit
                  </button>
                </>
              )}
            </div>
            {editing ? (
              <>
                <YamlEditor value={draft} onChange={setDraft} height="400px" editable={!saving} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button
                    className="btn"
                    type="button"
                    disabled={saving}
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn"
                    type="button"
                    disabled={saving}
                    onClick={() => void onSave()}
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </>
            ) : yamlVisible ? (
              <YamlView obj={obj} />
            ) : null}
          </section>

          {kind.resource === 'pods' && namespace && (
            <>
              <section>
                <h3>Logs</h3>
                <PodLogs namespace={namespace} podName={name} />
              </section>
              <section>
                <h3>Terminal</h3>
                <PodTerminal namespace={namespace} podName={name} />
              </section>
            </>
          )}
        </>
      ) : (
        !error && <div>Not found.</div>
      )}
    </div>
  )
}
