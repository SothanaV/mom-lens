import * as https from 'https'
import type { RequestOptions } from 'https'
import type { NodeMetrics, PodMetrics } from '@shared/types'
import { getKubeConfig } from './kubeconfig'

const METRICS_GROUP = '/apis/metrics.k8s.io/v1beta1'

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

async function metricsGet(path: string): Promise<any> {
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
          reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`))
          return
        }
        try {
          resolve(JSON.parse(text))
        } catch (err) {
          reject(err)
        }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

export async function topNodes(): Promise<NodeMetrics[]> {
  try {
    const data = await metricsGet(`${METRICS_GROUP}/nodes`)
    const items: any[] = data?.items ?? []
    const capacity = new Map<string, { cpu?: number; mem?: number }>()
    try {
      const nodeData = await metricsGet('/api/v1/nodes')
      for (const n of nodeData?.items ?? []) {
        capacity.set(n?.metadata?.name, {
          cpu: parseCpu(n?.status?.capacity?.cpu),
          mem: parseMemory(n?.status?.capacity?.memory)
        })
      }
    } catch {
      /* capacity is optional */
    }
    return items.map((it) => {
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
  } catch {
    return []
  }
}

export async function topPods(namespace?: string): Promise<PodMetrics[]> {
  const path = namespace
    ? `${METRICS_GROUP}/namespaces/${encodeURIComponent(namespace)}/pods`
    : `${METRICS_GROUP}/pods`
  try {
    const data = await metricsGet(path)
    const items: any[] = data?.items ?? []
    return items.map((it) => {
      const containers = (it?.containers ?? []).map((c: any) => ({
        name: String(c?.name ?? ''),
        cpuNano: parseCpu(c?.usage?.cpu) ?? 0,
        memBytes: parseMemory(c?.usage?.memory) ?? 0
      }))
      return {
        namespace: String(it?.metadata?.namespace ?? namespace ?? ''),
        name: String(it?.metadata?.name ?? ''),
        cpuNano: containers.reduce((s: number, c: { cpuNano: number }) => s + c.cpuNano, 0),
        memBytes: containers.reduce((s: number, c: { memBytes: number }) => s + c.memBytes, 0),
        containers
      }
    })
  } catch {
    return []
  }
}
