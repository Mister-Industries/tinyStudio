// tinyService prompts. Renders nothing — it's a headless watcher.
//
// Compile / upload / serial all go through tinyService, a small local WebSocket
// backend (see WebSocketArduinoService.ts).
//
// In the browser the user runs it themselves. When nothing is listening we drop
// a persistent notification into the status-bar bell so it's easy to find and
// stays until the user clears it. On Windows the primary path is the one-click
// tray-agent installer published from the tinyService repo (stable
// latest-release URL). Elsewhere — and as a fallback for developers — we still
// show the npx command.
//
// On desktop the main process launches tinyService and restarts it once if it
// dies (main/ServiceManager.ts). When that isn't enough, main sends the error
// here and the prompt offers a Restart button.

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { isElectron } from '@renderer/lib/utils'
import { getArduinoService } from '@renderer/services/arduino/ArduinoServiceFactory'
import { addNotification, useAppDispatch } from '@renderer/redux'

const INSTALL_CMD = 'npx @mister-industries/tinyservice'
const DOWNLOAD_URL =
  'https://github.com/Mister-Industries/tinyService/releases/latest/download/tinyService-Setup.exe'

const isWindows = navigator.userAgent.includes('Windows')

// Fixed toast ids, so a repeat error replaces the stale one instead of stacking.
const STOPPED_TOAST = 'tinyservice-stopped'
const RESTARTING_TOAST = 'tinyservice-restarting'

export function BackendPrompt(): null {
  const dispatch = useAppDispatch()
  // Push at most once so flapping connections don't spam the bell.
  const pushed = useRef(false)

  // Desktop: the backend died and main gave up, or never started.
  useEffect(() => {
    if (!isElectron()) return
    const api = window.api.service

    const showStopped = (detail: string): void => {
      const msg = `${detail} Compiling, uploading and the serial monitor won't work until it's running again.`
      dispatch(addNotification({ tone: 'error', title: 'tinyService stopped', msg }))
      toast.error('tinyService stopped', {
        id: STOPPED_TOAST,
        description: msg,
        duration: Infinity,
        action: { label: 'Restart', onClick: () => void restart() }
      })
    }

    const restart = async (): Promise<void> => {
      // A separate toast: updating the error toast in place would keep its
      // description and Restart button (sonner merges options by id).
      toast.dismiss(STOPPED_TOAST)
      toast.loading('Restarting tinyService…', { id: RESTARTING_TOAST })
      const result = await api.restart()
      if (result.ok) {
        toast.success('tinyService restarted', { id: RESTARTING_TOAST, duration: 4000 })
        // The WebSocket client gives up after 30 s of outage; reconnect now.
        void getArduinoService().checkStatus()
      } else {
        toast.dismiss(RESTARTING_TOAST)
        showStopped(`Restarting failed: ${result.error ?? 'unknown error'}.`)
      }
    }

    // The failure may have happened before this component mounted.
    void api.getStatus().then((status) => {
      if (!status.running && status.error) showStopped(status.error)
    })
    return api.onError(({ message, error, stopped }) => {
      if (stopped) showStopped(error)
      else toast.warning(message, { description: error })
    })
  }, [dispatch])

  // Browser: the user runs tinyService themselves.
  useEffect(() => {
    if (isElectron()) return
    const service = getArduinoService()

    const announce = (): void => {
      if (pushed.current || service.isConnected()) return
      pushed.current = true

      if (isWindows) {
        const msg =
          'Compiling, uploading, and the serial monitor run through tinyService, a small app that lives in your system tray. Install it once — the app reconnects automatically.'
        dispatch(
          addNotification({
            tone: 'warn',
            title: 'Install tinyService to build & flash',
            msg,
            link: { href: DOWNLOAD_URL, label: 'Download tinyService for Windows' },
            code: `Already have Node? You can also run: ${INSTALL_CMD}`
          })
        )
        // Persistent (duration: Infinity) since it's an actionable prompt.
        toast.warning('Install tinyService to build & flash', {
          description: msg,
          duration: Infinity,
          action: {
            label: 'Download',
            onClick: () => window.open(DOWNLOAD_URL, '_blank')
          }
        })
      } else {
        const msg =
          'Compiling, uploading, and the serial monitor run through a small local backend. Run this command in a terminal — the app reconnects automatically. Use Chrome or Edge to allow the local connection from a hosted page.'
        dispatch(
          addNotification({
            tone: 'warn',
            title: 'Start tinyService to build & flash',
            msg,
            code: INSTALL_CMD
          })
        )
        toast.warning('Start tinyService to build & flash', {
          description: `${msg}\n\n${INSTALL_CMD}`,
          duration: Infinity
        })
      }
    }

    // Assume connected during the initial grace period so we don't announce
    // before the first WebSocket attempt resolves.
    const grace = setTimeout(announce, 5000)
    const off = service.onConnectionChange((isConn) => {
      if (!isConn) announce()
    })

    return () => {
      clearTimeout(grace)
      off()
    }
  }, [dispatch])

  return null
}
