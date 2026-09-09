# mom-lens — Architecture & Team Contract

This is the single source of truth. **Read this + `src/shared/types.ts` + `src/shared/ipc.ts` before coding.**
Everything renders from these contracts so team members can build in parallel without conflicts.

## Stack
- Electron (main + preload) + React 18 + TypeScript + Vite (via electron-vite)
- Kubernetes access via `@kubernetes/client-node` **only in the main process**
- Renderer talks to main ONLY through `window.api` (see `SoLensApi` in `src/shared/types.ts`)

## Imports / aliases
- Use the `@shared/*` alias (mapped in electron.vite + tsconfig) to import shared types/channels.
- Inside the renderer you may also use `@renderer/*`.
- React 18, function components, hooks. No CSS frameworks — plain CSS/inline styles + `theme.css`.

## File ownership (DO NOT edit files owned by another member)
- **LEAD (already written):** package.json, tsconfig.json, electron.vite.config.ts, src/main/index.ts,
  src/preload/**, src/shared/**, src/renderer/index.html, src/renderer/src/main.tsx, src/renderer/src/env.d.ts
- **backend:** `src/main/k8s/**`, `src/main/ipc/registerIpc.ts`
- **shell:** `src/renderer/src/App.tsx`, `src/renderer/src/theme.css`, `src/renderer/src/components/layout/**`
- **resources:** `src/renderer/src/features/resources/**`
- **devtools:** `src/renderer/src/features/devtools/**` (exports `PodLogs`, `PodTerminal`)
- **dashboard:** `src/renderer/src/features/overview/**` (exports default `OverviewPage`), `src/renderer/src/features/catalog/**` (exports default `CatalogPage`)

## Cross-module imports (fixed contracts — create/import EXACTLY these paths + names)
- shell imports as route pages:
  - `@renderer/features/overview` → default `OverviewPage`
  - `@renderer/features/catalog` → default `CatalogPage`
  - `@renderer/features/resources/ResourceListPage` → default component
  - `@renderer/features/resources/ResourceDetailPage` → default component
- resources imports devtools widgets:
  - `@renderer/features/devtools` → named `{ PodLogs, PodTerminal }`
    - `PodLogs` props: `{ namespace: string; podName: string }`
    - `PodTerminal` props: `{ namespace: string; podName: string }`

## Routing (owned by shell)
HashRouter. Routes:
- `/` → CatalogPage (cluster list / welcome)
- `/cluster/overview` → OverviewPage
- `/cluster/resources/:resource` → ResourceListPage (reads `:resource` = ResourceKind.resource)
- `/cluster/resources/:resource/:namespace/:name` → ResourceDetailPage

## IPC contract
- Channels in `src/shared/ipc.ts` (`CH.*`). Invoke channels return Promises.
- Streaming: main sends events to the invoking `webContents` (`event.sender`) using the `on*` channels in `CH`.
- Every streaming call is keyed by a renderer-generated `id` (string). Renderer passes `id` on start;
  main echoes `id` in every event so the renderer can route to the right component.

## Backend implementation notes (`@kubernetes/client-node`)
- Load kubeconfig via `KubeConfig.loadFromDefault()` (honors `KUBECONFIG` env).
- Generic list/read/delete of any built-in/CRD kind: `KubernetesObjectApi.makeApiClient(kc)`
  (`.list({apiVersion, kind, namespace, fieldSelector, labelSelector})`, `.read`, `.delete`).
- Watch: `new Watch(kc).watch(path, params, cb, done, err)` where path = `/api/v1/<res>` or `/apis/<group>/<version>/<res>`.
- Logs: `kc.makeApiClient(CoreV1Api).log(name, container, namespace, {follow, tailLines, timestamps, previous})` → stream `data`.
- Exec: `new Exec(kc).exec(ns, pod, container, command, stderrCb, {tty})` → `{ stdin, stdout, stderr }`.
- Metrics: use metrics-server raw path `/apis/metrics.k8s.io/v1beta1/nodes` and `.../pods` via `kc.makeApiClient(CustomObjectsApi)` or raw request.

## Testing
- `pnpm test:k8s` runs `scripts/smoke.ts` against the current `KUBECONFIG` (lists contexts/nodes/ns/pods).
- `pnpm build` must succeed and `pnpm start` must open the Electron window (testable under Xvfb).

## Namespace state contract
- The active namespace scope lives ONLY in the `?ns=` route query.
- Value grammar: `all` (or empty/absent) = all namespaces; otherwise a **comma-separated** list,
  e.g. `?ns=kube-system,monitoring`. Writers (TopBar selector) must emit this grammar; readers
  (ResourceListPage) parse `value.split(',').map(trim).filter(Boolean)`; length 0/`all` => allNamespaces.
- **Persistence across navigation**: every link that changes resource kind (sidebar) must carry the
  current `?ns=` so the selection survives switching kinds in the left sidebar.

## AI subsystem (opencode) — owned by the `ai` member
- Owns `src/main/ai/**` (exports `registerAiIpc()` from `src/main/ai/registerAi.ts`, already wired by
  the lead in `src/main/index.ts`) and `src/renderer/src/features/ai/**` (default export `AIPage`).
- Spawns `opencode run <prompt> --format json` (add `--model`, `--agent`, `--session` when provided)
  from the main process via `child_process.spawn` (resolved binary path, NO shell, prompt passed as an
  argv array so it is not injectable). Parses stdout JSON-lines: append `part.text` of every
  `{"type":"text"}` event as an `onAiData{ id, chunk }`; capture `sessionID` from any event; on child
  exit emit `onAiDone{ id, sessionID, error?, cost? }`. Resolve binary via env `SOLENS_OPENCODE_BIN`
  else `which opencode` else `opencode`. Run with a neutral cwd (a temp dir) and never pass `--auto`.
- Renderer `AIPage` route `/cluster/ai`; shell (App + Sidebar) owns that route + a nav item.
- "Ask AI" handoff: other pages navigate to `/cluster/ai?ask=<encodeURIComponent(prompt)>`; AIPage
  prefills the composer from `ask`. No shared store needed.
