import type { KubeApiError, KubeErrorCode } from '@shared/types'
import { isKubeApiError } from '@shared/types'

export function statusCodeOf(err: unknown): number | undefined {
  const e = err as Record<string, unknown> | null | undefined
  const resp = (e?.response ?? null) as Record<string, unknown> | null | undefined
  const body = (resp?.body ?? null) as Record<string, unknown> | null | undefined
  const errBody = (e?.body ?? null) as Record<string, unknown> | null | undefined
  const code =
    e?.statusCode ?? e?.code ?? resp?.statusCode ?? body?.code ?? errBody?.code
  return typeof code === 'number' ? code : undefined
}

/** Node-style errno on the error itself (`ECONNREFUSED`, `ETIMEDOUT`, ...). */
function errnoOf(err: unknown): string {
  const e = err as Record<string, unknown> | null | undefined
  const raw = e?.code ?? e?.errno
  return typeof raw === 'string' ? raw : ''
}

export function messageOf(err: unknown): string {
  const e = err as Record<string, unknown> | null | undefined
  if (typeof err === 'string') return err
  const body = (e?.body ?? null) as Record<string, unknown> | null | undefined
  const resp = (e?.response ?? null) as Record<string, unknown> | null | undefined
  const respBody = (resp?.body ?? null) as Record<string, unknown> | null | undefined
  const msg = body?.message ?? respBody?.message ?? e?.message
  if (typeof msg === 'string' && msg.trim().length > 0) return msg
  const reason = body?.reason ?? respBody?.reason
  if (typeof reason === 'string' && reason.trim().length > 0) return reason
  return 'Unknown error'
}

/**
 * Map anything thrown by the k8s client / node sockets to one of the shared
 * failure classes. Uses `statusCodeOf()` for HTTP statuses and the errno
 * string for transport failures.
 */
export function classifyError(err: unknown): KubeErrorCode {
  const status = statusCodeOf(err)
  if (status === 401 || status === 403) return 'forbidden'
  if (status === 404) return 'notFound'
  if (status === 409) return 'conflict'
  if (status === 400 || status === 422) return 'invalid'
  if (status != null && status >= 500) return 'unreachable'
  if (status != null) return 'unknown'
  // Errno first: message fallbacks below must not fire for transport errors
  // whose text contains misleading words (e.g. "HYSTORMAT" ⊂ EHOSTUNREACH).
  const errno = errnoOf(err)
  if (errno === 'ETIMEDOUT' || errno === 'ESOCKETTIMEDOUT' || errno === 'ECONNABORTED') {
    return 'timeout'
  }
  const msg = messageOf(err)
  if (
    errno === 'ECONNREFUSED' ||
    errno === 'ENOTFOUND' ||
    errno === 'EAI_AGAIN' ||
    errno === 'ECONNRESET' ||
    errno === 'EHOSTUNREACH' ||
    errno === 'ENETUNREACH' ||
    /socket hang up/i.test(msg) ||
    /(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH|ENETUNREACH)/.test(msg)
  ) {
    return 'unreachable'
  }
  if (/timed?\s*out|timeout/i.test(msg)) return 'timeout'
  // YAML/config validation failures (js-yaml messages + client config loader).
  if (
    /unable to (?:load|normalize)|js-yaml|failed to parse|no configuration has been provided|kubeconfig|yaml: line \d|bad indentation|incomplete explicit mapping|mapping values are not allowed|can not read (?:an implicit mapping pair|a block mapping entry)|expected a plain key|end of the stream is not expected|duplicated mapping key/i.test(
      msg
    )
  ) {
    return 'invalid'
  }
  if (/not found/i.test(msg)) return 'notFound'
  if (/forbidden|cannot (?:get|list|watch|create|update|patch|delete)|is forbidden/i.test(msg)) {
    return 'forbidden'
  }
  if (isConflict(err)) return 'conflict'
  return 'unknown'
}

function hintFor(code: KubeErrorCode): string | undefined {
  switch (code) {
    case 'forbidden':
      return 'Your role is not allowed to do this in this cluster/context. Ask an admin for a binding, or switch context.'
    case 'notFound':
      return 'The object (or its namespace) does not exist — it may have been deleted or the name is misspelled.'
    case 'unreachable':
      return 'The API server could not be reached. Check that the cluster is running and the server address in your kubeconfig is correct.'
    case 'timeout':
      return 'The API server did not answer in time. It may be overloaded or the network path is slow.'
    case 'conflict':
      return 'Another writer changed the object first. Reload and try again.'
    case 'invalid':
      return 'The request itself is not valid — check the YAML/field values.'
    default:
      return undefined
  }
}

/** Normalize ANY thrown value into the one typed error shape shared with the renderer. */
export function toKubeError(err: unknown): KubeApiError {
  // Defensive: re-wrapping an already-classified error stays idempotent.
  if (isKubeApiError(err)) {
    const message = err.message.trim().length > 0 ? err.message : 'Unknown error'
    return err.hint ? { ...err, message } : { code: err.code, message }
  }
  const code = classifyError(err)
  let message = messageOf(err)
  if (message.trim().length === 0) message = 'Unknown error'
  // The generic client message is useless to a human; prefer the server's Status text.
  if (/^HTTP request failed$/i.test(message)) {
    const status = statusCodeOf(err)
    message = status ? `The API server rejected the request (HTTP ${status}).` : message
  }
  const hint = hintFor(code)
  return hint ? { code, message, hint } : { code, message }
}

/**
 * True when a metrics probe failed because the metrics API group is absent
 * from the cluster (metrics-server not installed) rather than a transport,
 * auth or timeout failure.
 */
export function isMetricsAbsent(err: unknown): boolean {
  const status = statusCodeOf(err)
  if (status === 404 || status === 406) return true
  return /the server could not find the requested resource|unable to retrieve the complete list of server apis|failed to discover api groups/i.test(
    messageOf(err)
  )
}

export function isConflict(err: unknown): boolean {
  if (statusCodeOf(err) === 409) return true
  return /conflict|already exists/i.test(messageOf(err))
}
