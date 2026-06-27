import './assets/base.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { Toaster } from 'sonner'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ThemeProvider } from './lib/ThemeProvider'
import { store } from './redux'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <Provider store={store}>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
        {/* Toast host — without this, no toast.* feedback ever renders. */}
        <Toaster
          theme="dark"
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
      </Provider>
    </ThemeProvider>
  </StrictMode>
)
