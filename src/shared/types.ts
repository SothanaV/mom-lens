// Shared domain types + the renderer-facing API contract (implemented by preload, consumed by renderer).
// This is the frozen contract for the whole team. Do not change existing shapes; add new fields optionally.

export interface KubeContext {
  name: string
  cluster: string
  user: string
  namespace?: string
  current?: boolean
}

export interface ContextInfo {
  name: string
  cluster: string
  server: string
  user: string
}

/** A loosely-typed Kubernetes object. Renderers read well-known fields; extra data is kept as-is. */
export interface KubeObject {
  apiVersion?: string
  kind?: string
  metadata?: {
    name?: string
    namespace?: string
    uid?: string
    resourceVersion?: string
    creationTimestamp?: string
    labels?: Record<string, string>
    annotations?: Record<string, string>
    ownerReferences?: { kind?: string; name?: string }[]
  }
  [key: string]: unknown
}

export interface ResourceKind {
  /** API group, '' for core. */
  group: string
  version: string
  /** plural resource name, e.g. 'pods'. */
  resource: string
  /** Kind, e.g. 'Pod'. */
  kind: string
  namespaced: boolean
  /** UI grouping category, e.g. 'Workloads'. */
  category: string
}

export interface ResourceScopeRef {
  scope: ResourceKind
  namespace?: string
  name: string
}

export interface ListRequest {
  scope: ResourceKind
  namespace?: string
  allNamespaces?: boolean
}

/** Paged variant of ListRequest (server-side `limit` + `continue`). */
export interface ListPageRequest extends ListRequest {
  /** Max items the API server should serialize for this page. */
  limit: number
  /** Opaque token from the previous page; omit for the first page. */
  continueToken?: string
}

export interface ListPage extends KubeResult {
  items: KubeObject[]
  /** Present while the server has more pages left. */
  continueToken?: string
}

/** Result of a list call: items plus an in-band failure, so [].length 0 always means truly zero. */
export interface KubeListResult extends KubeResult {
  items: KubeObject[]
}

/** Result of a single-object read: the object on success, an in-band failure on error.
 *
 * This is deliberately NOT a `{ obj?, error? }` envelope: keeping the raw API
 * object as the success payload preserves the frozen `Promise<KubeObject>`
 * contract (A6) so resource-catalog renderers keep working unchanged. The one
 * collision — a real object with a top-level `error` key — cannot occur for
 * reads through this path: per Kubernetes API convention `error` is not a
 * top-level field of any API object, and API *failures* arrive as `Status`,
 * which this handler never returns as a success body. Consumers check
 * `result.error` (via `isKubeApiError`) before treating the payload as object
 * data, so the envelope types above need no such caveat.
 */
export type GetResult = KubeObject & KubeResult

/** Result of one metrics-server probe (nodes or pods), surfaced via topNodes/topPods. */
export interface MetricsResult<T> extends KubeResult {
  items: T[]
  /** False when the request failed for a reason other than metrics-server being absent. */
  available: boolean
}

export type NodeMetricsResult = MetricsResult<NodeMetrics>
export type PodMetricsResult = MetricsResult<PodMetrics>

/** Failure classes every failing k8s call reports. */
export type KubeErrorCode =
  | 'forbidden'
  | 'notFound'
  | 'timeout'
  | 'unreachable'
  | 'conflict'
  | 'invalid'
  | 'unknown'

/**
 * The one typed error shape that crosses IPC for a failing k8s call.
 * `code` is the discriminant the renderer narrows on; `message` is always
 * non-empty and human-safe; `hint` optionally says what to do next.
 */
export interface KubeApiError {
  code: KubeErrorCode
  message: string
  hint?: string
}

/** Mixed into result objects that report failure in-band (instead of faking data). */
export interface KubeResult {
  error?: KubeApiError
}

/** Result of listing the kubeconfig contexts; `error` set when the kubeconfig fails to load. */
export interface KubeContextsResult extends KubeResult {
  items: KubeContext[]
}

/** Result of reading the current context: `context` absent + `error` absent means "none selected". */
export interface CurrentContextResult extends KubeResult {
  context?: ContextInfo
}

const KUBE_ERROR_CODES: readonly KubeErrorCode[] = [
  'forbidden',
  'notFound',
  'timeout',
  'unreachable',
  'conflict',
  'invalid',
  'unknown'
]

/** True when `value` is an in-band {@link KubeApiError} (and not a real API object). */
export function isKubeApiError(value: unknown): value is KubeApiError {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.message === 'string' &&
    typeof v.code === 'string' &&
    KUBE_ERROR_CODES.includes(v.code as KubeErrorCode)
  )
}

export interface LogRequest {
  namespace: string
  podName: string
  container?: string
  tailLines?: number
  follow?: boolean
  timestamps?: boolean
  previous?: boolean
}

export interface ExecRequest {
  namespace: string
  podName: string
  container?: string
  command: string[]
  tty?: boolean
}

export interface ResourceEvent {
  id: string
  type: 'ADDED' | 'MODIFIED' | 'DELETED' | 'ERROR' | 'BOOKMARK'
  object: KubeObject
}

export interface LogsData {
  id: string
  chunk: string
}

export interface ExecData {
  id: string
  stream: 'stdout' | 'stderr'
  chunk: string
}

export interface NodeMetrics {
  name: string
  cpuNano?: number
  cpuCapacityNano?: number
  memBytes?: number
  memCapacityBytes?: number
}

export interface PodMetrics {
  namespace: string
  name: string
  cpuNano?: number
  memBytes?: number
  containers?: { name: string; cpuNano: number; memBytes: number }[]
}

export interface ActionResult {
  ok: boolean
  message?: string
  /** Typed failure classification (additive: `ok`/`message` keep their old meaning). */
  error?: KubeApiError
}

/** Availability of a local LLM runner (opencode). */
export interface AiInfo {
  available: boolean
  path?: string
  version?: string
  message?: string
}

export interface AiRequest {
  prompt: string
  model?: string
  agent?: string
  session?: string
  cwd?: string
}

/** A streamed assistant text chunk for a running prompt. */
export interface AiData {
  id: string
  chunk: string
}

/** Emitted once when a prompt finishes (or errors). */
export interface AiDone {
  id: string
  sessionID?: string
  error?: string
  cost?: number
}

/** The API exposed on `window.api` by the preload script. */
export interface SoLensApi {
  k8s: {
    listContexts(): Promise<KubeContextsResult>
    useContext(name: string): Promise<ContextInfo>
    currentContext(): Promise<CurrentContextResult>
    listNodes(): Promise<KubeListResult>
    listNamespaces(): Promise<KubeListResult>
    listResources(req: ListRequest): Promise<KubeListResult>
    listResourcesPage(req: ListPageRequest): Promise<ListPage>
    getResource(ref: ResourceScopeRef): Promise<GetResult>
    deleteResource(ref: ResourceScopeRef): Promise<ActionResult>
    applyYaml(yaml: string): Promise<ActionResult>
    topNodes(): Promise<NodeMetricsResult>
    topPods(namespace?: string): Promise<PodMetricsResult>
    watchStart(id: string, req: ListRequest): Promise<boolean>
    watchStop(id: string): Promise<boolean>
    logsStart(id: string, req: LogRequest): Promise<boolean>
    logsStop(id: string): Promise<boolean>
    execStart(id: string, req: ExecRequest): Promise<boolean>
    execWrite(id: string, data: string): Promise<void>
    execResize(id: string, cols: number, rows: number): Promise<void>
    execStop(id: string): Promise<void>
  }
  ai: {
    info(): Promise<AiInfo>
    listModels(): Promise<string[]>
    start(id: string, req: AiRequest): Promise<boolean>
    stop(id: string): Promise<void>
  }
  events: {
    onResourceEvent(cb: (e: ResourceEvent) => void): () => void
    onLogsData(cb: (e: LogsData) => void): () => void
    onLogsError(cb: (e: { id: string; message: string }) => void): () => void
    onExecData(cb: (e: ExecData) => void): () => void
    onExecExit(cb: (e: { id: string; code: number }) => void): () => void
    onAiData(cb: (e: AiData) => void): () => void
    onAiDone(cb: (e: AiDone) => void): () => void
  }
}

export const RESOURCE_CATALOG: ResourceKind[] = [
  // Workloads
  { group: '', version: 'v1', resource: 'pods', kind: 'Pod', namespaced: true, category: 'Workloads' },
  { group: 'apps', version: 'v1', resource: 'deployments', kind: 'Deployment', namespaced: true, category: 'Workloads' },
  { group: 'apps', version: 'v1', resource: 'statefulsets', kind: 'StatefulSet', namespaced: true, category: 'Workloads' },
  { group: 'apps', version: 'v1', resource: 'daemonsets', kind: 'DaemonSet', namespaced: true, category: 'Workloads' },
  { group: 'apps', version: 'v1', resource: 'replicasets', kind: 'ReplicaSet', namespaced: true, category: 'Workloads' },
  { group: 'batch', version: 'v1', resource: 'jobs', kind: 'Job', namespaced: true, category: 'Workloads' },
  { group: 'batch', version: 'v1', resource: 'cronjobs', kind: 'CronJob', namespaced: true, category: 'Workloads' },
  { group: 'autoscaling', version: 'v2', resource: 'horizontalpodautoscalers', kind: 'HorizontalPodAutoscaler', namespaced: true, category: 'Workloads' },
  // Discovery & Network
  { group: '', version: 'v1', resource: 'services', kind: 'Service', namespaced: true, category: 'Network' },
  { group: 'networking.k8s.io', version: 'v1', resource: 'ingresses', kind: 'Ingress', namespaced: true, category: 'Network' },
  { group: 'networking.k8s.io', version: 'v1', resource: 'ingressclasses', kind: 'IngressClass', namespaced: false, category: 'Network' },
  { group: '', version: 'v1', resource: 'endpoints', kind: 'Endpoints', namespaced: true, category: 'Network' },
  // Config & Storage
  { group: '', version: 'v1', resource: 'configmaps', kind: 'ConfigMap', namespaced: true, category: 'Config' },
  { group: '', version: 'v1', resource: 'secrets', kind: 'Secret', namespaced: true, category: 'Config' },
  { group: '', version: 'v1', resource: 'persistentvolumeclaims', kind: 'PersistentVolumeClaim', namespaced: true, category: 'Storage' },
  { group: '', version: 'v1', resource: 'persistentvolumes', kind: 'PersistentVolume', namespaced: false, category: 'Storage' },
  { group: 'storage.k8s.io', version: 'v1', resource: 'storageclasses', kind: 'StorageClass', namespaced: false, category: 'Storage' },
  // Cluster
  { group: '', version: 'v1', resource: 'nodes', kind: 'Node', namespaced: false, category: 'Cluster' },
  { group: '', version: 'v1', resource: 'namespaces', kind: 'Namespace', namespaced: false, category: 'Cluster' },
  { group: '', version: 'v1', resource: 'serviceaccounts', kind: 'ServiceAccount', namespaced: true, category: 'Access Control' },
  { group: 'rbac.authorization.k8s.io', version: 'v1', resource: 'roles', kind: 'Role', namespaced: true, category: 'Access Control' },
  { group: 'rbac.authorization.k8s.io', version: 'v1', resource: 'rolebindings', kind: 'RoleBinding', namespaced: true, category: 'Access Control' },
  { group: 'rbac.authorization.k8s.io', version: 'v1', resource: 'clusterroles', kind: 'ClusterRole', namespaced: false, category: 'Access Control' },
  { group: 'rbac.authorization.k8s.io', version: 'v1', resource: 'clusterrolebindings', kind: 'ClusterRoleBinding', namespaced: false, category: 'Access Control' },
  { group: '', version: 'v1', resource: 'events', kind: 'Event', namespaced: true, category: 'Cluster' }
]

export function findResourceKind(resource: string): ResourceKind | undefined {
  return RESOURCE_CATALOG.find((r) => r.resource === resource)
}

export function apiVersionOf(kind: ResourceKind): string {
  return kind.group ? `${kind.group}/${kind.version}` : kind.version
}

/** YAML templates used by the "Create" editor for each resource kind. */
export const CREATE_TEMPLATES: Record<string, string> = {
  endpoints: `apiVersion: v1
kind: Endpoints
metadata:
  name: my-endpoints
  namespace: default
subsets:
  - addresses:
      - ip: 10.0.0.1
    ports:
      - port: 80
        protocol: TCP
`,
  storageclasses: `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: my-storageclass
provisioner: kubernetes.io/aws-ebs
parameters:
  type: gp3
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
`,
  ingressclasses: `apiVersion: networking.k8s.io/v1
kind: IngressClass
metadata:
  name: my-ingressclass
spec:
  controller: example.com/ingress-controller
`
}

export function getCreateTemplate(resource: string): string | undefined {
  return CREATE_TEMPLATES[resource]
}
