// Headless integration test that exercises the REAL backend service functions
// (src/main/k8s/*) against the current KUBECONFIG. Run: pnpm test:k8s
import { listContexts, currentContext } from '../src/main/k8s/kubeconfig'
import {
  listNodes,
  listNamespaces,
  listResources,
  getResource,
  applyYaml
} from '../src/main/k8s/resources'
import { topNodes, topPods } from '../src/main/k8s/metrics'
import { findResourceKind } from '../src/shared/types'

function kind(r: string) {
  const k = findResourceKind(r)
  if (!k) throw new Error(`unknown resource kind in catalog: ${r}`)
  return k
}

async function main(): Promise<void> {
  const contexts = listContexts()
  const current = currentContext()
  console.log('contexts :', contexts.map((c) => c.name).join(', '))
  console.log('current  :', current?.name, '->', current?.server)

  const nodes = await listNodes()
  const ns = await listNamespaces()
  const pods = await listResources({ scope: kind('pods'), allNamespaces: true })
  const deployments = await listResources({ scope: kind('deployments'), allNamespaces: true })
  const services = await listResources({ scope: kind('services'), allNamespaces: true })

  console.log(`nodes=${nodes.length} namespaces=${ns.length} pods=${pods.length} deployments=${deployments.length} services=${services.length}`)

  // New kinds wired via the shared catalog: endpoints / storageclasses / ingressclasses.
  const endpoints = await listResources({ scope: kind('endpoints'), allNamespaces: true })
  const storageClasses = await listResources({ scope: kind('storageclasses'), allNamespaces: true })
  const ingressClasses = await listResources({ scope: kind('ingressclasses'), allNamespaces: true })
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
    readName = (one?.metadata?.name as string) ?? ''
    console.log(`getResource(Node/${firstNode.metadata.name}) =>`, readName || 'FAILED')
  }

  const tn = await topNodes()
  const tp = await topPods()
  console.log(`metrics: topNodes=${tn.length} topPods=${tp.length}`, tn[0] ? `node0=${tn[0].cpuNano ?? 0}n/${tn[0].memBytes ?? 0}B` : '')

  const sample = nodes[0]?.metadata?.name || ns[0]?.metadata?.name || ''
  console.log('\nSummary:', {
    context: current?.name,
    server: current?.server,
    nodes: nodes.length,
    namespaces: ns.length,
    pods: pods.length,
    readName,
    sample
  })

  if (!current || nodes.length === 0 || ns.length === 0 || readName === '') {
    throw new Error('SMOKE ASSERT FAILED: expected a context, >=1 node, >=1 namespace, and a readable node')
  }
  console.log('\nSMOKE OK ✅')
}

main().catch((err) => {
  console.error('\nSMOKE FAILED:', err?.message ?? err)
  process.exit(1)
})
