# tinyService integration

tinyService is the local backend that compiles, uploads and talks to boards. It is
a WebSocket and HTTP server around `arduino-cli`, published on npm as
[`@mister-industries/tinyservice`](https://www.npmjs.com/package/@mister-industries/tinyservice),
with its client and protocol types in `@mister-industries/shared`. tinyStudio
needs tinyService 1.1.0 or later.

This guide covers how the desktop app runs it, how the renderer finds it, and how
the browser build uses it.

## Desktop: the main process runs it

[`src/main/ServiceManager.ts`](src/main/ServiceManager.ts) owns the backend.
[`src/main/index.ts`](src/main/index.ts) creates one `ServiceManager`, starts it
when the app is ready and stops it before the app quits (forcing exit after three
seconds if it hangs).

`start()` does this:

1. **Picks a port.** It tries `TINYSERVICE_DEFAULT_PORT` (3000, from
   [`src/shared/tinyservice.ts`](src/shared/tinyservice.ts)) and the next nine,
   and takes the first one free on 127.0.0.1. Port 3000 is a common dev-server
   default, so it can't be assumed.
2. **Finds arduino-cli.**
   - In development: `vendor/arduino-cli/<platform>/`, fetched by
     [`scripts/fetch-arduino-cli.mjs`](scripts/fetch-arduino-cli.mjs), falling back
     to `arduino-cli` on `PATH`.
   - In a packaged app: `resources/arduino-cli/<platform>/`, copied there by
     `extraResources` in [`electron-builder.yml`](electron-builder.yml).
   - The folder names differ: `vendor/` uses `windows-x64` and `macos-arm64`, the
     packaged app uses `win32-x64` and `darwin-arm64`.
3. **Finds the language server** (optional). `arduino-language-server` and
   `clangd` from `vendor/language-server/<platform>/` or
   `resources/language-server/<platform>/`, fetched by
   `npm run fetch:language-server`. Without them the editor still works, just
   without completion and diagnostics.
4. **Spawns tinyService as a child process.** It runs Electron's own binary in
   Node mode (`ELECTRON_RUN_AS_NODE=1`) with a short launcher that imports the ESM
   package and calls `new TinyService(options).start()`. A separate process is
   used because Electron's main-process loader can't reliably import the ESM
   package, and it keeps a backend crash out of the app. The child's working
   directory is the app root, so it resolves the package from `node_modules`.
   That is why `asar` is disabled in the packaged app.
5. **Waits for `/health`.** It polls `http://localhost:<port>/health` up to ten
   times, a second apart. If arduino-cli isn't available, or the service never
   answers, it sends `service:error` to the renderer.

tinyService's output is forwarded to the main-process console with a
`[tinyService]` prefix.

## Renderer: finding the service

[`WebSocketArduinoService`](src/renderer/src/services/arduino/WebSocketArduinoService.ts)
connects to the first of these that exists:

1. `localStorage["tinyservice.url"]`, an explicit override
2. On desktop, the URL main reports over `service:get-url-sync`, which carries the
   port tinyService actually got
3. `ws://localhost:3000`

The Content Security Policy in
[`src/renderer/index.html`](src/renderer/index.html) allows `ws://` and `http://`
to any port on `localhost` and `127.0.0.1`, so a backend on 3001 connects too.

## Browser build

The browser can't start processes, so tinyService has to be running on the same
computer. When the app can't reach it, it offers the tinyService installer from
the [tinyService releases](https://github.com/Mister-Industries/tinyService/releases/latest).
Anyone developing tinyService itself can run it from that repo instead.

Browser projects opened from GitHub live in memory (`mem://` paths) and can't be
compiled until they're saved to a real folder, because arduino-cli reads from
disk.

## Security

`ServiceManager` passes `allowedOrigins` (the packaged app, the dev server and
`https://app.tinystudio.cc`), but tinyService 1.1.0 doesn't check it and listens on
all network interfaces. Until a tinyService release binds to `127.0.0.1` and
checks the `Origin` header, any web page open on the computer, and anything on the
local network, can reach the backend.

## Troubleshooting

**"Arduino CLI is not available"**
Run `npm run fetch:arduino-cli` (development), or check that
`resources/arduino-cli/<platform>/` exists in the packaged app.

**The app can't reach the backend**
Check the main-process console for `[ServiceManager]` and `[tinyService]` lines.
On desktop, ports 3000 to 3009 all being taken stops it from starting. In the
browser, make sure tinyService is running and, if it isn't on port 3000, set
`localStorage["tinyservice.url"]`.

**No completion or diagnostics in the editor**
The language server isn't bundled by default. Run
`npm run fetch:language-server` and restart.
