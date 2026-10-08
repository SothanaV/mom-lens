import type { KubeApiError, KubeErrorCode } from '@shared/types'
import { isKubeApiError } from '@shared/types'

/**
 * Human title per USX-01 error code. A 403 and a timeout must never read the
 * same; the code drives the title, the raw API message stays as the detail.
 */
const TITLES: Record<KubeErrorCode, string> = {
  forbidden: 'No access to these resources',
  notFound: 'Not found',
  timeout: 'The cluster took too long to respond',
  unreachable: "Can't reach the cluster",
  conflict: 'The resource changed underneath you',
  invalid: 'The request was rejected',
  unknown: 'The request failed'
}

export function errorTitle(code: KubeErrorCode): string {
  return TITLES[code]
}

/**
 * Coerce anything a call/site holds about a failure into the typed in-band
 * shape: pass-through for KubeApiError, structured-ish objects (ActionResult
 * fallbacks), JS Errors (IPC "Error invoking remote method ..." strings),
 * plain strings. Never returns null — there is always something to show.
 */
export function toKubeApiError(value: unknown): KubeApiError {
  if (isKubeApiError(value)) return value
  if (value && typeof value === 'object') {
    const v = value as { code?: unknown; message?: unknown; hint?: unknown }
    const candidate = { code: v.code, message: v.message, hint: v.hint }
    if (isKubeApiError(candidate)) return candidate
    const message = typeof v.message === 'string' && v.message ? v.message : JSON.stringify(value)
    return { code: 'unknown', message }
  }
  const message = String(value)
  return { code: 'unknown', message: message || 'Unknown error' }
}

interface CallErrorProps {
  /** The typed in-band failure (USX-01); titles are chosen from `error.code`. */
  error: KubeApiError
  /** Optional retry callback; a Retry button is rendered when supplied. */
  onRetry?: () => void
  /** Compact variant for dense spots (popover bodies, in-bubble notices). */
  compact?: boolean
  className?: string
}

/**
 * The one way a failed call is presented in the renderer: code-driven title,
 * raw message, optional hint, optional Retry. Multi-line safe — unlike `.chip`
 * it is not an 18px uppercase pill, so long k8s messages stay readable.
 */
export function CallError({ error, onRetry, compact, className }: CallErrorProps): React.ReactElement {
  return (
    <div
      role="alert"
      className={[
        'call-error',
        compact ? 'call-error--compact' : '',
        className ?? ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="call-error__title">{errorTitle(error.code)}</div>
      <div className="call-error__message">{error.message}</div>
      {error.hint ? <div className="call-error__hint">{error.hint}</div> : null}
      {onRetry ? (
        <div className="call-error__actions">
          <button className="btn small" type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}
    </div>
  )
}

interface CallNoticeProps {
  text: string
  className?: string
}

/**
 * Success/confirmation notice (e.g. "Applied."). The styled, non-clipping
 * counterpart of CallError for `.chip`-shaped messages that used to be
 * squeezed into a pill.
 */
export function CallNotice({ text, className }: CallNoticeProps): React.ReactElement {
  return (
    <div role="status" className={['call-notice', className ?? ''].filter(Boolean).join(' ')}>
      {text}
    </div>
  )
}
