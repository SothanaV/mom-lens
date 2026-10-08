import { KubernetesObjectApi } from '@kubernetes/client-node'
import * as yaml from 'js-yaml'
import { apiVersionOf, findResourceKind } from '@shared/types'
import type {
  ActionResult,
  GetResult,
  KubeListResult,
  KubeObject,
  ListPage,
  ListPageRequest,
  ListRequest,
  ResourceKind,
  ResourceScopeRef
} from '@shared/types'
import { getKubeConfig } from './kubeconfig'
import { isConflict, messageOf, toKubeError } from './errors'

function client(): KubernetesObjectApi {
  return KubernetesObjectApi.makeApiClient(getKubeConfig())
}

function asBody(res: unknown): KubeObject {
  const b = res as { body?: unknown } | null | undefined
  return (b?.body ?? b) as KubeObject
}

function namespaceFor(scope: ResourceKind, namespace?: string, allNamespaces?: boolean): string | undefined {
  if (!scope.namespaced || allNamespaces) return undefined
  return namespace
}

export async function listResources(req: ListRequest): Promise<KubeListResult> {
  try {
    const { scope } = req
    const ns = namespaceFor(scope, req.namespace, req.allNamespaces)
    // Client built INSIDE the try: a broken/missing kubeconfig surfaces here
    // too and is classified `invalid`, not lost as an empty list.
    const res = await client().list(apiVersionOf(scope), scope.kind, ns)
    const items = asBody(res).items ?? []
    return { items: items as KubeObject[] }
  } catch (err) {
    return { items: [], error: toKubeError(err) }
  }
}

/**
 * One page of a list call using the API server's own pagination (`limit` +
 * `continue`). Only the returned page is serialized server-side, which is what
 * actually reduces API-server load for large collections.
 * A failed request reports `error` in-band with an empty page instead of
 * masquerading as an empty cluster.
 */
export async function listResourcesPage(req: ListPageRequest): Promise<ListPage> {
  const { scope } = req
  const ns = namespaceFor(scope, req.namespace, req.allNamespaces)
  try {
    const res = await client().list(
      apiVersionOf(scope),
      scope.kind,
      ns,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      req.limit,
      req.continueToken
    )
    const b = asBody(res)
    const items = (b.items ?? []) as KubeObject[]
    // The client's V1ListMeta model maps the reserved word `continue` to `_continue`.
    const meta = b.metadata as Record<string, unknown> | undefined
    const next = meta?._continue ?? meta?.continue
    return { items, continueToken: typeof next === 'string' && next ? next : undefined }
  } catch (err) {
    return { items: [], error: toKubeError(err) }
  }
}

export async function listNodes(): Promise<KubeListResult> {
  const scope = findResourceKind('nodes')
  if (!scope) return { items: [], error: { code: 'invalid', message: 'Unknown resource kind: nodes' } }
  return listResources({ scope, allNamespaces: true })
}

export async function listNamespaces(): Promise<KubeListResult> {
  const scope = findResourceKind('namespaces')
  if (!scope) {
    return { items: [], error: { code: 'invalid', message: 'Unknown resource kind: namespaces' } }
  }
  return listResources({ scope, allNamespaces: true })
}

/**
 * Reads one object. On failure this resolves the typed in-band error
 * (`error`) with NO fabricated object fields, so callers can tell a real
 * 404/403 apart from an object that exists.
 */
export async function getResource(ref: ResourceScopeRef): Promise<GetResult> {
  try {
    const res = await client().read({
      apiVersion: apiVersionOf(ref.scope),
      kind: ref.scope.kind,
      metadata: {
        name: ref.name,
        namespace: ref.scope.namespaced ? ref.namespace : undefined
      }
    } as any)
    return asBody(res)
  } catch (err) {
    return { error: toKubeError(err) }
  }
}

export async function deleteResource(ref: ResourceScopeRef): Promise<ActionResult> {
  try {
    await client().delete({
      apiVersion: apiVersionOf(ref.scope),
      kind: ref.scope.kind,
      metadata: {
        name: ref.name,
        namespace: ref.scope.namespaced ? ref.namespace : undefined
      }
    } as any)
    return { ok: true }
  } catch (err) {
    const error = toKubeError(err)
    return { ok: false, message: error.message, error }
  }
}

export async function applyYaml(text: string): Promise<ActionResult> {
  let docs: KubeObject[]
  try {
    docs = (yaml.loadAll(text) as unknown[]).filter(
      (d): d is KubeObject => !!d && typeof d === 'object' && Object.keys(d as object).length > 0
    )
  } catch (err) {
    return {
      ok: false,
      message: `Invalid YAML: ${messageOf(err)}`,
      error: { code: 'invalid', message: `Invalid YAML: ${messageOf(err)}` }
    }
  }
  if (docs.length === 0) {
    return {
      ok: false,
      message: 'No documents found in YAML',
      error: { code: 'invalid', message: 'No documents found in YAML' }
    }
  }
  const api = client()
  const applied: string[] = []
  try {
    for (const doc of docs) {
      const kind = String(doc.kind ?? '')
      const name = String(doc.metadata?.name ?? '')
      if (!kind || !name) {
        return {
          ok: false,
          message: 'Every document must have kind and metadata.name',
          error: { code: 'invalid', message: 'Every document must have kind and metadata.name' }
        }
      }
      try {
        await api.create({ ...doc } as any)
      } catch (err) {
        if (!isConflict(err)) throw err
        const existing = asBody(
          await api.read({
            apiVersion: doc.apiVersion,
            kind,
            metadata: { name, namespace: doc.metadata?.namespace }
          } as any)
        )
        const resourceVersion = existing.metadata?.resourceVersion
        await api.replace({
          ...doc,
          metadata: { ...doc.metadata, resourceVersion }
        } as any)
      }
      applied.push(`${kind}/${name}`)
    }
    return { ok: true, message: `Applied ${applied.join(', ')}` }
  } catch (err) {
    const error = toKubeError(err)
    return { ok: false, message: error.message, error }
  }
}
