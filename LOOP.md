# Loop State

status: running
started: 2026-10-08T00:00
maxTasks: 12
maxRetries: 2
taskBudgetRemaining: 8

## Done
- USX-01 — 2026-10-08 (typed in-band kube errors; rejected once on the array-hybrid envelope that silently drops `error` across IPC, fixed + gated). `git log --grep 'Loop-Task: USX-01'`
- USX-02 — 2026-10-08 (error boundary + errorElement/NotFound + CallError/CallNotice panels; rejected once on an AI-composer draft-loss regression, fixed + gated). `git log --grep 'Loop-Task: USX-02'`
- USX-03 — 2026-10-08 (ConfirmDialog replacing window.confirm; passed first gate. Dev-StrictMode focus-restore quirk deferred to USX-04 per tester note). `git log --grep 'Loop-Task: USX-03'`
- USX-04 — 2026-10-08 (toast system: 8 wired sites, keyed replace-in-place, hover-pause; rejected once on the undefined --toast-gap token + duplicate stack on retry, fixed + gated). `git log --grep 'Loop-Task: USX-04'`

## Skipped

## Gates (override if repo differs)

No linter or formatter and no unit-test runner in this repo (verified: no eslint/prettier/
biome/vitest/jest config, `package.json` has no test runner). `pnpm test:k8s` is a headless
integration smoke against the live cluster, not a unit suite. Gate per project:

- soLens, renderer-only diff: `pnpm typecheck && pnpm build`
- soLens, any `src/main/**` or `src/shared/**` diff: `export KUBECONFIG=/home/sothana/Desktop/ssh/mpt/sothanav-local.yaml && pnpm test:k8s && pnpm typecheck && pnpm build`
- soLens, `theme.css` diff: additionally `node scripts/css-classes-check.mjs` (added by USX-08)

Baseline all-green at loop start: typecheck exit 0, build exit 0, test:k8s exit 0
(`nodes=1 namespaces=5 pods=12 deployments=4 services=8`, "SMOKE OK").

## Notes

- Queue and usability ACs: `BACKLOG.md`. Feature epics stay in `plan.md` — do not merge them in.
- `KUBECONFIG=/home/sothana/Desktop/ssh/mpt/sothanav-local.yaml` is required for any task whose
  verify is `pnpm test:k8s`. Cluster is a single-node local API server; 12 pods, 4 deployments.
- Kill the developer's own dev server if it left one running; never commit `out/` (gitignored).
