import type { KubeObject, ResourceKind } from '@shared/types'

export function objName(obj: KubeObject): string {
  return obj.metadata?.name ?? ''
}

export function objNamespace(obj: KubeObject): string {
  return obj.metadata?.namespace ?? ''
}

export function objKey(obj: KubeObject): string {
  return obj.metadata?.uid ?? `${objNamespace(obj)}/${objName(obj)}`
}

export function formatAge(creationTimestamp?: string): string {
  if (!creationTimestamp) return '<unknown>'
  const created = Date.parse(creationTimestamp)
  if (Number.isNaN(created)) return '<unknown>'
  const secs = Math.max(0, Math.floor((Date.now() - created) / 1000))
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 365) return `${days}d`
  return `${Math.floor(days / 365)}y`
}

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const seg of path.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

export function getStr(obj: unknown, path: string): string | undefined {
  const v = getPath(obj, path)
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  return undefined
}

export function getNum(obj: unknown, path: string): number | undefined {
  const v = getPath(obj, path)
  return typeof v === 'number' ? v : undefined
}

export function getArr(obj: unknown, path: string): unknown[] {
  const v = getPath(obj, path)
  return Array.isArray(v) ? v : []
}

export function detailPath(kind: ResourceKind, obj: KubeObject, nsQuery?: string | null): string {
  const name = encodeURIComponent(objName(obj))
  const ns = kind.namespaced ? encodeURIComponent(objNamespace(obj) || 'default') : '-'
  const q = nsQuery ? `?ns=${encodeURIComponent(nsQuery)}` : ''
  return `/cluster/resources/${kind.resource}/${ns}/${name}${q}`
}

export function listPath(resource: string, nsQuery?: string | null): string {
  const q = nsQuery ? `?ns=${encodeURIComponent(nsQuery)}` : ''
  return `/cluster/resources/${resource}${q}`
}

export function sortItems(items: KubeObject[], byNamespace: boolean): KubeObject[] {
  return [...items].sort((a, b) => {
    if (byNamespace) {
      const byNs = objNamespace(a).localeCompare(objNamespace(b))
      if (byNs !== 0) return byNs
    }
    return objName(a).localeCompare(objName(b))
  })
}
