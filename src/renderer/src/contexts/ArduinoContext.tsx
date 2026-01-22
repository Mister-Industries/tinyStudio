/**
 * ArduinoContext - Shared context for Arduino state across components
 */

import { useArduino, UseArduinoReturn } from '@renderer/hooks/useArduino'
import React, { createContext, useContext } from 'react'

const ArduinoContext = createContext<UseArduinoReturn | null>(null)

/**
 * Provider component that wraps app and provides Arduino state
 */
export function ArduinoProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const arduino = useArduino()

  return <ArduinoContext.Provider value={arduino}>{children}</ArduinoContext.Provider>
}

/**
 * Hook to access Arduino context
 * This ensures all components share the same Arduino state
 */
export function useArduinoContext(): UseArduinoReturn {
  const context = useContext(ArduinoContext)
  if (!context) {
    throw new Error('useArduinoContext must be used within ArduinoProvider')
  }
  return context
}
