/**
 * The port tinyService tries first. The desktop app moves up from here when the
 * port is taken (ServiceManager) and tells the renderer the real address; the
 * web app uses it unless localStorage `tinyservice.url` overrides it. The CSP in
 * src/renderer/index.html can't import this, so it allows any localhost port.
 */
export const TINYSERVICE_DEFAULT_PORT = 3000
