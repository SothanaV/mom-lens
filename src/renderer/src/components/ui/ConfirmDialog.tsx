import { useCallback, useEffect, useId, useRef, useState } from 'react'

interface ConfirmDialogProps {
  /** Dialog heading; also what `aria-labelledby` points at. */
  title: string
  /** Body content: a plain string or markup (mono kind/namespace/name echoes). */
  body: React.ReactNode
  /** Label of the action button ("Delete", "Apply"…). Swapped while pending. */
  confirmLabel: string
  /**
   * Runs when the user confirms. Awaited: while the promise is in flight the
   * dialog is inert (confirm disabled + "label…" blinking, Cancel/backdrop/
   * Escape ignored). The parent decides what happens next — closing the
   * dialog, routing, showing a CallError — nothing here does.
   */
  onConfirm: () => Promise<void> | void
  /** Dismiss: Cancel button, Escape, or (armed) backdrop click. */
  onCancel: () => void
  /** Danger tones get the red confirm button and the backdrop-click guard. */
  tone: 'danger' | 'default'
  /** When set, confirm stays disabled until the user types this exact text. */
  requireTyping?: string
}

/** Wall-clock grace before a backdrop click can dismiss a danger dialog —
 * absorbs the second click of a double-click that opened the dialog. */
const BACKDROP_ARM_MS = 300

/** Bookkeeping for one mount of the focus effect (see `focusRunRef`). */
interface FocusRun {
  /** Set when a newer effect run supersedes this one: its deferred
   * focus-restore must then be dropped instead of yanking focus out of a
   * dialog that is still open. */
  cancelled: boolean
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')
  )
}

/**
 * Inline themed replacement for `window.confirm`: rendered in the React tree
 * (no portal lib), role=dialog + aria-modal, Tab trapped inside, Escape
 * cancels, focus moves in on open and back to the trigger element (matched
 * by DOM id, so route changes mid-flight cannot resurrect dead nodes) on
 * close. Nothing to lose by dismissing — no dirty-state handling by design.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  tone,
  requireTyping
}: ConfirmDialogProps): React.ReactElement {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const triggerIdRef = useRef<string>('')
  /**
   * The effect run that currently owns focus. A superseded run must not focus
   * anything from its deferred restore (see the focus effect below).
   */
  const focusRunRef = useRef<FocusRun | null>(null)
  const [typed, setTyped] = useState('')
  const [pending, setPending] = useState(false)
  const [backdropArmed, setBackdropArmed] = useState(false)
  const typingOk = requireTyping === undefined || typed === requireTyping

  // Render-time capture of the opener: this runs before the focus effect has
  // moved focus away, so activeElement is still the trigger button. Restored
  // by id on close (an unfocused guard happens naturally: gone → null).
  if (!triggerIdRef.current && document.activeElement instanceof HTMLElement) {
    triggerIdRef.current = document.activeElement.id
  }

  useEffect(() => {
    // StrictMode mounts, runs the effect, cleans it up and runs it again — all
    // in one synchronous pass, before the frame that the cleanup's rAF lands
    // on. Run 1's restore would then fire a frame late and yank focus back out
    // of a dialog run 2 has just opened and still holds. Each run owns a flag
    // and starting a run cancels the one it supersedes, so only the surviving
    // run (i.e. a real unmount, where no newer run exists) restores focus.
    const run: FocusRun = { cancelled: false }
    if (focusRunRef.current) focusRunRef.current.cancelled = true
    focusRunRef.current = run
    if (requireTyping !== undefined) inputRef.current?.focus()
    else cancelRef.current?.focus()
    const t = window.setTimeout(() => setBackdropArmed(true), BACKDROP_ARM_MS)
    return () => {
      window.clearTimeout(t)
      const id = triggerIdRef.current
      if (!id) return
      // Defer one frame: on the failure path the trigger may still carry
      // `disabled` while this unmount commits; after rAF the re-render has
      // settled and focus() sticks. If navigation already removed it, the
      // lookup finds nothing and we do nothing.
      window.requestAnimationFrame(() => {
        if (run.cancelled) return
        const opener = document.getElementById(id)
        if (opener && opener.isConnected) opener.focus()
      })
    }
  }, [requireTyping])

  const requestCancel = useCallback((): void => {
    // Inert while the confirmed call is in flight — a mid-delete Escape must
    // not strand the user behind an invisible pending request.
    if (pending) return
    onCancel()
  }, [pending, onCancel])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (!pending) {
          e.preventDefault()
          onCancel()
        }
        return
      }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const items = focusables(panel)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const inside = active instanceof HTMLElement && panel.contains(active)
      if (e.shiftKey && (!inside || active === first)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, pending])

  const runConfirm = async (): Promise<void> => {
    if (pending || !typingOk) return
    setPending(true)
    try {
      await onConfirm()
    } catch {
      // onConfirm classifies its own failures and closes the dialog; this
      // only unsticks the spinner so an unexpected throw cannot wedge it.
      setPending(false)
    }
  }

  const onBackdropClick = (): void => {
    if (tone === 'danger' && !backdropArmed) return
    requestCancel()
  }

  return (
    <div className="confirm-dialog__backdrop" onClick={onBackdropClick}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`confirm-dialog${tone === 'danger' ? ' confirm-dialog--danger' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} className="confirm-dialog__title">
          {title}
        </h3>
        <div className="confirm-dialog__body">{body}</div>
        {requireTyping !== undefined && (
          <label className="confirm-dialog__typing">
            <span className="confirm-dialog__typing-hint">
              Type <code className="mono">{requireTyping}</code> to confirm
            </span>
            <input
              ref={inputRef}
              className="confirm-dialog__input mono"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={pending}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
        )}
        <div className="confirm-dialog__actions">
          <button ref={cancelRef} className="btn" type="button" onClick={requestCancel}>
            Cancel
          </button>
          <button
            className={`btn confirm-dialog__confirm ${tone === 'danger' ? 'danger' : 'primary'}`}
            type="button"
            disabled={!typingOk || pending}
            onClick={() => void runConfirm()}
          >
            {pending ? (
              <>
                {confirmLabel}
                <span className="spin">…</span>
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
