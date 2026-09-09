export type ConnectionStatus = 'loading' | 'connected' | 'error' | 'offline'

export function connectionMeta(status: ConnectionStatus): { label: string; className: string } {
  switch (status) {
    case 'loading':
      return { label: 'Connecting…', className: 'is-loading' }
    case 'connected':
      return { label: 'Connected', className: 'is-connected' }
    case 'error':
      return { label: 'Disconnected', className: 'is-error' }
    default:
      return { label: 'No API', className: 'is-offline' }
  }
}
