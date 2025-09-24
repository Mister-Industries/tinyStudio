/**
 * useArduinoAgent - Hook for monitoring Arduino CLI connectivity
 */

import { getArduinoService } from '@renderer/services/arduino/ArduinoServiceFactory'
import { AgentStatus } from '@renderer/services/arduino/types'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Configuration for the Arduino CLI hook
 */
export interface UseArduinoAgentConfig {
  /** How often to check agent status (ms) */
  checkInterval?: number
  /** Whether to auto-start checking on mount */
  autoStart?: boolean
  /** Maximum number of retry attempts */
  maxRetries?: number
  /** Delay between retry attempts (ms) */
  retryDelay?: number
}

/**
 * Return type for useArduinoAgent hook
 */
export interface UseArduinoAgentReturn {
  /** Current agent status */
  status: AgentStatus
  /** Whether the agent is connected and available */
  isConnected: boolean
  /** Whether we're currently checking the agent status */
  isChecking: boolean
  /** Whether we're currently retrying connection */
  isRetrying: boolean
  /** Number of failed connection attempts */
  retryCount: number
  /** Manually check agent status */
  checkStatus: () => Promise<void>
  /** Start automatic status checking */
  startChecking: () => void
  /** Stop automatic status checking */
  stopChecking: () => void
  /** Reset retry count and error state */
  reset: () => void
}

const DEFAULT_CONFIG: Required<UseArduinoAgentConfig> = {
  checkInterval: 5000, // 5 seconds
  autoStart: true,
  maxRetries: 3,
  retryDelay: 2000 // 2 seconds
}

/**
 * Hook for monitoring Arduino CLI connectivity and status
 */
export function useArduinoAgent(config: UseArduinoAgentConfig = {}): UseArduinoAgentReturn {
  const finalConfig = { ...DEFAULT_CONFIG, ...config }

  const [status, setStatus] = useState<AgentStatus>({
    connected: false,
    lastCheck: 0
  })
  const [isChecking, setIsChecking] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [retryCount, setRetryCount] = useState(0)

  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const arduinoService = getArduinoService()

  /**
   * Check agent status once
   */
  const checkStatus = useCallback(async (): Promise<void> => {
    if (isChecking) return

    setIsChecking(true)

    try {
      const newStatus = await arduinoService.checkStatus()
      setStatus(newStatus)

      if (newStatus.connected) {
        // Reset retry count on successful connection
        setRetryCount(0)
        setIsRetrying(false)
      } else {
        // Increment retry count on failure
        setRetryCount((prev) => prev + 1)
      }
    } catch (error) {
      console.error('Error checking Arduino agent status:', error)
      setStatus({
        connected: false,
        lastCheck: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      setRetryCount((prev) => prev + 1)
    } finally {
      setIsChecking(false)
    }
  }, [isChecking, arduinoService])

  /**
   * Start automatic status checking
   */
  const startChecking = useCallback((): void => {
    if (intervalRef.current) return

    // Initial check
    checkStatus()

    // Set up interval for periodic checks
    intervalRef.current = setInterval(() => {
      checkStatus()
    }, finalConfig.checkInterval)
  }, [checkStatus, finalConfig.checkInterval])

  /**
   * Stop automatic status checking
   */
  const stopChecking = useCallback((): void => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }

    setIsRetrying(false)
  }, [])

  /**
   * Reset retry count and error state
   */
  const reset = useCallback((): void => {
    setRetryCount(0)
    setIsRetrying(false)
    setStatus({
      connected: false,
      lastCheck: 0
    })
  }, [])

  /**
   * Handle retry logic when agent is disconnected
   */
  useEffect(() => {
    if (
      !status.connected &&
      retryCount > 0 &&
      retryCount <= finalConfig.maxRetries &&
      !isRetrying &&
      !isChecking
    ) {
      setIsRetrying(true)

      retryTimeoutRef.current = setTimeout(() => {
        setIsRetrying(false)
        checkStatus()
      }, finalConfig.retryDelay)
    }
  }, [
    status.connected,
    retryCount,
    finalConfig.maxRetries,
    finalConfig.retryDelay,
    isRetrying,
    isChecking,
    checkStatus
  ])

  /**
   * Auto-start checking if configured
   */
  useEffect(() => {
    if (finalConfig.autoStart) {
      startChecking()
    }

    return () => {
      stopChecking()
    }
  }, [finalConfig.autoStart, startChecking, stopChecking])

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      stopChecking()
    }
  }, [stopChecking])

  return {
    status,
    isConnected: status.connected,
    isChecking,
    isRetrying,
    retryCount,
    checkStatus,
    startChecking,
    stopChecking,
    reset
  }
}

/**
 * Hook for simple agent connectivity check (lighter version)
 */
export function useArduinoAgentStatus(): {
  isConnected: boolean
  isChecking: boolean
  checkStatus: () => Promise<void>
} {
  const { isConnected, isChecking, checkStatus } = useArduinoAgent({
    checkInterval: 10000, // Check less frequently
    maxRetries: 1 // Don't retry as much
  })

  return {
    isConnected,
    isChecking,
    checkStatus
  }
}
