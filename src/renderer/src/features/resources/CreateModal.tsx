import { useEffect, useState } from 'react'
import { dump, load } from 'js-yaml'
import type { KubeApiError, ResourceKind } from '@shared/types'
import { apiVersionOf, getCreateTemplate } from '@shared/types'
import { CallError, toKubeApiError } from '@renderer/components/ui/CallError'
import YamlEditor from './YamlEditor'

interface CreateModalProps {
  kind: ResourceKind
  /** Current namespace filter (ignored for cluster-scoped kinds and 'all'). */
  namespace?: string | null
  onClose: () => void
  onSaved: (message: string) => void
}

function initialYaml(kind: ResourceKind, namespace?: string | null): string {
  const template = getCreateTemplate(kind.resource)
  if (template) return template
  const metadata: Record<string, string> = { name: '' }
  if (kind.namespaced) {
    metadata.namespace = namespace && namespace !== 'all' ? namespace : 'default'
  }
  return dump(
    { apiVersion: apiVersionOf(kind), kind: kind.kind, metadata },
    { noRefs: true, lineWidth: -1, sortKeys: false }
  )
}

export default function CreateModal({ kind, namespace, onClose, onSaved }: CreateModalProps) {
  const [text, setText] = useState(() => initialYaml(kind, namespace))
  const [error, setError] = useState<KubeApiError | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const onSave = async (): Promise<void> => {
    if (saving) return
    setError(null)
    try {
      const parsed = load(text)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setError({ code: 'invalid', message: 'Document must be a single YAML mapping.' })
        return
      }
    } catch (err) {
      setError({
        code: 'invalid',
        message: `Invalid YAML: ${err instanceof Error ? err.message : String(err)}`
      })
      return
    }
    if (!window.api) {
      setError({
        code: 'unreachable',
        message: 'Cluster API (window.api) is not available.'
      })
      return
    }
    setSaving(true)
    try {
      const res = await window.api.k8s.applyYaml(text)
      if (!res.ok) {
        setError(
          res.error ?? { code: 'unknown', message: res.message ?? 'Apply failed.' }
        )
        setSaving(false)
        return
      }
      onSaved(res.message ?? `${kind.kind} created.`)
    } catch (err) {
      setError(toKubeApiError(err))
      setSaving(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100
      }}
    >
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(760px, 92vw)',
          maxHeight: '88vh',
          overflow: 'auto',
          background: 'var(--bg-panel, #14171c)',
          border: '1px solid rgba(128, 128, 128, 0.35)',
          borderRadius: 6,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 10
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h3 style={{ margin: 0 }}>Create {kind.kind}</h3>
          <span style={{ flex: 1 }} />
          <button className="btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <YamlEditor value={text} onChange={setText} height="340px" editable />

        {error && <CallError compact error={error} />}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn" type="button" onClick={() => void onSave()} disabled={saving}>
            {saving ? 'Creating…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
