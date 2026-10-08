import { useSyncExternalStore } from 'react'

export type ToastTone = 'success' | 'error' | 'info'

export interface ToastAction {
  label: string
  onClick: () => void
}

/** What a call site sends: `pushToast({ tone: 'success', title: 'Copied' })`. */
export interface ToastInput {
  tone: ToastTone
  /** One short line — the headline the user must read. Identifiers stay literal. */
  title: string
  /** Optional detail (raw API message, applied object…). Wraps, never truncates. */
  message?: string
  /** Optional single follow-up (e.g. "Retry" on a failed context switch). */
  action?: ToastAction
  /**
   * Dedupe id for a toast family: pushing again with the same key REPLACES the
   * earlier toast in its slot instead of stacking a duplicate — a repeated
   * failure of one action (Retry clicked twice) stays one readable error, not
   * a wall of the same message.
   */
  key?: string
}

/** A queued toast: the caller's payload plus the id the store manages it by. */
export interface ToastRecord extends ToastInput {
  id: string
}

/** More than four stacked toasts is a wall, not a notification. */
const MAX_VISIBLE = 4
/** success/info fade out on their own; errors stay until dismissed. */
const AUTO_DISMISS_MS = 5000

let records: ToastRecord[] = []
/**
 * Cached immutable snapshot: `useSyncExternalStore` compares snapshots by
 * identity, so it is replaced only when the queue actually changed.
 */
let snapshot: readonly ToastRecord[] = records

const listeners = new Set<() => void>()

/** Per-toast countdown bookkeeping (hover-pause lives here, not in React). */
interface Countdown {
  /** ms left to run (what it becomes while paused). */
  ms: number
  /** Wall-clock instant the toast expires (0 while paused). */
  deadline: number
  /** Pending timeout handle, absent while paused. */
  handle?: number
}
const counters = new Map<string, Countdown>()

let seq = 0

function notify(): void {
  snapshot = records
  for (const listener of listeners) listener()
}

function remove(id: string): void {
  stopCountdown(id)
  const idx = records.findIndex((t) => t.id === id)
  if (idx < 0) return
  const next = records.slice()
  next.splice(idx, 1)
  records = next
  notify()
}

function stopCountdown(id: string): void {
  const c = counters.get(id)
  if (!c) return
  if (c.handle !== undefined) window.clearTimeout(c.handle)
  counters.delete(id)
}

function startCountdown(id: string, ms: number): void {
  stopCountdown(id)
  const handle = window.setTimeout(() => {
    counters.delete(id)
    remove(id)
  }, ms)
  counters.set(id, { ms, deadline: Date.now() + ms, handle })
}

/**
 * Queue a toast. `success`/`info` auto-dismiss (timer pauses while hovered),
 * `error` stays until dismissed. Over MAX_VISIBLE the oldest visible toast is
 * evicted, errors included — the queue must never become a wall.
 * Safe to call right before a navigation: the store is module-level and the
 * region lives in AppLayout, so an unmounting page cannot take the toast down.
 */
export function pushToast(input: ToastInput): string {
  // Stable key ⇒ replace-in-place: the record KEEPS its original id (React
  // reconciles it as the same stack item), only the content refreshes.
  const existing = input.key ? records.find((t) => t.key === input.key) : undefined
  const id = existing?.id ?? `t${++seq}`
  const record: ToastRecord = { ...input, id }
  if (existing) {
    const idx = records.findIndex((t) => t.id === id)
    records = records.map((t, i) => (i === idx ? record : t))
  } else {
    records = [...records, record]
  }
  if (records.length > MAX_VISIBLE) {
    const evicted = records.slice(0, records.length - MAX_VISIBLE)
    records = records.slice(records.length - MAX_VISIBLE)
    for (const t of evicted) stopCountdown(t.id)
  }
  if (record.tone !== 'error') startCountdown(id, AUTO_DISMISS_MS)
  notify()
  return id
}

/** Dismiss one toast by id (the × button, Escape while focus is inside it). */
export function dismissToast(id: string): void {
  remove(id)
}

/** Freeze the auto-dismiss countdown while the pointer is over the toast. */
export function pauseToast(id: string): void {
  const c = counters.get(id)
  if (!c || c.handle === undefined) return
  window.clearTimeout(c.handle)
  counters.set(id, { ms: Math.max(0, c.deadline - Date.now()), deadline: 0 })
}

/** Resume the countdown after the pointer leaves, with the time still owed. */
export function resumeToast(id: string): void {
  const c = counters.get(id)
  if (!c || c.handle !== undefined) return
  startCountdown(id, c.ms)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): readonly ToastRecord[] {
  return snapshot
}

/** Reactive view of the queue (the region subscribes; call sites do not). */
export function useToasts(): readonly ToastRecord[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function Toast({ record }: { record: ToastRecord }): React.ReactElement {
  const isError = record.tone === 'error'
  return (
    <div
      className={`toast toast--${record.tone}`}
      // success/info announce politely, errors assertively.
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      onMouseEnter={() => pauseToast(record.id)}
      onMouseLeave={() => resumeToast(record.id)}
      // Escape reaches this handler only while focus is inside the toast, so a
      // stack of toasts can never hijack the Escape of an open dialog.
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.stopPropagation()
        dismissToast(record.id)
      }}
    >
      <div className="toast__text">
        <div className="toast__title">{record.title}</div>
        {record.message ? <div className="toast__message">{record.message}</div> : null}
      </div>
      {record.action ? (
        <button
          className="btn small toast__action"
          type="button"
          onClick={() => record.action?.onClick()}
        >
          {record.action.label}
        </button>
      ) : null}
      <button
        className="toast__dismiss"
        type="button"
        aria-label="Dismiss notification"
        onClick={() => dismissToast(record.id)}
      >
        ×
      </button>
    </div>
  )
}

/**
 * The one toast stack: mounted once by AppLayout so toasts survive route
 * changes. Stacked bottom-right above the statusbar line — the namespace
 * combobox lives in the topbar, and the region itself is pointer-events:none,
 * so it cannot steal a click anywhere (see theme.css).
 */
export function ToastRegion(): React.ReactElement {
  const toasts = useToasts()
  return (
    <div className="toast-region">
      {toasts.map((record) => (
        <Toast key={record.id} record={record} />
      ))}
    </div>
  )
}
