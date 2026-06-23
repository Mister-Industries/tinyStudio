/**
 * WebArduinoService - Arduino service for the browser (web) build.
 *
 * Browsers can't run arduino-cli, but they CAN talk to a local tinyService over
 * a WebSocket — exactly like the desktop build. So when the user runs tinyService
 * locally (a standalone binary or `npx @mister-industries/tinyservice`), the
 * hosted web app gets full compile/upload/serial support by connecting to
 * ws://localhost:3000. The shared WebSocketArduinoService base does all the work;
 * point it at a different backend by setting localStorage["tinyservice.url"].
 *
 * If no backend is running, calls reject with a connection error and the UI
 * surfaces a "backend not running" message (see App.tsx).
 */

import { WebSocketArduinoService } from './WebSocketArduinoService'

export class WebArduinoService extends WebSocketArduinoService {}
