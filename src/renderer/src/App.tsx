import { Link, useLocation } from 'react-router-dom'
import { createHashRouter, isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { RouterProvider } from 'react-router-dom'
import AppLayout from '@renderer/components/layout/AppLayout'
import { errorTitle, toKubeApiError } from '@renderer/components/ui/CallError'
import type { KubeApiError } from '@shared/types'
import CatalogPage from '@renderer/features/catalog'
import OverviewPage from '@renderer/features/overview'
import AIPage from '@renderer/features/ai'
import ResourceListPage from '@renderer/features/resources/ResourceListPage'
import ResourceDetailPage from '@renderer/features/resources/ResourceDetailPage'

/**
 * errorElement for the layout route: a throw escaping AppLayout itself (or a
 * future loader/action) lands here instead of on a blank window. A throw
 * inside a PAGE is caught earlier by the ErrorBoundary mounted inside
 * AppLayout (which keeps the sidebar/topbar rendered), so this is the outer,
 * last-resort panel.
 */
export function LayoutErrorElement(): React.ReactElement {
  const error = useRouteError()
  console.error('[mom-lens] route error:', error)
  const shown: KubeApiError = isRouteErrorResponse(error)
    ? { code: 'unknown', message: `${error.status} ${error.statusText}` }
    : toKubeApiError(error)
  return (
    <div className="error-panel" role="alert">
      <h2>Something went wrong</h2>
      <p className="error-panel__lead">{errorTitle(shown.code)}</p>
      <pre className="error-panel__detail">{shown.message}</pre>
      <div className="error-panel__actions">
        <button className="btn primary" type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  )
}

/**
 * Real view for unmatched hashes (replaces the silent blind-redirect to `/`):
 * shows the offending path and offers the two sane destinations back.
 */
export function NotFoundPage(): React.ReactElement {
  const location = useLocation()
  return (
    <div className="error-panel" style={{ marginTop: 40 }}>
      <h2>Page not found</h2>
      <p className="error-panel__lead">
        No mom-lens view is registered for <code className="mono">{location.pathname}</code>.
      </p>
      <div className="error-panel__actions">
        <Link className="btn" to="/">
          Cluster catalog
        </Link>
        <Link className="btn" to="/cluster/overview">
          Cluster overview
        </Link>
      </div>
    </div>
  )
}

const LAYOUT_ERROR_ELEMENT = <LayoutErrorElement />

/**
 * Hash routing with the same route table as before (ARCHITECTURE.md), created
 * through the data-router API: `errorElement` is only honored when routes go
 * through RouterProvider — in the component-form <HashRouter><Routes> it would
 * be inert decoration. URL shape (#/cluster/...) is unchanged.
 */
const router = createHashRouter([
  {
    element: <AppLayout />,
    errorElement: LAYOUT_ERROR_ELEMENT,
    children: [
      { path: '/', element: <CatalogPage /> },
      { path: '/cluster/overview', element: <OverviewPage /> },
      { path: '/cluster/ai', element: <AIPage /> },
      { path: '/cluster/resources/:resource', element: <ResourceListPage /> },
      {
        path: '/cluster/resources/:resource/:namespace/:name',
        element: <ResourceDetailPage />
      },
      { path: '*', element: <NotFoundPage /> }
    ]
  }
])

export default function App(): React.ReactElement {
  return <RouterProvider router={router} />
}
