/**
 * storageKeys — every localStorage key tinyStudio uses, in one list.
 *
 * Keys start with `tinystudio.`, except `tinyservice.url`, a documented override
 * for the backend address. Keys holding per-port or per-project data are built by
 * the helpers below. Renaming a key loses what users have saved under it, so a
 * rename needs a migration (see ThemeProvider for the theme key).
 */

export const STORAGE_KEYS = {
  theme: 'tinystudio.theme',
  lastWorkspace: 'tinystudio.lastWorkspace',
  recentProjects: 'tinystudio.recentProjects',
  githubAccount: 'tinystudio.github.account',
  anthropicApiKey: 'tinystudio.anthropicApiKey',
  examplesManifestUrl: 'tinystudio.examples.url',
  monitorTimestamps: 'tinystudio.monitor.timestamps',
  userParts: 'tinystudio.userParts',
  packIndexUrls: 'tinystudio.packs.indexUrls',
  installedPacks: 'tinystudio.packs.installed',
  tinypartsSource: 'tinystudio.tinyparts.source',
  tinypartsLastCheck: 'tinystudio.tinyparts.checked',
  tinypartsDevFolder: 'tinystudio.tinyparts.devFolder',
  tinypartsLive: 'tinystudio.tinyparts.live',
  serviceUrl: 'tinyservice.url'
} as const

/** Where builds before 0.4 saved the theme (the electron-vite template's key). */
export const LEGACY_THEME_KEY = 'vite-ui-theme'

/** Serial Monitor baud and line ending for one port. */
export const monitorSettingsKey = (port: string): string => `tinystudio.monitor.${port}`

/** The GitHub repo a workspace is linked to, and its sync baseline. */
export const githubLinkKey = (workspacePath: string): string =>
  `tinystudio.github.link.${workspacePath}`
