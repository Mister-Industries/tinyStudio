// "Run tinyService" prompt for the browser build.
//
// Compile / upload / serial all go through tinyService, a small local WebSocket
// backend (see WebSocketArduinoService.ts). The desktop app launches it for you;
// in the browser the user runs it themselves. When nothing is listening we drop
// a persistent notification into the status-bar bell so it's easy to find and
// stays until the user clears it. Never shown in the Electron build (which
// auto-starts the backend). Renders nothing — it's a headless watcher.

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { isElectron } from '@renderer/lib/utils'
import { getArduinoService } from '@renderer/services/arduino/ArduinoServiceFactory'
import { addNotification, useAppDispatch } from '@renderer/redux'

const INSTALL_CMD = 'npx @mister-industries/tinyservice'

export function BackendPrompt(): null {
  const dispatch = useAppDispatch()
  // Push at most once so flapping connections don't spam the bell.
  const pushed = useRef(false)

  useEffect(() => {
    if (isElectron()) return // desktop starts tinyService itself
    const service = getArduinoService()

    const announce = (): void => {
      if (pushed.current || service.isConnected()) return
      pushed.current = true
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
      // Also surface a toast so it's seen immediately, not just in the bell.
      // Persistent (duration: Infinity) since it's an actionable prompt.
      toast.warning('Start tinyService to build & flash', {
        description: `${msg}\n\n${INSTALL_CMD}`,
        duration: Infinity
      })
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
