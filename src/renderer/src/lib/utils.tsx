import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const isElectron = (): boolean => !!window?.electron

/** Open a URL in the system browser (desktop) or a new tab (web). */
export const openExternal = (url: string): void => {
  if (typeof window !== 'undefined' && window.api?.fs?.openExternal) {
    void window.api.fs.openExternal(url)
  } else {
    window.open(url, '_blank', 'noreferrer')
  }
}
