/// <reference types="vite/client" />

// Build-time values from the vite configs' `define` (VITE_GITHUB_CLIENT_ID and
// VITE_GITHUB_TOKEN_ENDPOINT); empty when unset, undefined under node tests.
declare const __GITHUB_CLIENT_ID__: string | undefined
declare const __GITHUB_TOKEN_ENDPOINT__: string | undefined
