import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './theme.css'

// Dev/screenshot hook: ?route=/cluster/resources/pods sets the initial hash route.
const bootRoute = new URLSearchParams(window.location.search).get('route')
if (bootRoute) {
  const path = bootRoute.startsWith('/') ? bootRoute : `/${bootRoute}`
  if (!window.location.hash.startsWith('#' + path)) window.location.hash = path
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

