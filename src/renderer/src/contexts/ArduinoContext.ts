/**
 * ArduinoContext — the app-wide Arduino state (boards, ports, compile/upload,
 * serial plumbing) that ArduinoProvider runs once and shares.
 */

import type { UseArduinoReturn } from '@renderer/hooks/useArduino'
import { createContext, useContext } from 'react'

export const ArduinoContext = createContext<UseArduinoReturn | null>(null)

/** The shared Arduino state. Must be rendered inside ArduinoProvider. */
export function useArduinoContext(): UseArduinoReturn {
  const context = useContext(ArduinoContext)
  if (!context) {
    throw new Error('useArduinoContext must be used within ArduinoProvider')
  }
  return context
}
