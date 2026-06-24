/**
 * ElectronArduinoService - Arduino service for the desktop (Electron) build.
 *
 * The Electron main process starts tinyService in-process on launch, so the
 * renderer just connects to ws://localhost:3000. All of that connection and
 * request/response logic lives in the shared WebSocketArduinoService base — this
 * class exists so the factory and type guards can distinguish the desktop build.
 */

import { WebSocketArduinoService } from './WebSocketArduinoService'

export class ElectronArduinoService extends WebSocketArduinoService {}
