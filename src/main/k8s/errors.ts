export function statusCodeOf(err: unknown): number | undefined {
  const e = err as any
  const code =
    e?.statusCode ??
    e?.code ??
    e?.response?.statusCode ??
    e?.response?.body?.code ??
    e?.body?.code
  return typeof code === 'number' ? code : undefined
}

export function messageOf(err: unknown): string {
  const e = err as any
  if (typeof err === 'string') return err
  return String(
    e?.body?.message ?? e?.response?.body?.message ?? e?.message ?? err ?? 'Unknown error'
  )
}

export function isConflict(err: unknown): boolean {
  if (statusCodeOf(err) === 409) return true
  return /conflict|already exists/i.test(messageOf(err))
}
