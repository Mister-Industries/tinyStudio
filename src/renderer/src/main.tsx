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
 * Toast host — a thin wrapper so the toaster can read the app's actual
 * light/dark theme via useTheme(). Sonner's `theme` prop isn't just cosmetic:
 * it drives sonner's own internal text colors (e.g. toast descriptions),
 * which our toastOptions.style override does NOT reach. Hardcoding
 * theme="dark" here made every description render near-white — invisible on
 * the white toast background used in light mode.
 */
function ToastHost(): React.JSX.Element {
  const { theme } = useTheme()
  const resolved =
    theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme

  return (
    <Toaster
      theme={resolved}
      position="bottom-right"
      closeButton
      toastOptions={{
        style: {
          background: 'var(--surface-overlay)',
          color: 'var(--text-body)',
          border: '1.5px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-soft)',
          fontFamily: 'var(--font-sans)'
        }
      }}
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
        {/* Toast host — without this, no toast.* feedback ever renders. */}
        <ToastHost />
      </Provider>
    </ThemeProvider>
  </StrictMode>
)
