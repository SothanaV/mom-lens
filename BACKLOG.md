# Backlog — soLens usability ("make every feature easy to use")

Source: 3-agent usability audit of `src/renderer` + `src/main` (2026-10-08). Acceptance
criteria detail lives in each task's dispatch brief; `covers:` maps to the AC list below.

## Acceptance Criteria (usability ACs)

- **UAC1** — No API failure is ever rendered as an empty list, a blank page, or a fake
  detail page. 403 / 404 / timeout / unreachable are distinguishable and actionable.
- **UAC2** — Every mutating action (create, apply, save, delete, context switch, copy)
  produces visible, non-blocking feedback; destructive actions use a themed confirm that
  echoes kind + namespace + name.
- **UAC3** — An edited draft (YAML or secret) can never be destroyed by an accidental
  click, Escape, or navigation.
- **UAC4** — No write silently overwrites a concurrent change; conflicts surface to the user.
- **UAC5** — Every list/detail view is legible: real focus rings, no clipped text, k8s
  identifiers are never uppercased, every monospace field that matters is ≥12px, and
  relative ages expose an absolute timestamp.
- **UAC6** — List view state (search, page size, sort, namespace scope) survives
  navigation to a detail page and back.
- **UAC7** — A relationship shown on screen is a link; no dead text for ownerRef, node,
  namespace, storage class, or scale target.
- **UAC8** — Logs and the terminal never lie about their state (following/dropped lines/
  exited session) and can always be recovered without leaving the page.
- **UAC9** — No `className` in the renderer references a selector missing from
  `theme.css`; no undefined CSS custom property is referenced.

Ground rules for every task: `pnpm typecheck` stays strict-clean, no new deps without a
note, `IPC Contract Changes` convention per `ARCHITECTURE.md`, do not touch `BACKLOG.md`
or `LOOP.md`, do not commit.

---

## Queue

- [x] USX-01 main: typed k8s errors, stop swallowing failures as empty results (project: soLens) — verify: KUBECONFIG=/home/sothana/Desktop/ssh/mpt/sothanav-local.yaml pnpm test:k8s && pnpm typecheck — covers: UAC1
- [x] USX-02 renderer: error boundary + styled call-error panels replacing chip banners (project: soLens) — verify: pnpm typecheck && pnpm build — depends: USX-01 — covers: UAC1
- [x] USX-03 themed confirm dialog for Delete, namespace echoed, danger styling (project: soLens) — verify: pnpm typecheck && pnpm build — covers: UAC2
- [x] USX-04 toast system + feedback for copy/secret-save/context-switch/delete (project: soLens) — verify: pnpm typecheck && pnpm build — depends: USX-03 — covers: UAC2
- [ ] USX-05 skeleton loading + honest per-cause empty states (project: soLens) — verify: pnpm typecheck && pnpm build — depends: USX-02 — covers: UAC1
- [ ] USX-06 apply: optimistic concurrency, honest created/updated/conflict results (project: soLens) — verify: KUBECONFIG=/home/sothana/Desktop/ssh/mpt/sothanav-local.yaml pnpm test:k8s && pnpm typecheck — covers: UAC4
- [ ] USX-07 write UX: conflict resolution dialog, honest create target namespace, draft-safe close (project: soLens) — verify: pnpm typecheck && pnpm build — depends: USX-04, USX-06 — covers: UAC3
- [ ] USX-08 theme.css integrity: missing selectors, focus rings, select caret, contrast floor (project: soLens) — verify: pnpm typecheck && pnpm build && node scripts/css-classes-check.mjs — covers: UAC9
- [ ] USX-09 chips + typography: no uppercased identifiers, copyable labels, absolute ages (project: soLens) — verify: pnpm typecheck && pnpm build && node scripts/css-classes-check.mjs — depends: USX-08 — covers: UAC5
- [ ] USX-10 list state in URL: search, page size, sort survive navigation (project: soLens) — verify: pnpm typecheck && pnpm build — depends: USX-09 — covers: UAC6
- [ ] USX-11 whole-row navigation + per-row actions column (project: soLens) — verify: pnpm typecheck && pnpm build — depends: USX-03 — covers: UAC2
- [ ] USX-12 server-side search by name and label selector (project: soLens) — verify: KUBECONFIG=/home/sothana/Desktop/ssh/mpt/sothanav-local.yaml pnpm test:k8s && pnpm typecheck — depends: USX-10 — covers: UAC6
- [ ] USX-13 detail: relationship links + summary/columns for the 10 fall-through kinds (project: soLens) — verify: pnpm typecheck && pnpm build — depends: USX-09 — covers: UAC7
- [ ] USX-14 logs: dropped-line honesty, filter-aware copy/download, jump-to-latest (project: soLens) — verify: pnpm typecheck && pnpm build — covers: UAC8
- [ ] USX-15 terminal: reconnect control + exited-session recovery (project: soLens) — verify: pnpm typecheck && pnpm build — covers: UAC8
- [ ] USX-16 stream lifecycle: watch stale-and-retry banner, logs end signal (project: soLens) — verify: KUBECONFIG=/home/sothana/Desktop/ssh/mpt/sothanav-local.yaml pnpm test:k8s && pnpm typecheck — depends: USX-02 — covers: UAC8

## Deferred / out of this loop

Feature epics still live in `plan.md` (CRDs, Prometheus, Helm, port-forward, command
palette, RBAC views, drain/scale/rollout actions). This queue is usability defects only —
USX-11's row-action slot is the intended insertion point for `plan.md` C2/C3 later.

Follow-ups noted by testers (fold into the nearest touching task):
- toast.tsx: `if (existing) stopCountdown(id)` before re-arming countdown on a keyed
  replace (latent stale-timer / hover-pause restart; unreachable today). → USX-07.
- theme.css: `.toast:hover .toast__message { max-height:none }` un-caps tall error
  bodies on hover (contrast with the capped-collapse comment nearby). → USX-08.
