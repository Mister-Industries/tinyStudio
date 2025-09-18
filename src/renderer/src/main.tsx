import './assets/base.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import App from './App'
import { Toaster } from './components/ui/Sonner'
import { ThemeProvider } from './lib/ThemeProvider'
import { store } from './redux'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
      <Provider store={store}>
        <App />
        <Toaster />
      </Provider>
    </ThemeProvider>
  </StrictMode>
)
