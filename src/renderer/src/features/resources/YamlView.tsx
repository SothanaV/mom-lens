import { useMemo, useState } from 'react'
import { dump } from 'js-yaml'
import type { KubeObject } from '@shared/types'

interface YamlViewProps {
  obj: KubeObject
}

interface CleanOptions {
  stripManagedFields: boolean
  hideStatus: boolean
}

function cleanObject(obj: KubeObject, opts: CleanOptions): KubeObject {
  const clone = JSON.parse(JSON.stringify(obj)) as KubeObject
  if (opts.stripManagedFields && clone.metadata) {
    delete (clone.metadata as Record<string, unknown>).managedFields
  }
  if (opts.hideStatus) {
    delete (clone as Record<string, unknown>).status
  }
  return clone
}

export default function YamlView({ obj }: YamlViewProps) {
  const [stripManagedFields, setStripManagedFields] = useState(true)
  const [hideStatus, setHideStatus] = useState(false)

  const yaml = useMemo(() => {
    try {
      return dump(cleanObject(obj, { stripManagedFields, hideStatus }), {
        noRefs: true,
        lineWidth: -1,
        sortKeys: false
      })
    } catch {
      return '# Unable to serialize object as YAML.'
    }
  }, [obj, stripManagedFields, hideStatus])

  return (
    <div className="yaml-view">
      <div className="yaml-toolbar">
        <label>
          <input
            type="checkbox"
            checked={stripManagedFields}
            onChange={(e) => setStripManagedFields(e.target.checked)}
          />
          <span>Hide managedFields</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={hideStatus}
            onChange={(e) => setHideStatus(e.target.checked)}
          />
          <span>Hide status</span>
        </label>
      </div>
      <pre className="mono yaml-pre">{yaml}</pre>
    </div>
  )
}
