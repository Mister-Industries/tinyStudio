/// <reference types="vite/client" />

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorkerUrl: (workerId: string, label: string) => string
    }
  }
}
