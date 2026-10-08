import { useState } from 'react'
import { dump } from 'js-yaml'
import type { KubeApiError, KubeObject } from '@shared/types'
import { CallError, toKubeApiError } from '@renderer/components/ui/CallError'
import { pushToast } from '@renderer/components/ui/toast'

interface SecretDataRow {
  id: string
  /** '' for newly added rows. */
  origKey: string
  key: string
  /** Raw base64 from `data`; null for plaintext (stringData / new) rows. */
  encoded: string | null
  /** Plaintext once decoded or typed by the user. */
  plaintext: string | null
  edited: boolean
  removed: boolean
}

interface SecretDataPanelProps {
  obj: KubeObject
  /** Persist a modified copy of the secret (caller applies it). */
  onApply: (yaml: string) => Promise<void>
}

function bytesToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function base64ToText(b64: string): string | null {
  try {
    const bin = atob(b64.replace(/\s+/g, ''))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function toRows(obj: KubeObject): SecretDataRow[] {
  const rows: SecretDataRow[] = []
  const data = obj.data
  if (data && typeof data === 'object') {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const encoded = typeof value === 'string' ? value : ''
      rows.push({
        id: `d:${key}`,
        origKey: key,
        key,
        encoded,
        plaintext: base64ToText(encoded),
        edited: false,
        removed: false
      })
    }
  }
  const stringData = obj.stringData
  if (stringData && typeof stringData === 'object') {
    for (const [key, value] of Object.entries(stringData as Record<string, unknown>)) {
      rows.push({
        id: `s:${key}`,
        origKey: key,
        key,
        encoded: null,
        plaintext: typeof value === 'string' ? value : '',
        edited: false,
        removed: false
      })
    }
  }
  return rows
}

function cleanForApply(obj: KubeObject): KubeObject {
  const clone = JSON.parse(JSON.stringify(obj)) as KubeObject
  if (clone.metadata) {
    const m = clone.metadata as Record<string, unknown>
    delete m.managedFields
    delete m.resourceVersion
    delete m.uid
    delete m.creationTimestamp
  }
  delete (clone as Record<string, unknown>).status
  return clone
}

/** Decoded display value; null means the payload is not valid UTF-8 text. */
function rowPlaintext(row: SecretDataRow): string | null {
  if (row.edited || row.encoded === null) return row.plaintext ?? ''
  return base64ToText(row.encoded ?? '')
}

const inputStyle: React.CSSProperties = {
  background: '#1b1d20',
  border: '1px solid var(--border)',
  borderRadius: 4,
  color: 'var(--text)',
  padding: '4px 8px',
  fontSize: 12
}

export default function SecretDataPanel({ obj, onApply }: SecretDataPanelProps) {
  const [rows, setRows] = useState<SecretDataRow[]>(() => toRows(obj))
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<KubeApiError | null>(null)

  const patch = (id: string, changes: Partial<SecretDataRow>, markDirty = true): void => {
    if (markDirty) setDirty(true)
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...changes } : r)))
  }

  const toggleReveal = (id: string): void => {
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const onKeyRename = (row: SecretDataRow, key: string): void => {
    patch(row.id, { key })
  }

  const onValueEdit = (row: SecretDataRow, value: string): void => {
    patch(row.id, { plaintext: value, edited: true })
  }

  const addRow = (): void => {
    setDirty(true)
    setRows((prev) => [
      ...prev,
      {
        id: `n:${crypto.randomUUID()}`,
        origKey: '',
        key: '',
        encoded: null,
        plaintext: '',
        edited: true,
        removed: false
      }
    ])
  }

  const restore = (row: SecretDataRow): void => {
    patch(row.id, { removed: false })
  }

  const onCancel = (): void => {
    setRows(toRows(obj))
    setRevealed(new Set())
    setError(null)
    setEditing(false)
    setDirty(false)
  }

  const onSave = async (): Promise<void> => {
    setError(null)
    const kept = rows.filter((r) => !r.removed)
    if (kept.some((r) => !r.key.trim())) {
      setError({ code: 'invalid', message: 'Every key needs a name (or remove the row).' })
      return
    }
    const names = kept.map((r) => r.key.trim())
    if (new Set(names).size !== names.length) {
      setError({ code: 'invalid', message: 'Duplicate keys are not allowed.' })
      return
    }

    // applyYaml replaces the whole object, so removed keys simply stay out of the doc.
    const data: Record<string, string> = {}
    for (const row of kept) {
      const key = row.key.trim()
      if (row.edited || row.encoded === null) {
        data[key] = bytesToBase64(row.plaintext ?? '')
      } else {
        // Untouched (possibly binary) payload: carry the original base64 through unchanged.
        data[key] = row.encoded
      }
    }

    const clone = cleanForApply(obj)
    if (Object.keys(data).length > 0) clone.data = data
    else delete clone.data
    delete clone.stringData

    setSaving(true)
    try {
      await onApply(dump(clone, { noRefs: true, lineWidth: -1, sortKeys: false }))
      setEditing(false)
      setDirty(false)
      setRevealed(new Set())
    } catch (err) {
      // applySecretDoc re-throws the typed KubeApiError; anything else is coerced.
      setError(toKubeApiError(err))
    } finally {
      setSaving(false)
    }
  }

  const removedRows = rows.filter((r) => r.removed)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.length === 0 && (
        <span style={{ opacity: 0.7, fontSize: 12 }}>This Secret has no data entries.</span>
      )}
      {rows
        .filter((r) => !r.removed)
        .map((row) => {
          const isRevealed = revealed.has(row.id)
          const plaintext = rowPlaintext(row)
          const binary = plaintext === null
          const editValue = row.edited || !binary ? (row.plaintext ?? '') : ''
          const revealMultiline = isRevealed && plaintext != null && plaintext.includes('\n')
          const editMultiline = editValue.includes('\n')
          return (
            <div
              key={row.id}
              style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', rowGap: 4 }}
            >
              {editing ? (
                <input
                  className="mono"
                  style={{ ...inputStyle, width: 220 }}
                  value={row.key}
                  placeholder="key name"
                  onChange={(e) => onKeyRename(row, e.target.value)}
                />
              ) : (
                <span className="mono" style={{ width: 220, flex: '0 0 auto' }}>
                  {row.key}
                </span>
              )}
              {editing && editMultiline && (
                <textarea
                  className="mono"
                  style={{ ...inputStyle, flex: '1 1 100%', minHeight: 0, resize: 'vertical', lineHeight: 1.45 }}
                  rows={Math.max(3, Math.min(14, editValue.split('\n').length))}
                  value={editValue}
                  placeholder={binary ? 'binary value — type to replace' : ''}
                  onChange={(e) => onValueEdit(row, e.target.value)}
                />
              )}
              {editing && !editMultiline && (
                <input
                  className="mono"
                  style={{ ...inputStyle, flex: 1, minWidth: 200 }}
                  value={editValue}
                  placeholder={binary ? 'binary value — type to replace' : ''}
                  onChange={(e) => onValueEdit(row, e.target.value)}
                />
              )}
              {!editing && revealMultiline && (
                <pre
                  className="mono"
                  style={{
                    margin: 0,
                    flex: '1 1 100%',
                    maxHeight: 260,
                    overflow: 'auto',
                    padding: '6px 8px',
                    background: '#1b1d20',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    fontSize: 12,
                    lineHeight: 1.45,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all'
                  }}
                >
                  {plaintext}
                </pre>
              )}
              {!editing && !revealMultiline && (
                <span
                  className="mono"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  title={isRevealed && !binary ? (plaintext ?? undefined) : undefined}
                >
                  {isRevealed ? (binary ? '‹binary data›' : plaintext) : '••••••••••••'}
                </span>
              )}
              {!editing && (
                <button
                  className="btn"
                  type="button"
                  onClick={() => toggleReveal(row.id)}
                  title={isRevealed ? 'Hide value' : 'Decode and show value'}
                >
                  {isRevealed ? 'Hide' : 'Reveal'}
                </button>
              )}
              {!editing && isRevealed && !binary && plaintext && (
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    // Toast on both outcomes — a swallowed clipboard rejection
                    // read as "it copied".
                    if (!navigator.clipboard?.writeText) {
                      pushToast({
                        tone: 'error',
                        title: 'Clipboard write failed',
                        message: 'This Electron build exposes no clipboard API.'
                      })
                      return
                    }
                    navigator.clipboard
                      .writeText(plaintext)
                      .then(() => pushToast({ tone: 'success', title: 'Copied' }))
                      .catch((err: unknown) =>
                        pushToast({
                          tone: 'error',
                          title: 'Clipboard write failed',
                          message: err instanceof Error ? err.message : String(err)
                        })
                      )
                  }}
                  title="Copy decoded value"
                >
                  Copy
                </button>
              )}
              {editing && (
                <button
                  className="btn"
                  type="button"
                  onClick={() => patch(row.id, { removed: true })}
                  title={row.origKey ? 'Remove key' : 'Discard new key'}
                >
                  ×
                </button>
              )}
            </div>
          )
        })}
      {removedRows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {removedRows.map((row) => (
            <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: 0.6 }}>
              <span className="mono" style={{ textDecoration: 'line-through' }}>
                {row.key}
              </span>
              <button className="btn" type="button" onClick={() => restore(row)}>
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
      {/* No retry button here: on failure the panel stays in edit mode with
          its Save button, which *is* the retry. */}
      {error && <CallError compact error={error} />}
      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        {editing ? (
          <>
            <button className="btn" type="button" onClick={addRow}>
              + Add key
            </button>
            <span style={{ flex: 1 }} />
            <button className="btn" type="button" disabled={saving} onClick={onCancel}>
              Cancel
            </button>
            <button
              className="btn"
              type="button"
              disabled={saving || !dirty}
              onClick={() => void onSave()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        ) : (
          <button className="btn" type="button" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>
    </div>
  )
}
