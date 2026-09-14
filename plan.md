# mom-lens — Implementation Backlog

Feature parity plan for mom-lens vs Lens Desktop. Rewritten from the original Lens feature
overview (kept in git history) into an actionable backlog mapped to the contracts in
`ARCHITECTURE.md`, `src/shared/types.ts`, and `src/shared/ipc.ts`.

Format: `- [ ] ID Title — files: … — verify: … — covers: ACx` (`depends:` / `parallel:` where relevant).

## Non-goals

- Lens Sync / Teams / cloud Spaces (account features).
- Lens Extensions API / plugin runtime (revisit only after epics A–J ship).
- 1-click deployment of a Lens-managed metrics stack (read-only Prometheus detection only).

## Status snapshot (vs original feature overview)

| Area | Status |
| --- | --- |
| Kubeconfig discovery, context switch, generic list/watch/delete/apply CRUD | done |
| ~24 built-in kinds with kind-aware columns, detail, YAML edit/create | done |
| Pod logs, exec terminal, metrics-server CPU/Mem bars, AI chat page | done |
| Missing resource kinds (NetworkPolicy, ResourceQuota, PDB, Gateway API, …) | epic B |
| Quick actions (scale/restart/rollback/cordon/drain/suspend), secret reveal | epic C |
| CRD discovery + generic CR views | epic D |
| Prometheus time-series | epic E |
| Log filtering, multi-pod logs, port-forward, bottom dock | epic F |
| Helm charts/releases | epic G |
| RBAC relation views | epic H |
| AI contextual actions | epic I |
| Command palette, nav history | epic J |

## Acceptance Criteria

- **AC1** — Every built-in kind listed in the original feature overview has a sidebar entry,
  list columns, detail summary, and create template.
- **AC2** — Common day-2 actions (scale, rollout restart/undo, cordon/drain, suspend,
  trigger job, reveal secret) work from list/detail with confirmation on destructive ones.
- **AC3** — Any CRD installed in the cluster is browsable with dynamic columns; no CLI needed.
- **AC4** — Cluster/node/pod pages show CPU/memory time-series when Prometheus is reachable;
  a hint is shown when it is not.
- **AC5** — Logs support filtering/regex/timestamps/download and simultaneous streaming across
  a workload's pods; port-forwards can be started/stopped from the UI.
- **AC6** — Helm repos, chart install with a values editor, and release list/rollback/upgrade work.
- **AC7** — RBAC bindings show their subjects and referenced role; SA→binding lookup exists.
- **AC8** — AI can explain the resource being viewed and generate YAML for the current kind.
- **AC9** — Cmd/Ctrl+Shift+P opens a palette that jumps to any kind/namespace/context;
  back/forward work across cluster views.

---

## Epic A — Cluster connections & contexts

- [ ] A1 kubeconfig file watcher — rescan on `~/.kube/config` mtime change, refresh contexts
  list live — files: `src/main/k8s/kubeconfig.ts`, `src/main/ipc/registerIpc.ts` —
  verify: `pnpm test:k8s` + edit config while dev running, catalog updates without restart — covers: AC9
- [ ] A2 add-cluster from raw YAML — "Add cluster" modal on CatalogPage that pastes/drops a
  kubeconfig, merges via `kc.loadYaml`, marks added contexts distinctly —
  files: `src/main/k8s/kubeconfig.ts`, `src/renderer/src/features/catalog/index.tsx`, new IPC in `src/shared/*` —
  verify: paste a second kubeconfig, new contexts listed and switchable — covers: AC9
- [ ] A3 connection heartbeat + auto-reconnect — periodic `getCurrentCluster` probe with
  latency shown in `connectionMeta`; on `useContext` failure, exponential retry with status
  dot state — files: `src/renderer/src/components/layout/*`, `src/main/k8s/kubeconfig.ts` —
  verify: break network/VPN for 30 s, dot flips to reconnecting then online — covers: AC9

## Epic B — Missing resource kinds

Add to `RESOURCE_CATALOG`, `columns.ts`, `ResourceDetailPage.summaryFields`, `CREATE_TEMPLATES`.

- [ ] B1 NetworkPolicy — columns: pod selector, policy types; detail shows ingress/egress
  rules + CIDRs — files: `src/shared/types.ts`, `src/renderer/src/features/resources/columns.ts`,
  `ResourceDetailPage.tsx` — verify: list renders against a cluster with calico policies — covers: AC1 `parallel: true`
- [ ] B2 ResourceQuota + LimitRange — columns: requested/limit CPU+Mem summary — files: same
  as B1 — verify: quotas listed for a limited namespace — covers: AC1 `parallel: true`
- [ ] B3 PodDisruptionBudget + PriorityClass — PDB columns: minAvailable/maxUnavailable,
  current healthy count — files: same as B1 — verify: PDBs render — covers: AC1 `parallel: true`
- [ ] B4 Gateway API kinds (Gateway, HTTPRoute, ReferenceGrant) — gated on
  `discovery.k8s.io`-style API presence check, hidden from sidebar when CRDs absent —
  files: `src/shared/types.ts`, `Sidebar.tsx`, columns — verify: hidden on bare cluster, shown
  when gateway-api CRDs installed — covers: AC1
- [ ] B5 Ingress detail view — hosts→path→backend table, TLS secret links, class + annotations —
  files: `ResourceDetailPage.tsx`, `columns.ts` — verify: nginx ingress renders routing table — covers: AC1
- [ ] B6 HPA detail — target vs current utilization, min/max, scale target ref link —
  files: `ResourceDetailPage.tsx`, `columns.ts` — verify: HPA page shows targets — covers: AC1
- [ ] B7 PVC/PV detail — phase, bound volume link, capacity, access modes, storage class link —
  files: `ResourceDetailPage.tsx` — verify: bound PVC shows volume + class — covers: AC1
- [ ] B8 Events page — chronological watch, involved-object/reason/type columns, type chips,
  per-resource filter link from detail pages — files: `features/resources/*` (specialized view),
  `src/shared/types.ts` (sort by lastTimestamp) — verify: FailedScheduling event appears live — covers: AC1

## Epic C — CRUD quick actions

Shared: a `ResourceActionMenu` in list rows + detail header; mutating calls go through new
`k8s:patch` / `k8s:subresource` IPC (extend `SoLensApi` additively). Destructive actions
(drain, delete) need a confirm modal echoing the name.

- [ ] C1 `patchResource` IPC primitive (strategic-merge + JSON patch) —
  files: `src/main/k8s/resources.ts`, `registerIpc.ts`, `src/shared/*`, `src/preload/index.ts` —
  verify: `pnpm test:k8s` smoke patches a deployment annotation — covers: AC2
- [ ] C2 Replica scaling — +/- stepper and number input on Deployment/StatefulSet/ReplicaSet —
  depends: C1 — verify: scale nginx 1→2→1 via UI, status follows — covers: AC2
- [ ] C3 Rollout restart — annotation patch on Deployment/DaemonSet/StatefulSet with
  timestamp, toast + watch shows new pods — depends: C1 — verify: restart triggers pod churn — covers: AC2
- [ ] C4 Rollback + revision history — Deployment `.spec.revisionHistoryLimit` entries via
  ControllerRevision list; "rollback to revision N" via `apps/v1` `deployments/rollback`
  subresource — depends: C1 — files: `src/main/k8s/resources.ts`, `ResourceDetailPage.tsx` —
  verify: deploy two images, roll back to v1 — covers: AC2
- [ ] C5 Node cordon/uncordon — `spec.unschedulable` patch + button state — depends: C1 —
  verify: cordoned node shows SchedulingDisabled — covers: AC2
- [ ] C6 Node drain — backend endpoint evicting pods (`policies/v1` eviction API), respect
  `--ignore-daemonsets`, confirm modal with pod preview — depends: C1 —
  files: `src/main/k8s/resources.ts`, `ResourceDetailPage.tsx` — verify: drain/cordon test node,
  non-DS pods reschedule — covers: AC2
- [ ] C7 CronJob suspend/resume + manual trigger — suspend patch; trigger = create Job from
  spec with name suffix (same as `kubectl create job --from=cronjob`) — depends: C1 —
  verify: trigger creates job, suspends flips flag — covers: AC2
- [ ] C8 Job actions — delete, suspend, resume (`.spec.suspend` patch) — depends: C1 —
  verify: suspended job stops progressing — covers: AC2 `parallel: true`
- [x] C9 Secret reveal/copy/edit — per-key mask toggle with base64 decode, copy, plain→base64
  encode on save — files: `ResourceDetailPage.tsx` (secrets case) — verify: reveal shows plaintext,
  edit round-trips — covers: AC2
- [ ] C10 Labels/annotations editor — key/value rows with add/remove, patch on save, from
  detail header for any kind — depends: C1 — verify: label appears in `kubectl get --show-labels` — covers: AC2

## Epic D — CRDs & custom resources

- [ ] D1 CRD discovery IPC — `listApiResources()` returning apiextensions groups/versions/
  resources + `additionalPrinterColumns` + namespaced flag — files: `src/main/k8s/resources.ts`,
  `registerIpc.ts`, `src/shared/*` — verify: `pnpm test:k8s` prints CRD list on a cluster with
  cert-manager — covers: AC3
- [ ] D2 Sidebar "Custom Resources" section — one entry per CRD under a group header, links to
  `/cluster/resources/<plural>.<group>` — depends: D1 — files: `Sidebar.tsx` — covers: AC3 `parallel: true`
- [ ] D3 Generic CR list/detail rendering — `findResourceKind` falls back to parsed CR scope;
  dynamic columns from additionalPrinterColumns (fallback: Name/Age); YAML tab already works —
  depends: D1 — files: `src/shared/types.ts`, `ResourceListPage.tsx`, `ResourceTable.tsx` —
  verify: browse Certificates + their YAML — covers: AC3
- [ ] D4 Watch + delete on CR scopes — reuse watch/delete with CR apiVersion paths —
  depends: D3 — verify: edit a CR in-cluster, row updates live — covers: AC3

## Epic E — Observability (Prometheus)

- [ ] E1 Prometheus endpoint detection — probe `monitoring/kube-prometheus-stack-prometheus`
  svc + `prometheus-operated` + `prometheus` in common namespaces; store per-context; expose
  `promInfo()` IPC — files: `src/main/k8s/metrics.ts`, `src/shared/*` —
  verify: on kube-prometheus-stack cluster reports URL, otherwise `available:false` — covers: AC4
- [ ] E2 PromQL query proxy + chart primitives — `promQueryRange(query, range, step)` via raw
  request; lightweight SVG line-chart component (no chart lib unless justified) — depends: E1 —
  files: `src/main/k8s/metrics.ts`, new `src/renderer/src/components/charts/` — covers: AC4
- [ ] E3 Cluster overview charts — CPU cores, memory committed vs used, pod count vs capacity —
  depends: E2 — files: `features/overview/index.tsx` — verify: graphs render with 1 h window — covers: AC4
- [ ] E4 Node detail charts — CPU/Mem allocatable vs usage, disk I/O, network in/out —
  depends: E2 — files: `ResourceDetailPage.tsx` (nodes case) — covers: AC4 `parallel: true`
- [ ] E5 Pod detail charts — CPU throttling, memory working set, OOM risk badge —
  depends: E2 — files: `ResourceDetailPage.tsx` (pods case) — covers: AC4 `parallel: true`
- [ ] E6 No-Prometheus fallback — banner on overview/detail: "metrics-server only", link to
  docs, keep current bars — depends: E1 — covers: AC4

## Epic F — Developer workflows

- [x] F1 Log viewer controls — substring + regex filter, timestamps toggle, previous-container
  toggle, download — files: `features/devtools/PodLogs.tsx`, `useLogBuffer.ts` —
  verify: regex filter hides non-matching lines live — covers: AC5
- [ ] F2 Multi-pod logs — pick Deployment/StatefulSet → fan out one `logsStart` per pod
  (cap ~10), colored pod prefix, follow — depends: F1 —
  files: `features/devtools/index.tsx`, `usePodContainers.ts` — covers: AC5
- [ ] F3 Port-forward manager — `portForwardStart/Stop` IPC via `@kubernetes/client-node`
  `PortForward` on random-or-chosen local ports, active-forwards list with start/stop +
  "open in browser", persists per session — files: `src/main/k8s/streams.ts`, `src/shared/*`,
  new `features/portforward/` — verify: forward nginx:80, curl localhost works — covers: AC5
- [ ] F4 Bottom dock — persistent dock (Terminal tab reusing exec streams, Logs, Port-forwards)
  surviving navigation; opens from pod detail/list actions — depends: F3 —
  files: `components/layout/AppLayout.tsx`, `features/devtools/*` — covers: AC5

## Epic G — Helm

- [ ] G1 Helm service (CLI wrapper) — spawn `helm` (no shell): repo add/list/update,
  search, install/upgrade/rollback/uninstall, get values, history; IPC surface + `helmInfo()`
  availability probe — files: new `src/main/helm/helm.ts`, `registerIpc.ts`, `src/shared/*` —
  verify: `pnpm test:k8s` lists repos + installed releases — covers: AC6
- [ ] G2 Charts page — repo list (default: add bitnami on first run), chart search, chart
  detail with README + default values — depends: G1 — files: new `features/helm/ChartsPage.tsx` — covers: AC6
- [ ] G3 Install wizard — namespace select + values.yaml CodeMirror editor (reuse
  `YamlEditor`) + dry-run diff + progress — depends: G2 — covers: AC6
- [ ] G4 Releases page — per-release status/chart/version, values view, diff old/new values,
  upgrade + 1-click rollback to history revision, uninstall with confirm — depends: G1 —
  files: new `features/helm/ReleasesPage.tsx` — verify: rollback nginx release to rev 1 — covers: AC6
- [ ] G5 Sidebar Helm section + routes — Charts/Releases nav entries wired into App routes —
  depends: G2, G4 — files: `App.tsx`, `Sidebar.tsx` — covers: AC6

## Epic H — RBAC relation views

- [ ] H1 Binding relation views — RoleBinding/ClusterRoleBinding detail shows subjects table
  and role rules fetched via `getResource` (roleRef lookup) —
  files: `ResourceDetailPage.tsx` — verify: binding page shows bound subjects + rules — covers: AC7
- [ ] H2 Role/ClusterRole "used by" panel — list bindings whose roleRef matches (filtered
  client-side from one bindings list) — depends: H1 — covers: AC7
- [ ] H3 ServiceAccount detail — linked secrets/token status + bindings referencing it —
  depends: H1 — covers: AC7

## Epic I — AI contextual actions

- [ ] I1 "Explain this resource" — detail-page button → `/cluster/ai?ask=…` with kind +
  trimmed YAML (strip noisy status/managedFields) prefilled — files: `ResourceDetailPage.tsx`,
  `features/ai/index.tsx` — verify: prefill contains kind/name, answer streams — covers: AC8
- [ ] I2 "Generate YAML" — list-page button → AI composer prompt for current kind + active
  namespace; "insert into Create modal" applies the answer's fenced YAML block —
  depends: I1 — files: `features/ai/index.tsx`, `CreateModal.tsx` — covers: AC8

## Epic J — Shell / navigation

- [ ] J1 Command palette — Cmd/Ctrl+Shift+P fuzzy finder over resource kinds, namespaces,
  contexts, nav commands (reuse the `fuzzysort` dep in package.json) —
  files: new `components/palette/`, `AppLayout.tsx` — verify: `pod⏎` navigates to Pods keeping `?ns=` — covers: AC9
- [ ] J2 Navigation history + breadcrumbs — in-page back/forward honoring `?ns=`, breadcrumb
  for resource detail (Kind / Namespace / Name) — files: `AppLayout.tsx`, `TopBar.tsx`,
  `ResourceDetailPage.tsx` — covers: AC9

## Deferred (no task breakdown yet)

- Workspaces/cluster grouping by env/provider/client (superseded by Lens Sync non-goal if that
  ever changes).
- Proxy/jump-host configuration UI (needs real proxy env to verify).
- Ephemeral/debug-container attach (`kubectl debug` equivalent).
- Extensions API.

## Open questions

- Helm: shell out to `helm` CLI (needs binary) vs `@kubernetes/client-node`-based lib —
  which ships in the packaged Electron app? (owner: lead)
- Port-forward over VPN/mTLS clusters: does `PortForward` SPDY path work through the proxy
  setup used by A3? (owner: backend, after A3)
- Metrics stack auto-install ("1-click deploy Prometheus") — re-add to scope? (owner: requester)
