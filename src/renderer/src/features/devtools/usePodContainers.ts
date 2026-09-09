import { useEffect, useState } from 'react'
import { findResourceKind } from '@shared/types'
import type { SoLensApi } from '@shared/types'

export interface PodContainers {
  /** Container + init-container names in spec order. */
  containers: string[]
  /** True once the pod fetch settled (success or failure). */
  loaded: boolean
}

interface ContainerLike {
  name?: string
}
interface PodSpecLike {
  containers?: ContainerLike[]
  initContainers?: ContainerLike[]
}

/** Fetches a pod's container names once per (namespace, podName). */
export function usePodContainers(
  api: SoLensApi | undefined,
  namespace: string,
  podName: string
): PodContainers {
  const [containers, setContainers] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!api) return
    const scope = findResourceKind('pods')
    if (!scope) {
      setContainers([])
      setLoaded(true)
      return
    }

    let cancelled = false
    setLoaded(false)
    setContainers([])

    api.k8s
      .getResource({ scope, namespace, name: podName })
      .then((pod) => {
        if (cancelled) return
        const spec = ((pod as { spec?: unknown } | null)?.spec ?? {}) as PodSpecLike
        const names: string[] = []
        for (const c of spec.containers ?? []) if (c && c.name) names.push(c.name)
        for (const c of spec.initContainers ?? []) if (c && c.name) names.push(c.name)
        setContainers(names)
      })
      .catch(() => {
        if (!cancelled) setContainers([])
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [api, namespace, podName])

  return { containers, loaded }
}
