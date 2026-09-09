import type { KubeObject, ResourceKind } from '@shared/types'
import { formatAge, getArr, getNum, getStr, objNamespace } from './utils'

export interface ResourceColumn {
  header: string
  value(obj: KubeObject): string
  /** render this cell as a colored Lens-style status pill */
  status?: boolean
}

export type StatusTone = 'success' | 'warning' | 'danger' | 'accent' | 'muted'

const OK = /^(running|ready|active|available|complete|completed|succeeded|bound|up|healthy|true|enabled)$/i
const BAD = /(crashloop|error|failed|backoff|imagepull|errimage|invalid|evicted|dead|unreachable|notready|unhealthy)$/i
const WARN = /^(pending|terminating|creating|containercreating|init:|unknown|progressing|updating|scaling|waiting|configuring)$/i

/** Map a status/phase/"a/b" string to a Lens status tone. */
export function statusTone(value: string): StatusTone {
  const v = (value ?? '').trim()
  if (!v || v === '<none>' || v === '<cluster>') return 'muted'
  const pair = v.match(/^(\d+)\/(\d+)$/)
  if (pair) {
    const ready = Number(pair[1])
    const want = Number(pair[2])
    if (want > 0 && ready === want) return 'success'
    return ready === 0 ? 'warning' : 'warning'
  }
  if (BAD.test(v)) return 'danger'
  if (WARN.test(v)) return 'warning'
  if (OK.test(v)) return 'success'
  return 'accent'
}

const ageColumn: ResourceColumn = {
  header: 'Age',
  value: (obj) => formatAge(obj.metadata?.creationTimestamp)
}

const namespaceColumn: ResourceColumn = {
  header: 'Namespace',
  value: (obj) => objNamespace(obj) || '<cluster>'
}

export function podPhase(obj: KubeObject): string {
  for (const s of getArr(obj, 'status.containerStatuses')) {
    const state = (s as { state?: Record<string, { reason?: string }> }).state
    const reason = state?.waiting?.reason ?? state?.terminated?.reason
    if (reason) return reason
  }
  for (const s of getArr(obj, 'status.initContainerStatuses')) {
    const state = (s as { state?: Record<string, { reason?: string }> }).state
    const reason = state?.waiting?.reason ?? state?.terminated?.reason
    if (reason) return `Init:${reason}`
  }
  return getStr(obj, 'status.phase') ?? ''
}

export function podReady(obj: KubeObject): string {
  const total = getArr(obj, 'spec.containers').length
  let ready = 0
  for (const s of getArr(obj, 'status.containerStatuses')) {
    if ((s as { ready?: boolean }).ready) ready++
  }
  return total === 0 ? String(ready) : `${ready}/${total}`
}

function podRestarts(obj: KubeObject): string {
  let sum = 0
  for (const s of getArr(obj, 'status.containerStatuses')) {
    const rc = (s as { restartCount?: number }).restartCount
    if (typeof rc === 'number') sum += rc
  }
  return String(sum)
}

function replicaPair(obj: KubeObject, readyPath: string, desiredPath: string): string {
  const ready = getNum(obj, readyPath) ?? 0
  const desired = getNum(obj, desiredPath) ?? 0
  return `${ready}/${desired}`
}

export function servicePorts(obj: KubeObject): string {
  const parts: string[] = []
  for (const p of getArr(obj, 'spec.ports')) {
    const e = p as { port?: number; protocol?: string }
    if (typeof e.port === 'number') parts.push(`${e.port}/${e.protocol ?? 'TCP'}`)
  }
  return parts.join(', ')
}

export function nodeStatus(obj: KubeObject): string {
  for (const c of getArr(obj, 'status.conditions')) {
    const cond = c as { type?: string; status?: string; reason?: string }
    if (cond.type === 'Ready') {
      if (cond.status === 'True') return 'Ready'
      return cond.reason ? `NotReady:${cond.reason}` : 'NotReady'
    }
  }
  return 'Unknown'
}

export function nodeRoles(obj: KubeObject): string {
  const labels = obj.metadata?.labels ?? {}
  const roles = Object.keys(labels)
    .filter((k) => k.startsWith('node-role.kubernetes.io/'))
    .map((k) => k.slice('node-role.kubernetes.io/'.length))
  const mapped = roles.map((r) => (r === 'master' ? 'control-plane' : r))
  return mapped.length > 0 ? mapped.join(',') : '<none>'
}

export function nodeInternalIP(obj: KubeObject): string {
  for (const a of getArr(obj, 'status.addresses')) {
    const addr = a as { type?: string; address?: string }
    if (addr.type === 'InternalIP') return addr.address ?? ''
  }
  return ''
}

export function endpointsSummary(obj: KubeObject): string {
  const pairs: string[] = []
  for (const s of getArr(obj, 'subsets')) {
    const subset = s as { addresses?: unknown[]; ports?: unknown[] }
    const ips = (subset.addresses ?? [])
      .map((a) => (a as { ip?: string }).ip)
      .filter((ip): ip is string => typeof ip === 'string' && ip.length > 0)
    const ports = (subset.ports ?? [])
      .map((p) => (p as { port?: number }).port)
      .filter((p): p is number => typeof p === 'number')
    for (const ip of ips) {
      if (ports.length === 0) pairs.push(ip)
      else for (const p of ports) pairs.push(`${ip}:${p}`)
    }
  }
  if (pairs.length === 0) {
    const n = getArr(obj, 'subsets').length
    return n === 0 ? '<none>' : `${n} subset(s)`
  }
  const shown = pairs.slice(0, 3)
  return pairs.length > shown.length ? `${shown.join(', ')} +${pairs.length - shown.length}` : shown.join(', ')
}

export function dataCount(obj: KubeObject): string {
  const data = obj.data ?? obj.stringData
  if (data && typeof data === 'object') return String(Object.keys(data as object).length)
  return '0'
}

export function columnsForKind(kind: ResourceKind): ResourceColumn[] {
  switch (kind.resource) {
    case 'pods':
      return [
        { header: 'Ready', value: podReady, status: true },
        { header: 'Status', value: podPhase, status: true },
        { header: 'Restarts', value: podRestarts },
        { header: 'Node', value: (o) => getStr(o, 'spec.nodeName') ?? '' },
        ageColumn
      ]
    case 'deployments':
      return [
        { header: 'Ready', value: (o) => replicaPair(o, 'status.readyReplicas', 'spec.replicas'), status: true },
        { header: 'Up-to-date', value: (o) => String(getNum(o, 'status.updatedReplicas') ?? 0) },
        { header: 'Available', value: (o) => String(getNum(o, 'status.availableReplicas') ?? 0) },
        ageColumn
      ]
    case 'statefulsets':
    case 'replicasets':
      return [
        { header: 'Ready', value: (o) => replicaPair(o, 'status.readyReplicas', 'spec.replicas'), status: true },
        ageColumn
      ]
    case 'daemonsets':
      return [
        {
          header: 'Desired',
          value: (o) => String(getNum(o, 'status.desiredNumberScheduled') ?? 0)
        },
        { header: 'Ready', value: (o) => String(getNum(o, 'status.numberReady') ?? 0), status: true },
        ageColumn
      ]
    case 'jobs':
      return [
        {
          header: 'Completions',
          status: true,
          value: (o) => {
            const succeeded = getNum(o, 'status.succeeded') ?? 0
            const target = getNum(o, 'spec.completions') ?? getNum(o, 'spec.parallelism') ?? 1
            return `${succeeded}/${target}`
          }
        },
        ageColumn
      ]
    case 'cronjobs':
      return [
        { header: 'Schedule', value: (o) => getStr(o, 'spec.schedule') ?? '<none>' },
        ageColumn
      ]
    case 'services':
      return [
        { header: 'Type', value: (o) => getStr(o, 'spec.type') ?? 'ClusterIP' },
        { header: 'Cluster IP', value: (o) => getStr(o, 'spec.clusterIP') ?? '' },
        { header: 'Ports', value: servicePorts },
        ageColumn
      ]
    case 'nodes':
      return [
        { header: 'Status', value: nodeStatus, status: true },
        { header: 'Roles', value: nodeRoles },
        { header: 'Version', value: (o) => getStr(o, 'status.nodeInfo.kubeletVersion') ?? '' },
        ageColumn
      ]
    case 'namespaces':
      return [
        { header: 'Status', value: (o) => getStr(o, 'status.phase') ?? '', status: true },
        ageColumn
      ]
    case 'configmaps':
    case 'secrets':
      return [
        { header: 'Data', value: dataCount },
        ageColumn
      ]
    case 'endpoints':
      return [
        { header: 'Endpoints', value: endpointsSummary },
        ageColumn
      ]
    case 'storageclasses':
      return [
        { header: 'Provisioner', value: (o) => getStr(o, 'provisioner') ?? '' },
        { header: 'Reclaim Policy', value: (o) => getStr(o, 'reclaimPolicy') ?? '' },
        { header: 'Volume Binding Mode', value: (o) => getStr(o, 'volumeBindingMode') ?? '' },
        ageColumn
      ]
    case 'ingressclasses':
      return [
        { header: 'Controller', value: (o) => getStr(o, 'spec.controller') ?? '' },
        ageColumn
      ]
    default:
      return kind.namespaced ? [namespaceColumn, ageColumn] : [ageColumn]
  }
}
