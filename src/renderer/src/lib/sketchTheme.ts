/**
 * sketchTheme — the `theme` object p5 sketches (visual.js) draw with.
 *
 * Sketches use theme.bg, theme.accent, … instead of hard-coded colours, so a
 * visual matches the app in light and dark mode and recolours live when the
 * user flips the theme. The in-app Visual view (VisualPreview) and the
 * standalone export (visualExport) both build it from this token map, so a
 * sketch looks the same in either place.
 *
 * Studio AI documents these fields in src/shared/agentGuides/visual-js.md —
 * keep that list in sync when adding one.
 */

/** theme field → the design token (assets/base.css) it reads. */
export const SKETCH_THEME_TOKENS = {
  bg: '--bg-raised',
  panel: '--bg-sunken',
  grid: '--border-soft',
  border: '--border-default',
  text: '--text-strong',
  body: '--text-body',
  muted: '--text-muted',
  faint: '--text-faint',
  accent: '--brand',
  blue: '--blue',
  green: '--green',
  yellow: '--yellow',
  red: '--red',
  purple: '--purple'
} as const

/** Colour order for multi-series charts, most distinct first. */
export const SKETCH_SERIES = ['blue', 'green', 'purple', 'red', 'yellow'] as const

export const SKETCH_FONTS = { font: 'Plus Jakarta Sans', mono: 'Fira Code' } as const

export type SketchTheme = Record<keyof typeof SKETCH_THEME_TOKENS, string> & {
  dark: boolean
  series: string[]
  font: string
  mono: string
}

let liveTheme: SketchTheme | null = null

/** Refill `theme` in place (sketches hold a reference to it) from the page's tokens. */
function fill(theme: SketchTheme): void {
  const root = document.documentElement
  const css = getComputedStyle(root)
  for (const [field, token] of Object.entries(SKETCH_THEME_TOKENS)) {
    theme[field as keyof typeof SKETCH_THEME_TOKENS] = css.getPropertyValue(token).trim()
  }
  theme.dark = root.classList.contains('dark') || root.getAttribute('data-theme') === 'dark'
  theme.series = SKETCH_SERIES.map((k) => theme[k])
}

/**
 * The live theme object for in-app sketches: created once, then kept current by
 * watching the root element for ThemeProvider's light/dark class change.
 */
export function sketchTheme(): SketchTheme {
  if (!liveTheme) {
    const theme = { ...SKETCH_FONTS } as SketchTheme
    fill(theme)
    new MutationObserver(() => fill(theme)).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme']
    })
    liveTheme = theme
  }
  return liveTheme
}

/**
 * The same object as a plain script for the standalone export page, which has
 * its own copy of the tokens and toggles `data-theme` on <html>.
 */
export function sketchThemeScript(): string {
  return `var theme = ${JSON.stringify(SKETCH_FONTS)};
  function __fillTheme() {
    var css = getComputedStyle(document.documentElement);
    var tokens = ${JSON.stringify(SKETCH_THEME_TOKENS)};
    for (var k in tokens) theme[k] = css.getPropertyValue(tokens[k]).trim();
    theme.dark = document.documentElement.getAttribute('data-theme') === 'dark';
    theme.series = ${JSON.stringify(SKETCH_SERIES)}.map(function (k) { return theme[k]; });
  }
  __fillTheme();
  new MutationObserver(__fillTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });`
}
