/**
 * ErrorBoundary — stops one component's crash from blanking the whole app.
 *
 * React unmounts the entire tree when an error escapes render or an effect,
 * which previously left only the navy background ("blue screen"). This catches
 * that error and shows a recoverable fallback instead. Use it at the app root
 * and around any panel that can fail independently.
 */

import { AlertTriangle } from 'lucide-react'
import React from 'react'
import { Button } from './ui/Button'

interface Props {
  children: React.ReactNode
  /** Where the boundary sits, shown in the fallback (e.g. "Studio AI"). */
  label?: string
  /** Optional custom fallback renderer. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(
      `ErrorBoundary${this.props.label ? ` (${this.props.label})` : ''} caught:`,
      error,
      info
    )
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): React.ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)

    return (
      <div className="size-full flex flex-col items-center justify-center gap-3 text-center text-fg-3 px-6 bg-navy-700">
        <AlertTriangle size={36} className="text-pink opacity-80" />
        <p className="text-sm text-fg-2">
          {this.props.label ? `${this.props.label} hit an error.` : 'Something went wrong.'}
        </p>
        <pre className="max-w-full max-h-32 overflow-auto rounded-md bg-navy-900 border border-navy-600 p-2 text-xs text-fg-3 whitespace-pre-wrap">
          {error.message}
        </pre>
        <Button size="sm" onClick={this.reset}>
          Try again
        </Button>
      </div>
    )
  }
}
