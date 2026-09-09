import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from '@renderer/components/layout/AppLayout'
import CatalogPage from '@renderer/features/catalog'
import OverviewPage from '@renderer/features/overview'
import AIPage from '@renderer/features/ai'
import ResourceListPage from '@renderer/features/resources/ResourceListPage'
import ResourceDetailPage from '@renderer/features/resources/ResourceDetailPage'

export default function App(): React.ReactElement {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<CatalogPage />} />
          <Route path="/cluster/overview" element={<OverviewPage />} />
          <Route path="/cluster/ai" element={<AIPage />} />
          <Route path="/cluster/resources/:resource" element={<ResourceListPage />} />
          <Route
            path="/cluster/resources/:resource/:namespace/:name"
            element={<ResourceDetailPage />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
