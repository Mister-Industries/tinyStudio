/**
 * ArduinoServiceFactory - Factory for creating appropriate Arduino service instance
 * Detects environment and returns Web or Electron implementation
 */

import { isElectron } from '@renderer/lib/utils'
import { WebArduinoService } from '.'
import { ElectronArduinoService } from './ElectronArduinoService'
import { ArduinoService, Environment } from './types'

/**
 * Configuration options for Arduino service factory
 */
export interface ArduinoServiceConfig {
  /** Arduino CLI path (not used in web environment) */
  agentUrl?: string
  /** Whether to prefer Arduino CLI in Electron (default: false) */
  useArduinoCLI?: boolean
  /** Path to Arduino CLI executable (default: 'arduino-cli') */
  arduinoCliPath?: string
  /** Temporary directory for sketch compilation (Electron only) */
  tempDir?: string
  /** Compilation timeout in milliseconds */
  compileTimeout?: number
  /** Upload timeout in milliseconds */
  uploadTimeout?: number
}

/**
 * Singleton factory for Arduino service instances
 */
export class ArduinoServiceFactory {
  private static instance: ArduinoService | null = null
  private static config: ArduinoServiceConfig = {}

  /**
   * Initialize the Arduino service factory with configuration
   */
  static configure(config: ArduinoServiceConfig): void {
    this.config = { ...this.config, ...config }
    // Clear existing instance to force recreation with new config
    this.instance = null
  }

  /**
   * Get Arduino service instance (singleton)
   */
  static getInstance(): ArduinoService {
    if (!this.instance) {
      this.instance = this.createService()
    }
    return this.instance
  }

  /**
   * Create new Arduino service instance (for testing or manual creation)
   */
  static createService(_config?: ArduinoServiceConfig): ArduinoService {
    const environment = this.detectEnvironment()

    if (environment === 'electron') {
      return new ElectronArduinoService()
    } else {
      return new WebArduinoService()
    }
  }

  /**
   * Detect the current environment (web vs electron)
   */
  static detectEnvironment(): Environment {
    if (isElectron()) {
      return 'electron'
    }

    // Default to web environment
    return 'web'
  }

  /**
   * Check if current environment supports Arduino CLI
   */
  static supportsArduinoCLI(): boolean {
    return this.detectEnvironment() === 'electron'
  }

  /**
   * Get current environment information
   */
  static getEnvironmentInfo(): {
    environment: Environment
    supportsArduinoCLI: boolean
    supportsAgent: boolean
    userAgent?: string
  } {
    const environment = this.detectEnvironment()

    return {
      environment,
      supportsArduinoCLI: environment === 'electron',
      supportsAgent: environment === 'electron', // Only Electron can use Arduino CLI
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined
    }
  }

  /**
   * Reset the factory (for testing)
   */
  static reset(): void {
    this.instance = null
    this.config = {}
  }
}

/**
 * Convenience function to get Arduino service instance
 */
export function getArduinoService(): ArduinoService {
  return ArduinoServiceFactory.getInstance()
}

/**
 * Convenience function to configure and get Arduino service
 */
export function createArduinoService(config: ArduinoServiceConfig): ArduinoService {
  ArduinoServiceFactory.configure(config)
  return ArduinoServiceFactory.getInstance()
}

/**
 * Type guard to check if a service is WebArduinoService
 */
export function isWebArduinoService(service: ArduinoService): service is WebArduinoService {
  return service instanceof WebArduinoService
}

/**
 * Type guard to check if a service is ElectronArduinoService
 */
export function isElectronArduinoService(
  service: ArduinoService
): service is ElectronArduinoService {
  return service instanceof ElectronArduinoService
}

// Augment window interface for Electron environment detection
declare global {
  interface Window {
    process?: {
      type?: string
      versions?: {
        electron?: string
      }
    }
  }
}
