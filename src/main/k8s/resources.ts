import { KubernetesObjectApi } from '@kubernetes/client-node'
import * as yaml from 'js-yaml'
import { apiVersionOf, findResourceKind } from '@shared/types'
import type {
  ActionResult,
  KubeObject,
  ListRequest,
  ResourceKind,
  ResourceScopeRef
} from '@shared/types'
import { getKubeConfig } from './kubeconfig'
import { isConflict, messageOf } from './errors'

function client(): KubernetesObjectApi {
  return KubernetesObjectApi.makeApiClient(getKubeConfig())
}

function asBody(res: unknown): any {
  const b: any = res
  return b?.body ?? b
}

function namespaceFor(scope: ResourceKind, namespace?: string, allNamespaces?: boolean): string | undefined {
  if (!scope.namespaced || allNamespaces) return undefined
  return namespace
}

export async function listResources(req: ListRequest): Promise<KubeObject[]> {
  try {
    const { scope } = req
    const ns = namespaceFor(scope, req.namespace, req.allNamespaces)
    const res = await client().list(apiVersionOf(scope), scope.kind, ns)
    const b = asBody(res)
    const items = b?.items ?? []
    return items as KubeObject[]
  } catch {
    return []
  }
}

export async function listNodes(): Promise<KubeObject[]> {
  const scope = findResourceKind('nodes')
  if (!scope) return []
  return listResources({ scope, allNamespaces: true })
}

export async function listNamespaces(): Promise<KubeObject[]> {
  const scope = findResourceKind('namespaces')
  if (!scope) return []
  return listResources({ scope, allNamespaces: true })
}

export async function getResource(ref: ResourceScopeRef): Promise<KubeObject> {
  const apiVersion = apiVersionOf(ref.scope)
  try {
    const res = await client().read({
      apiVersion,
      kind: ref.scope.kind,
      metadata: {
        name: ref.name,
        namespace: ref.scope.namespaced ? ref.namespace : undefined
      }
    } as any)
    return asBody(res) as KubeObject
  } catch (err) {
    return {
      apiVersion,
      kind: ref.scope.kind,
      metadata: { name: ref.name, namespace: ref.namespace },
      error: messageOf(err)
    }
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
    return { ok: false, message: messageOf(err) }
  }
}

export async function applyYaml(text: string): Promise<ActionResult> {
  let docs: KubeObject[]
  try {
    docs = (yaml.loadAll(text) as unknown[]).filter(
      (d): d is KubeObject => !!d && typeof d === 'object' && Object.keys(d as object).length > 0
    )
  } catch (err) {
    return { ok: false, message: `Invalid YAML: ${messageOf(err)}` }
  }
  if (docs.length === 0) {
    return { ok: false, message: 'No documents found in YAML' }
  }
  const api = client()
  const applied: string[] = []
  try {
    for (const doc of docs) {
      const kind = String(doc.kind ?? '')
      const name = String(doc.metadata?.name ?? '')
      if (!kind || !name) {
        return { ok: false, message: 'Every document must have kind and metadata.name' }
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
        const resourceVersion = existing?.metadata?.resourceVersion
        await api.replace({
          ...doc,
          metadata: { ...doc.metadata, resourceVersion }
        } as any)
      }
      applied.push(`${kind}/${name}`)
    }
    return { ok: true, message: `Applied ${applied.join(', ')}` }
  } catch (err) {
    return { ok: false, message: messageOf(err) }
  }
}
