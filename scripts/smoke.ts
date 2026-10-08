// Headless integration test that exercises the REAL backend service functions
// (src/main/k8s/*) against the current KUBECONFIG. Run: pnpm test:k8s
import { listContexts, currentContext, getKubeConfig } from '../src/main/k8s/kubeconfig'
import {
  listNodes,
  listNamespaces,
  listResources,
  getResource,
  applyYaml
} from '../src/main/k8s/resources'
import { topNodes, topPods } from '../src/main/k8s/metrics'
import { findResourceKind, isKubeApiError } from '../src/shared/types'
import type { KubeListResult, KubeObject } from '../src/shared/types'

function kind(r: string) {
  const k = findResourceKind(r)
  if (!k) throw new Error(`unknown resource kind in catalog: ${r}`)
  return k
}

/**
 * Baseline lists must succeed; a failure aborts the smoke with its real
 * code+message instead of ever reading as "0 resources".
 */
function unwrapList(res: KubeListResult, label: string): KubeObject[] {
  if (res.error) {
    throw new Error(`${label} failed (${res.error.code}): ${res.error.message}`)
  }
  return res.items
}

async function main(): Promise<void> {
  const contexts = listContexts()
  // Review-fix guard: the contexts result must be a PLAIN OBJECT envelope.
  // An array with an attached `error` property look-alike cannot cross
  // Electron's contextBridge (arrays are rebuilt index-by-index; extra own
  // properties are dropped), so the renderer would never see the reason a
  // kubeconfig failed to load. Never let the array hybrid come back.
  if (Array.isArray(contexts)) {
    throw new Error('SMOKE ASSERT FAILED: listContexts() must return a { items, error? } envelope, not an array hybrid')
  }
  const current = currentContext()
  console.log('contexts :', contexts.items.map((c) => c.name).join(', '))
  console.log('current  :', current.context?.name, '->', current.context?.server)

  const nodes = unwrapList(await listNodes(), 'listNodes')
  const ns = unwrapList(await listNamespaces(), 'listNamespaces')
  const pods = unwrapList(await listResources({ scope: kind('pods'), allNamespaces: true }), 'listResources(pods)')
  const deployments = unwrapList(
    await listResources({ scope: kind('deployments'), allNamespaces: true }),
    'listResources(deployments)'
  )
  const services = unwrapList(
    await listResources({ scope: kind('services'), allNamespaces: true }),
    'listResources(services)'
  )

  console.log(`nodes=${nodes.length} namespaces=${ns.length} pods=${pods.length} deployments=${deployments.length} services=${services.length}`)

  // New kinds wired via the shared catalog: endpoints / storageclasses / ingressclasses.
  const endpoints = unwrapList(
    await listResources({ scope: kind('endpoints'), allNamespaces: true }),
    'listResources(endpoints)'
  )
  const storageClasses = unwrapList(
    await listResources({ scope: kind('storageclasses'), allNamespaces: true }),
    'listResources(storageclasses)'
  )
  const ingressClasses = unwrapList(
    await listResources({ scope: kind('ingressclasses'), allNamespaces: true }),
    'listResources(ingressclasses)'
  )
  console.log(`endpoints=${endpoints.length} storageclasses=${storageClasses.length} ingressclasses=${ingressClasses.length}`)

  // applyYaml must reject a doc missing metadata.name WITHOUT mutating the cluster.
  const bad = await applyYaml('apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ""\n')
  console.log('applyYaml(invalid) =>', JSON.stringify(bad))
  if (bad.ok) throw new Error('applyYaml should reject an empty-name doc')

  // Read one node back through the generic read path.
  let readName = ''
  const firstNode = nodes.find((n) => n.metadata?.name)
  if (firstNode?.metadata?.name) {
    const one = await getResource({ scope: kind('nodes'), name: firstNode.metadata.name })
    readName = one.error ? '' : ((one?.metadata?.name as string) ?? '')
    console.log(`getResource(Node/${firstNode.metadata.name}) =>`, readName || 'FAILED')
  }

  const tn = await topNodes()
  const tp = await topPods()
  console.log(`metrics: topNodes=${tn.items.length} topPods=${tp.items.length}`, tn.items[0] ? `node0=${tn.items[0].cpuNano ?? 0}n/${tn.items[0].memBytes ?? 0}B` : '')

  const sample = nodes[0]?.metadata?.name || ns[0]?.metadata?.name || ''
  console.log('\nSummary:', {
    context: current.context?.name,
    server: current.context?.server,
    nodes: nodes.length,
    namespaces: ns.length,
    pods: pods.length,
    readName,
    sample
  })

  if (!current.context || nodes.length === 0 || ns.length === 0 || readName === '') {
    throw new Error('SMOKE ASSERT FAILED: expected a context, >=1 node, >=1 namespace, and a readable node')
  }

  // ---------------------------------------------------------------
  // Typed-error assertions (USX-01). READ-ONLY: nothing here creates,
  // patches or deletes cluster resources. Runs AFTER the baseline so
  // the original summary output above is untouched.
  // ---------------------------------------------------------------
  await assertTypedErrors()

  console.log('\nSMOKE OK ✅')
}

async function assertTypedErrors(): Promise<void> {
  // A2: a missing resource yields a notFound-classified error result on the
  // SAME service functions the IPC handlers delegate to — not a phantom object.
  const missing = await getResource({
    scope: kind('configmaps'),
    namespace: 'default',
    name: 'soLensSmokeMissingResource12345'
  })
  if (!missing.error) {
    throw new Error('SMOKE ASSERT FAILED: getResource(missing) must return an in-band error, not a phantom object')
  }
  if (!isKubeApiError(missing.error) || missing.error.code !== 'notFound') {
    throw new Error(`SMOKE ASSERT FAILED: getResource(missing) expected notFound, got ${JSON.stringify(missing.error)}`)
  }
  if (missing.error.message.trim() === '') {
    throw new Error('SMOKE ASSERT FAILED: error results must carry a non-empty message')
  }
  if (missing.metadata || missing.apiVersion || missing.kind) {
    throw new Error('SMOKE ASSERT FAILED: a failed read must not fabricate object fields')
  }
  console.log('getResource(missing ConfigMap) => error', JSON.stringify(missing.error))

  // A1/A5: the same list path that used to `catch { return [] }` now
  // classifies an unreachable API server as `unreachable`. Achieved by
  // temporarily pointing the in-memory KubeConfig at a dead local port and
  // restoring the original active context afterwards — no cluster mutation
  // and no kubeconfig file change.
  const kc = getKubeConfig()
  const originalContext = kc.getCurrentContext()
  let deadList: Awaited<ReturnType<typeof listResources>> | undefined
  try {
    kc.addCluster({ name: 'soLensSmokeDeadCluster', server: 'http://127.0.0.1:1', skipTLSVerify: true })
    kc.addUser({ name: 'soLensSmokeDeadUser' })
    kc.addContext({
      name: 'soLensSmokeDeadContext',
      cluster: 'soLensSmokeDeadCluster',
      user: 'soLensSmokeDeadUser'
    })
    kc.setCurrentContext('soLensSmokeDeadContext')
    deadList = await listResources({ scope: kind('pods'), allNamespaces: true })
  } finally {
    const kept = kc.getContexts().filter((c) => c.name !== 'soLensSmokeDeadContext')
    ;(kc as unknown as { contexts: typeof kept }).contexts = kept
    kc.setCurrentContext(originalContext)
  }
  console.log('listResources(dead API server) => error', JSON.stringify(deadList?.error ?? null))
  if (deadList?.error?.code !== 'unreachable') {
    throw new Error(
      `SMOKE ASSERT FAILED: expected unreachable classification, got ${JSON.stringify(deadList?.error ?? null)}`
    )
  }
  if (deadList.items.length !== 0) {
    throw new Error('SMOKE ASSERT FAILED: a failed list must carry no items')
  }

  // A3 contrast: an empty SUCCESS — same call shape as the failure above —
  // resolves with items=[] and NO error (the API server lists any namespace
  // for this admin even one that has no objects). "Empty" and "failed" now
  // have different payloads and can never be confused.
  const emptyList = await listResources({
    scope: kind('configmaps'),
    namespace: 'soLens-empty-check'
  })
  if (emptyList.error || emptyList.items.length !== 0) {
    throw new Error(
      `SMOKE ASSERT FAILED: expected an empty-but-successful list, got ${JSON.stringify(emptyList.error ?? `${emptyList.items.length} items`)}`
    )
  }
  console.log('list failure vs empty => failure carries error.code; empty success is items=[] with no error')

  // Context fully restored: baseline calls must still work.
  const after = await listNodes()
  if (after.error || after.items.length === 0) {
    throw new Error('SMOKE ASSERT FAILED: context was not restored after the unreachable probe')
  }
}

main().catch((err) => {
  console.error('\nSMOKE FAILED:', err?.message ?? err)
  process.exit(1)
})
