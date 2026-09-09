/// <reference types="vite/client" />
import type { SoLensApi } from '@shared/types'

declare global {
  interface Window {
    api: SoLensApi
  }
}

export {}
