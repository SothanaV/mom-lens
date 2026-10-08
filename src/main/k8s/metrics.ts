import * as https from 'https'
import type { RequestOptions } from 'https'
import type { NodeMetrics, NodeMetricsResult, PodMetrics, PodMetricsResult } from '@shared/types'
import { getKubeConfig } from './kubeconfig'
import { isMetricsAbsent, toKubeError } from './errors'

const METRICS_GROUP = '/apis/metrics.k8s.io/v1beta1'
const METRICS_TIMEOUT_MS = 10_000

type MetricValue = string | number

/** Shapes of the raw JSON the metrics endpoints / core nodes return. */
interface RawNode {
  metadata?: { name?: string }
  status?: { capacity?: { cpu?: MetricValue; memory?: MetricValue } }
}
interface RawNodeMetric {
  metadata?: { name?: string }
  usage?: { cpu?: MetricValue; memory?: MetricValue }
}
interface RawPodMetric {
  metadata?: { name?: string; namespace?: string }
  containers?: {
    name?: string
    usage?: { cpu?: MetricValue; memory?: MetricValue }
  }[]
}
interface RawList<T> {
  items?: T[]
}

export function parseCpu(v: unknown): number | undefined {
  if (v == null) return undefined
  if (typeof v === 'number') return v * 1e9
  const m = String(v).trim().match(/^([0-9.]+)([a-zA-Z]*)$/)
  if (!m) return undefined
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return undefined
  switch (m[2]) {
    case 'n':
      return n
    case 'u':
      return n * 1e3
    case 'm':
      return n * 1e6
    case '':
      return n * 1e9
    case 'k':
      return n * 1e12
    case 'M':
      return n * 1e15
    case 'G':
      return n * 1e18
    default:
      return n * 1e9
  }
}

export function parseMemory(v: unknown): number | undefined {
  if (v == null) return undefined
  if (typeof v === 'number') return v
  const m = String(v).trim().match(/^([0-9.]+)([a-zA-Z]*)$/)
  if (!m) return undefined
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return undefined
  switch (m[2]) {
    case '':
      return n
    case 'Ki':
      return n * 1024
    case 'Mi':
      return n * 1024 ** 2
    case 'Gi':
      return n * 1024 ** 3
    case 'Ti':
      return n * 1024 ** 4
    case 'Pi':
      return n * 1024 ** 5
    case 'Ei':
      return n * 1024 ** 6
    case 'k':
    case 'K':
      return n * 1e3
    case 'M':
      return n * 1e6
    case 'G':
      return n * 1e9
    case 'T':
      return n * 1e12
    case 'P':
      return n * 1e15
    case 'E':
      return n * 1e18
    default:
      return n
  }
}

async function metricsGet(path: string): Promise<unknown> {
  const kc = getKubeConfig()
  const cluster = kc.getCurrentCluster()
  if (!cluster) throw new Error('No currently active cluster')
  const url = new URL(cluster.server)
  const opts: RequestOptions = {
    hostname: url.hostname,
    port: url.port ? Number(url.port) : 443,
    path,
    method: 'GET'
  }
  await kc.applyToHTTPSOptions(opts)
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode && res.statusCode >= 400) {
          // Carry the HTTP status so toKubeError/isMetricsAbsent can classify it.
          const err = new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`) as Error & {
            statusCode?: number
          }
          err.statusCode = res.statusCode
          reject(err)
          return
        }
        try {
          resolve(JSON.parse(text))
        } catch (err) {
          reject(err)
        }
      })
    })
    req.setTimeout(METRICS_TIMEOUT_MS, () => {
      req.destroy(
        Object.assign(new Error(`metrics request timed out after ${METRICS_TIMEOUT_MS}ms`), {
          code: 'ETIMEDOUT'
        })
      )
    })
    req.on('error', reject)
    req.end()
  })
}

/**
 * Failure result: metrics-server absent is an expected absence (its own
 * message + hint); anything else is a real request failure the UI must not
 * render as "not installed".
 */
function metricsFailure(err: unknown): {
  items: never[]
  available: false
  error: ReturnType<typeof toKubeError>
} {
  if (isMetricsAbsent(err)) {
    return {
      items: [],
      available: false,
      error: {
        code: 'notFound',
        message: 'metrics-server is not installed on this cluster',
        hint: 'Resource usage is unavailable. Install metrics-server to see CPU and memory.'
      }
    }
  }
  return { items: [], available: false, error: toKubeError(err) }
}

export async function topNodes(): Promise<NodeMetricsResult> {
  try {
    const data = (await metricsGet(`${METRICS_GROUP}/nodes`)) as RawList<RawNodeMetric> | undefined
    const capacity = new Map<string, { cpu?: number; mem?: number }>()
    try {
      const nodeData = (await metricsGet('/api/v1/nodes')) as RawList<RawNode> | undefined
      for (const n of nodeData?.items ?? []) {
        const name = n?.metadata?.name
        if (!name) continue
        capacity.set(name, {
          cpu: parseCpu(n?.status?.capacity?.cpu),
          mem: parseMemory(n?.status?.capacity?.memory)
        })
      }
    } catch {
      /* capacity is optional */
    }
    const items: NodeMetrics[] = (data?.items ?? []).map((it) => {
      const name = String(it?.metadata?.name ?? '')
      const cap = capacity.get(name)
      return {
        name,
        cpuNano: parseCpu(it?.usage?.cpu),
        cpuCapacityNano: cap?.cpu,
        memBytes: parseMemory(it?.usage?.memory),
        memCapacityBytes: cap?.mem
      }
    })
    return { items, available: true }
  } catch (err) {
    return metricsFailure(err)
  }
}

export async function topPods(namespace?: string): Promise<PodMetricsResult> {
  const path = namespace
    ? `${METRICS_GROUP}/namespaces/${encodeURIComponent(namespace)}/pods`
    : `${METRICS_GROUP}/pods`
  try {
    const data = (await metricsGet(path)) as RawList<RawPodMetric> | undefined
    const items: PodMetrics[] = (data?.items ?? []).map((it) => {
      const containers = (it?.containers ?? []).map((c) => ({
        name: String(c?.name ?? ''),
        cpuNano: parseCpu(c?.usage?.cpu) ?? 0,
        memBytes: parseMemory(c?.usage?.memory) ?? 0
      }))
      return {
        namespace: String(it?.metadata?.namespace ?? namespace ?? ''),
        name: String(it?.metadata?.name ?? ''),
        cpuNano: containers.reduce((s, c) => s + c.cpuNano, 0),
        memBytes: containers.reduce((s, c) => s + c.memBytes, 0),
        containers
      }
    })
    return { items, available: true }
  } catch (err) {
    return metricsFailure(err)
  }
}
