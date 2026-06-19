/**
 * SerialProvider — owns the ONE serial connection for the whole app.
 *
 * Mounted once at the app root (not per-view), so switching Code / Circuit /
 * Visual or toggling the monitor panel does NOT close and reopen the port.
 * That matters because opening a serial port resets the Arduino (DTR), so the
 * old per-view ownership reset the board on every switch and took seconds to
 * re-stream. Now the port opens once (on connect), stays open across views, and
 * only reopens around an upload or when the port/baud changes.
 *
 * It accumulates the line buffer (for the Serial Monitor) and feeds the shared
 * serial bus (window.__tinySerial / `tinyserial`) for the Visual sketch.
 */

import { useArduinoContext } from '@renderer/contexts/ArduinoContext'
import { pushSerialLine } from '@renderer/lib/serialBus'
import React, { createContext, useContext, useEffect, useState } from 'react'

interface SerialContextValue {
  lines: string[]
  connected: boolean
  port?: string
  baud: string
  setBaud: (b: string) => void
  send: (data: string) => void
  clear: () => void
}

const SerialContext = createContext<SerialContextValue | null>(null)

export function SerialProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const {
    selectedBoard,
    isAgentConnected,
    isUploading,
    openSerial,
    closeSerial,
    writeSerial,
    onSerialData,
    onSerialStatus
  } = useArduinoContext()

  const [lines, setLines] = useState<string[]>([])
  const [connected, setConnected] = useState(false)
  const [baud, setBaud] = useState('9600')
  const port = selectedBoard?.port
  const baudNum = parseInt(baud, 10)

  // Stream subscription lives for the whole app session.
  useEffect(() => {
    const offData = onSerialData((line) => {
      setLines((prev) => [...prev.slice(-1000), line])
      pushSerialLine(line) // feed the Visual sketch
    })
    const offStatus = onSerialStatus((s) => {
      if (s.opened) setConnected(true)
      if (s.closed) setConnected(false)
    })
    return () => {
      offData()
      offStatus()
    }
  }, [onSerialData, onSerialStatus])

  // Connection lifecycle — independent of which view is showing. Reopens only
  // when the port/baud changes or after an upload finishes (isUploading flips).
  useEffect(() => {
    if (!isAgentConnected || !port || isUploading) {
      setConnected(false)
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      if (!cancelled) openSerial(port, baudNum)
    }, 600)
    return () => {
      cancelled = true
      clearTimeout(t)
      closeSerial()
    }
  }, [isAgentConnected, port, baudNum, isUploading, openSerial, closeSerial])

  const value: SerialContextValue = {
    lines,
    connected,
    port,
    baud,
    setBaud,
    send: (data: string) => {
      writeSerial(data)
      setLines((prev) => [...prev.slice(-1000), `→ ${data}`])
    },
    clear: () => setLines([])
  }

  return <SerialContext.Provider value={value}>{children}</SerialContext.Provider>
}

export function useSerial(): SerialContextValue {
  const ctx = useContext(SerialContext)
  if (!ctx) throw new Error('useSerial must be used within SerialProvider')
  return ctx
}
