# mom-lens

A Lens-style Kubernetes IDE — Electron + React 18 + TypeScript, talking to your cluster
via `@kubernetes/client-node` in the main process. Built with a parallel AI team; see
`ARCHITECTURE.md` for the module/IPC contracts and file ownership.

## Features (v0.1)
- Cluster catalog (kube contexts) + cluster dashboard with metrics-server CPU/Mem bars
- Resource browser for ~20 built-in kinds (pods, deployments, services, nodes, …)
- Live watch (streaming list updates), kind-aware table columns, relative Age
- Resource detail with YAML view + delete
- Streaming pod logs (follow/clear/copy/download) and an interactive exec terminal (xterm.js)
- Namespace scoping via the top bar (`?ns=` query), Lens-like dark theme

## Requirements
- Node 20+, pnpm
- A reachable cluster via `KUBECONFIG` (metrics-server optional, for CPU/Mem)

## Setup
```bash
pnpm install
# pnpm v10+ blocks postinstall scripts by default; fetch the Electron binary:
node node_modules/electron/install.js     # or: pnpm approve-builds  -> allow electron
```

## Run
```bash
export KUBECONFIG=/path/to/your/kubeconfig
pnpm dev        # hot-reload dev
# or production:
pnpm build && pnpm start
```

## Test
```bash
export KUBECONFIG=/home/sothana/Desktop/ssh/mpt/sothanav-local.yaml
pnpm typecheck      # strict TS across main/preload/renderer
pnpm test:k8s       # headless: exercises real src/main/k8s services vs the cluster
pnpm build          # bundles main + preload + renderer
```

## Scripts
| script | what |
| --- | --- |
| `pnpm dev` | electron-vite dev (HMR) |
| `pnpm build` | production bundle to `out/` |
| `pnpm start` | preview the built bundle |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test:k8s` | cluster integration smoke test |
