// Vite import suffixes used by the Studio AI guides (src/shared/agentGuides).
// The renderer gets these from vite/client; the main-process build
// (tsconfig.node.json) needs them spelled out.

declare module '*.md?raw' {
  const text: string
  export default text
}

declare module '*.jpg?inline' {
  const dataUrl: string
  export default dataUrl
}

declare module '*.png?inline' {
  const dataUrl: string
  export default dataUrl
}
