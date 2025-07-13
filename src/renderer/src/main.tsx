import './assets/base.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ThemeProvider } from './lib/ThemeProvider'

// Disable web workers for Electron
if (typeof window !== 'undefined') {
  window.MonacoEnvironment = {
    getWorkerUrl: () => ''
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
      <App />
    </ThemeProvider>
  </StrictMode>
)
