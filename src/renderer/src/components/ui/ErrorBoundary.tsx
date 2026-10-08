import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  /**
   * Auto-reset signal: whenever this string changes (route change — AppLayout
   * passes the router location's pathname+search+key, which changes on every
   * navigation including a same-URL push), the captured error is cleared and
   * the children re-render. The crash panel can therefore never stick across
   * navigation; "Try again" clears it in place.
   */
  resetKey: string
}

interface ErrorBoundaryState {
  error: Error | null
  resetKey: string
}

/**
 * Render-throw catcher for routed content. Without it any throw inside a page
 * (ResourceTable, PodLogs, detail page, ...) unmounts the whole root — the
 * sidebar and topbar go white with the page. Mounted inside AppLayout, so the
 * chrome keeps rendering and only the content area swaps to this panel.
 *
 * Reset paths:
 *  - "Try again" clears the captured error and re-renders the children.
 *  - `resetKey` (route location) changing clears the error automatically —
 *    see the prop docs; handled in getDerivedStateFromProps.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState
  ): Partial<ErrorBoundaryState> | null {
    if (state.resetKey !== props.resetKey) {
      return { error: null, resetKey: props.resetKey }
    }
    return null
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[mom-lens] render error caught by ErrorBoundary:', error, info.componentStack)
  }

  private readonly reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="error-panel" role="alert">
        <h2>Something went wrong</h2>
        <p className="error-panel__lead">
          The page crashed while rendering. The sidebar and top bar still work — try again, or
          navigate somewhere else (this panel clears itself on navigation).
        </p>
        <pre className="error-panel__detail">{error.message || String(error)}</pre>
        <div className="error-panel__actions">
          <button className="btn primary" type="button" onClick={this.reset}>
            Try again
          </button>
        </div>
      </div>
    )
  }
}
