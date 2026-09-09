import { KubeConfig } from '@kubernetes/client-node'
import type { ContextInfo, KubeContext } from '@shared/types'

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

export function listContexts(): KubeContext[] {
  try {
    const config = getKubeConfig()
    const current = config.getCurrentContext()
    return config.getContexts().map((c) => {
      const ctx = config.getContextObject(c.name)
      return {
        name: c.name,
        cluster: c.cluster,
        user: c.user,
        namespace: ctx?.namespace,
        current: c.name === current
      }
    })
  } catch {
    return []
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

export function currentContext(): ContextInfo | null {
  try {
    const config = getKubeConfig()
    const name = config.getCurrentContext()
    if (!name) return null
    return buildContextInfo(config, name)
  } catch {
    return null
  }
}
