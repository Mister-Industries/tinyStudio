import { Toaster } from 'sonner'
import { useTheme } from '../lib/ThemeProvider'

/**
 * Toast host; without this, no toast.* feedback ever renders.
 *
 * Reads the theme through the hook rather than a hardcoded value: sonner stamps
 * `data-sonner-theme` on the toaster and resolves its own palette from it, so a
 * fixed theme paints the parts we don't override (description text, action and
 * close buttons) for the wrong mode. Everything else is styled from the design
 * tokens in ds-components.css (.ts-toast), so a toast and a bell entry match.
 */
export function ThemedToaster(): React.JSX.Element {
  const { theme } = useTheme()

  return (
    <Toaster
      theme={theme}
      position="bottom-right"
      closeButton
      toastOptions={{ className: 'ts-toast' }}
    />
  )
}
