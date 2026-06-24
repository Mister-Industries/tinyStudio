# TinyService Integration Guide

This document describes the integration of @mister-industries/tinyservice into the tinyStudio Electron application.

## Overview

TinyService is a WebSocket service that wraps arduino-cli for compiling and uploading Arduino sketches. It has been integrated into the Electron main process with the following features:

- **Automatic startup** when the app initializes
- **Graceful shutdown** when the app quits
- **Platform-specific binary management** for arduino-cli
- **Development/Production mode handling** for different execution paths

## Files Modified/Created

### 1. [package.json](package.json#L29)

Added dependency:

```json
"@mister-industries/tinyservice": "^1.0.0"
```

### 2. Package registry

`@mister-industries/tinyservice` and `@mister-industries/shared` are published to **public npm**,
so a plain `npm install` resolves them with no `.npmrc`, token, or registry configuration. (If you
ever fork the backend into a private registry, that's where a scoped `.npmrc` would go.)

### 3. [electron-builder.yml](electron-builder.yml#L11-L35)

Configured bundling of platform-specific arduino-cli binaries as `extraResources`:

- **macOS Intel**: `node_modules/@mister-industries/tinyservice/binaries/macos-x64/arduino-cli` → `arduino-cli/darwin-x64/`
- **macOS ARM**: `node_modules/@mister-industries/tinyservice/binaries/macos-arm64/arduino-cli` → `arduino-cli/darwin-arm64/`
- **Linux x64**: `node_modules/@mister-industries/tinyservice/binaries/linux-x64/arduino-cli` → `arduino-cli/linux-x64/`
- **Linux ARM64**: `node_modules/@mister-industries/tinyservice/binaries/linux-arm64/arduino-cli` → `arduino-cli/linux-arm64/`
- **Windows**: `node_modules/@mister-industries/tinyservice/binaries/windows-x64/arduino-cli.exe` → `arduino-cli/win32-x64/`

### 4. [src/main/ServiceManager.ts](src/main/ServiceManager.ts)

New class that manages the TinyService lifecycle:

**Key Features:**

- Dynamically imports TinyService to handle ESM modules in CommonJS context
- Detects platform and architecture at runtime
- Resolves correct arduino-cli binary path:
  - **Development mode** (`!app.isPackaged`): Uses system `arduino-cli` from PATH
  - **Production mode** (`app.isPackaged`): Uses bundled binary from `process.resourcesPath`
- Provides `start()` and `stop()` methods with error handling
- Configuration: port 3000, allowedOrigins: ['*']

### 5. [src/main/index.ts](src/main/index.ts)

Updated main process entry point:

**Changes:**

- Imports and instantiates `ServiceManager`
- Starts TinyService in `app.whenReady()` callback with error handling
- Stops TinyService gracefully in `app.on('before-quit')` event
- Ensures clean shutdown by calling `app.exit()` after stopping the service

## Architecture

### Service Lifecycle

```
app.whenReady()
  ↓
serviceManager.start()
  ├─ Detect platform/arch
  ├─ Resolve arduino-cli path
  ├─ Create TinyService instance
  └─ Start WebSocket server on ws://localhost:3000
  
app.beforeQuit
  ↓
serviceManager.stop()
  ├─ Close WebSocket connections
  ├─ Stop HTTP server
  └─ Exit process
```

### Module Resolution

The main process is compiled to CommonJS (`require`), but TinyService is an ESM module. This is handled via dynamic import:

```typescript
async importTinyService() {
  const module = await import('@mister-industries/tinyservice')
  return module.TinyService
}
```

This allows the CommonJS main process to import ESM modules at runtime.

## Running the Application

### Development Mode

```bash
npm run dev
```

The app will:

1. Start the Electron app
2. Initialize TinyService with system `arduino-cli`
3. Listen on `ws://localhost:3000`

### Production Build

```bash
npm run build:mac  # or build:linux, build:win
```

The app will:

1. Bundle platform-specific arduino-cli binaries
2. On launch, resolve the correct binary path from `process.resourcesPath`
3. Initialize TinyService with bundled binary

## Usage in Renderer Process

Renderer processes can connect to TinyService using the WebSocket client from `@mister-industries/shared`:

```typescript
import { TinyServiceClient } from '@mister-industries/shared'

const client = new TinyServiceClient('ws://localhost:3000')

// Connect and use the service
await client.connect()
const result = await client.compile(sketchPath, boardFqbn)
await client.disconnect()
```

## Environment Variables

Optional environment variables that can be set to override defaults:

- `PORT`: TinyService port (default: 3000)
- `ARDUINO_CLI_PATH`: Path to arduino-cli binary (development only)
- `NODE_ENV`: Set to 'development' for debug logging

## Error Handling

The integration includes comprehensive error handling:

- **Startup errors**: Logged but don't prevent app from launching
- **Shutdown errors**: Logged with fallback to force exit
- **Runtime errors**: TinyService logs are visible in DevTools

## Platform Support

The integration supports:

- ✅ macOS (Intel & ARM64)
- ✅ Linux (x64 & ARM64)
- ✅ Windows (x64)

## Troubleshooting

### "arduino-cli not found" in development

Ensure arduino-cli is installed and available in your PATH:

```bash
arduino-cli version
```

### Service fails to start

1. Check port 3000 is not in use: `lsof -i :3000`
2. Verify arduino-cli binary path in ServiceManager logs
3. Ensure you have permission to execute the binary

### WebSocket connection refused

1. Verify TinyService started successfully (check console logs)
2. Confirm connecting from correct origin (add to `allowedOrigins` if needed)
3. Check if another service is using port 3000

## Future Enhancements

Potential improvements:

- Make port configurable via config file or environment variable
- Add IPC channel to communicate service status to renderer
- Implement service health checks
- Add automatic service restart on failure
- Support for authenticated WebSocket connections
