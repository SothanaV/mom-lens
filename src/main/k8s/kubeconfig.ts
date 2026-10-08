import { KubeConfig } from '@kubernetes/client-node'
import type { ContextInfo, KubeContext, KubeContextsResult, CurrentContextResult } from '@shared/types'
import { toKubeError } from './errors'

let kc: KubeConfig | null = null

export function getKubeConfig(): KubeConfig {
  if (!kc) {
    const c = new KubeConfig()
    c.loadFromDefault()
    kc = c
  }
  return kc
}

function buildContextInfo(config: KubeConfig, name: string): ContextInfo | null {
  const ctx = config.getContextObject(name)
  if (!ctx) return null
  const cluster = config.getCluster(ctx.cluster)
  return {
    name,
    cluster: ctx.cluster,
    server: cluster?.server ?? '',
    user: ctx.user
  }
}

/**
 * Contexts from the active kubeconfig. On a load/parse failure this returns
 * an empty list carrying the real `error` instead of silently looking like
 * "no clusters configured".
 *
 * IMPORTANT: this is a PLAIN OBJECT envelope (`{ items, error? }`), never an
 * array with an extra `error` property — Electron's contextBridge rebuilds
 * arrays index-by-index (v8::Array::New(len)), silently dropping non-index
 * own properties, so an array hybrid would lose `error` before the renderer
 * ever sees it.
 */
export function listContexts(): KubeContextsResult {
  try {
    const config = getKubeConfig()
    const current = config.getCurrentContext()
    const items: KubeContext[] = config.getContexts().map((c) => {
      const ctx = config.getContextObject(c.name)
      return {
        name: c.name,
        cluster: c.cluster,
        user: c.user,
        namespace: ctx?.namespace,
        current: c.name === current
      }
    })
    return { items }
  } catch (err) {
    return { items: [], error: toKubeError(err) }
  }
}

export function useContext(name: string): ContextInfo {
  const config = getKubeConfig()
  const ctx = config.getContextObject(name)
  if (!ctx) {
    throw new Error(`Context not found: ${name}`)
  }
  config.setCurrentContext(name)
  const info = buildContextInfo(config, name)
  if (!info) {
    throw new Error(`Context not found: ${name}`)
  }
  return info
}

/**
 * Current context, or `{}` when none is selected. A kubeconfig that fails to
 * load now reports the real `error` instead of looking "Disconnected".
 */
export function currentContext(): CurrentContextResult {
  try {
    const config = getKubeConfig()
    const name = config.getCurrentContext()
    if (!name) return {}
    const info = buildContextInfo(config, name)
    if (!info) return {}
    return { context: info }
  } catch (err) {
    return { error: toKubeError(err) }
  }
}
