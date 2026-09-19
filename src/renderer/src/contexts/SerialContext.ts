/**
 * SerialContext: the one serial connection the whole app shares (opened and
 * owned by SerialProvider), and the shapes the Serial Monitor renders.
 */

import { createContext, useContext } from 'react'

/** One rendered line of the Serial Monitor. */
export interface SerialLine {
  text: string
  /** Receive (or send) time, ms since epoch; rendered by the timestamps toggle. */
  ts: number
  /** True for lines the user sent (rendered in the accent color). */
  tx?: boolean
}

/** Line ending appended to sent data (Arduino IDE parity). */
export type SerialEol = 'none' | 'nl' | 'cr' | 'crlf'

export interface SerialContextValue {
  lines: SerialLine[]
  connected: boolean
  /** User chose to release the port (e.g. so the browser can use it) */
  disconnected: boolean
  /** Last port-open failure reported by the backend (busy port etc.), if any */
  lastError: string | null
  port?: string
  baud: string
  setBaud: (b: string) => void
  /** Line ending appended to sent data */
  eol: SerialEol
  setEol: (e: SerialEol) => void
  send: (data: string) => void
  clear: () => void
  /** Release the serial port and stay disconnected until reconnect() */
  disconnect: () => void
  /** Resume the automatic connection */
  reconnect: () => void
}

export const SerialContext = createContext<SerialContextValue | null>(null)

export function useSerial(): SerialContextValue {
  const ctx = useContext(SerialContext)
  if (!ctx) throw new Error('useSerial must be used within SerialProvider')
  return ctx
}
