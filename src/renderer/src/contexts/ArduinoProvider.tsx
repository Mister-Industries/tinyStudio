import { useArduino } from '@renderer/hooks/useArduino'
import React from 'react'
import { ArduinoContext } from './ArduinoContext'

/** Runs useArduino once for the whole app, so every component shares one backend connection. */
export function ArduinoProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const arduino = useArduino()

  return <ArduinoContext.Provider value={arduino}>{children}</ArduinoContext.Provider>
}
