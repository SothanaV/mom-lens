import type { KubeObject, ResourceKind } from '@shared/types'
import { Link } from 'react-router-dom'
import { columnsForKind, statusTone } from './columns'
import { detailPath, objKey, objName, objNamespace } from './utils'

interface ResourceTableProps {
  kind: ResourceKind
  items: KubeObject[]
  showNamespace: boolean
  nsQuery?: string | null
}

export default function ResourceTable({
  kind,
  items,
  showNamespace,
  nsQuery
}: ResourceTableProps) {
  const columns = columnsForKind(kind)
  const showNsColumn = showNamespace && kind.namespaced

  return (
    <table className="table">
      <thead>
        <tr>
          <th>Name</th>
          {showNsColumn && <th>Namespace</th>}
          {columns.map((c) => (
            <th key={c.header}>{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((obj) => {
          const to = detailPath(kind, obj, nsQuery)
          return (
            <tr key={objKey(obj)}>
              <td>
                <Link to={to} className="row-link">
                  {objName(obj) || <em>&lt;unnamed&gt;</em>}
                </Link>
              </td>
              {showNsColumn && <td>{objNamespace(obj) || '<cluster>'}</td>}
              {columns.map((c) => {
                const val = c.value(obj)
                if (c.status) {
                  return val ? (
                    <td key={c.header}>
                      <span className={`chip ${statusTone(val)}`}>{val}</span>
                    </td>
                  ) : (
                    <td key={c.header}>
                      <span className="muted">—</span>
                    </td>
                  )
                }
                return (
                  <td key={c.header}>{val || <span className="muted">—</span>}</td>
                )
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
