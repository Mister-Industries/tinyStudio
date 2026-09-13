import './assets/base.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { Toaster } from 'sonner'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ThemeProvider, useTheme } from './lib/ThemeProvider'
import { store } from './redux'

/**
 * Toast host — without this, no toast.* feedback ever renders.
 *
 * Must read the theme through the hook rather than take a hardcoded value:
 * sonner stamps `data-sonner-theme` on the toaster and resolves its own
 * palette from it, so a fixed theme leaves the parts we don't override
 * (description text, action button, close button) painted for the wrong mode.
 * Sonner understands 'system' natively, so our Theme type passes straight
 * through. Everything else is styled from the design tokens in
 * ds-components.css (.ts-toast) so a toast and a bell entry match.
 */
function ThemedToaster(): React.JSX.Element {
  const { theme } = useTheme()

  return (
    <Toaster
      theme={theme}
      position="bottom-right"
      closeButton
      toastOptions={{ className: 'ts-toast' }}
    />
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
      <Provider store={store}>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
        <ThemedToaster />
      </Provider>
    </ThemeProvider>
  </StrictMode>
)
