/**
 * freePort: find a TCP port tinyService can bind. Kept free of Electron so
 * it can be unit-tested; ServiceManager supplies the preferred port.
 *
 * A port is probed twice, on 127.0.0.1 (where tinyService 1.2 binds) and on
 * the wildcard address (where 1.1 and most dev servers bind). Windows allows a
 * specific-address bind next to a wildcard one and the other way round, so a
 * single probe misses one kind of listener: the installed tray tinyService is
 * exactly that case, and the app's child then died with EADDRINUSE while the
 * health check reached the tray service and passed.
 */

import net from 'net'

/** True when nothing holds `port` on `host` (or on every interface when omitted). */
export function canBind(port: number, host?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        probe.close(() => resolve(true))
      })
    if (host) probe.listen(port, host)
    else probe.listen(port)
  })
}

/**
 * The first port from `preferred` that is free both on 127.0.0.1 and on the
 * wildcard address. Port 3000 is a very popular dev-server default, so never
 * assume it's ours.
 */
export async function findFreePort(preferred: number, attempts = 10): Promise<number> {
  for (let port = preferred; port < preferred + attempts; port++) {
    if ((await canBind(port, '127.0.0.1')) && (await canBind(port))) return port
  }
  throw new Error(`No free port found in ${preferred}-${preferred + attempts - 1} for TinyService`)
}
