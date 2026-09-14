/**
 * SerialProvider — owns the ONE serial connection for the whole app.
 *
 * Mounted once at the app root (not per-view), so switching Code / Circuit /
 * Visual or toggling the monitor panel does NOT close and reopen the port.
 * Opening a serial port resets the board (DTR), so the port opens once, stays
 * open across views, and only reopens around an upload or when the port or
 * baud changes.
 *
 * It accumulates the line buffer (for the Serial Monitor) and feeds the shared
 * serial bus (lib/serialBus) for the Visual sketch.
 *
 * Monitor settings (baud + line ending) are persisted per port, so a board
 * you always run at 115200 comes back at 115200 (Arduino IDE parity).
 */

import { pushSerialLine } from '@renderer/lib/serialBus'
import { monitorSettingsKey as settingsKey } from '@renderer/lib/storageKeys'
import React, { useEffect, useRef, useState } from 'react'
import { useArduinoContext } from './ArduinoContext'
import {
  SerialContext,
  type SerialContextValue,
  type SerialEol,
  type SerialLine
} from './SerialContext'

const EOL_CHARS: Record<SerialEol, string> = {
  none: '',
  nl: '\n',
  cr: '\r',
  crlf: '\r\n'
}

interface PortSettings {
  baud?: string
  eol?: SerialEol
}

function loadPortSettings(port: string | undefined): PortSettings {
  if (!port) return {}
  try {
    const raw = localStorage.getItem(settingsKey(port))
    return raw ? (JSON.parse(raw) as PortSettings) : {}
  } catch {
    return {}
  }
}

function savePortSettings(port: string | undefined, settings: PortSettings): void {
  if (!port) return
  try {
    const merged = { ...loadPortSettings(port), ...settings }
    localStorage.setItem(settingsKey(port), JSON.stringify(merged))
  } catch {
    /* storage may be unavailable */
  }
}

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

  const [lines, setLines] = useState<SerialLine[]>([])
  const [connected, setConnected] = useState(false)
  // Manual override: when true, we release the port and don't auto-reopen, so
  // another app (e.g. the exported page over Web Serial) can use the board.
  const [disconnected, setDisconnected] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const [baud, setBaudState] = useState('9600')
  const [eol, setEolState] = useState<SerialEol>('nl')
  const port = selectedBoard?.port
  const baudNum = parseInt(baud, 10)

  // Restore per-port monitor settings whenever the port changes.
  const restoredPortRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (port === restoredPortRef.current) return
    restoredPortRef.current = port
    const saved = loadPortSettings(port)
    if (saved.baud) setBaudState(saved.baud)
    if (saved.eol) setEolState(saved.eol)
  }, [port])

  const setBaud = (b: string): void => {
    setBaudState(b)
    savePortSettings(port, { baud: b })
  }
  const setEol = (e: SerialEol): void => {
    setEolState(e)
    savePortSettings(port, { eol: e })
  }

  // Stream subscription lives for the whole app session.
  useEffect(() => {
    const offData = onSerialData((line) => {
      setLines((prev) => [...prev.slice(-1000), { text: line, ts: Date.now() }])
      pushSerialLine(line) // feed the Visual sketch
    })
    const offStatus = onSerialStatus((s) => {
      if (s.opened) {
        setConnected(true)
        setLastError(null)
      }
      if (s.closed) setConnected(false)
      if (s.error) {
        // The backend reports why a port didn't open (busy, missing…).
        setConnected(false)
        setLastError(s.error)
        setLines((prev) => [...prev.slice(-1000), { text: `⚠ ${s.error}`, ts: Date.now() }])
      }
    })
    return () => {
      offData()
      offStatus()
    }
  }, [onSerialData, onSerialStatus])

  // Connection lifecycle — independent of which view is showing. Reopens only
  // when the port/baud changes or after an upload finishes (isUploading flips),
  // and stays closed while the user has manually disconnected.
  useEffect(() => {
    if (!isAgentConnected || !port || isUploading || disconnected) {
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
  }, [isAgentConnected, port, baudNum, isUploading, disconnected, openSerial, closeSerial])

  const value: SerialContextValue = {
    lines,
    connected,
    disconnected,
    lastError,
    port,
    baud,
    setBaud,
    eol,
    setEol,
    send: (data: string) => {
      // Apply the chosen line ending ourselves and write raw — the backend
      // appends nothing (Arduino IDE's None / NL / CR / Both behavior).
      writeSerial(data + EOL_CHARS[eol], true)
      setLines((prev) => [...prev.slice(-1000), { text: `→ ${data}`, ts: Date.now(), tx: true }])
    },
    clear: () => setLines([]),
    disconnect: () => setDisconnected(true),
    reconnect: () => setDisconnected(false)
  }

  return <SerialContext.Provider value={value}>{children}</SerialContext.Provider>
}
