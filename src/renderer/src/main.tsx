import './assets/base.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { Toaster } from 'sonner'
import App from './App'
import { ThemeProvider } from './lib/ThemeProvider'
import { store } from './redux'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <Provider store={store}>
        <App />
        {/* Toast host — without this, no toast.* feedback ever renders. */}
        <Toaster theme="dark" position="bottom-right" richColors closeButton />
      </Provider>
    </ThemeProvider>
  </StrictMode>
)
