/**
 * Parse gcc/clang-style diagnostics out of arduino-cli compile output so they
 * can be shown inline in the editor (Monaco markers) and made clickable —
 * instead of living only as text in the Output pane.
 *
 * Typical shapes:
 *   C:\proj\Blink\Blink.ino:12:3: error: 'digitalWrit' was not declared in this scope
 *   /home/geo/sketch/sketch.ino:4:1: warning: unused variable 'x' [-Wunused]
 *   In file included from C:\proj\lib\Foo.h:1:0,
 */
export interface ParsedDiagnostic {
  /** Absolute or sketch-relative path as printed by the compiler */
  file: string
  /** 1-based line */
  line: number
  /** 1-based column (defaults to 1 when the compiler omits it) */
  column: number
  severity: 'error' | 'warning' | 'note'
  message: string
}

// path:line:col: severity: message   (col optional; windows drive letters ok)
const DIAG_RE =
  /^(?<file>(?:[A-Za-z]:)?[^:\n]+?\.(?:ino|h|hpp|c|cpp|cc|S))(?::(?<line>\d+))(?::(?<col>\d+))?:\s*(?<sev>fatal error|error|warning|note):\s*(?<msg>.+)$/

/**
 * Extract all diagnostics from a compile output blob. Multi-line messages
 * (the indented `expected ';' before ...` continuation lines, caret markers,
 * code excerpts) are folded into the preceding diagnostic's message.
 */
export function parseCompileDiagnostics(output: string): ParsedDiagnostic[] {
  const diagnostics: ParsedDiagnostic[] = []
  for (const rawLine of output.split(/\r?\n/)) {
    const m = DIAG_RE.exec(rawLine.trim())
    if (!m || !m.groups) continue
    const sev = m.groups.sev === 'fatal error' ? 'error' : m.groups.sev
    diagnostics.push({
      file: m.groups.file.trim(),
      line: parseInt(m.groups.line, 10) || 1,
      column: parseInt(m.groups.col || '1', 10) || 1,
      severity: sev as ParsedDiagnostic['severity'],
      message: m.groups.msg.trim()
    })
  }
  return diagnostics
}

/**
 * Does a diagnostic's reported path refer to the given editor file? The
 * compiler may print absolute paths (desktop), temp-dir paths (web build
 * materializes sketches to a temp folder), or bare names, so match on
 * normalized path suffixes.
 */
export function diagnosticMatchesFile(diag: ParsedDiagnostic, editorPath: string): boolean {
  const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase()
  const d = norm(diag.file)
  const e = norm(editorPath)
  if (d === e) return true
  // Fall back to a file-name match: the compiler may print a temp-dir copy's
  // path (web build) while the editor shows the original. Sketch folders
  // rarely contain two same-named sources, so the name is a safe key.
  const dName = d.slice(d.lastIndexOf('/') + 1)
  const eName = e.slice(e.lastIndexOf('/') + 1)
  return dName === eName
}
