# GitHub sign-in

tinyStudio signs users in to GitHub two ways, both with the same OAuth app and
without shipping anything secret in the app:

- **Desktop:** the OAuth **device flow**. The user gets a short code, types it
  on github.com, and the app polls until GitHub says yes.
- **Browser:** the OAuth **authorization-code flow with PKCE**. The page goes
  to github.com and comes back to `/auth/github/callback` on the same host; a
  Netlify function swaps the code for a token.

Pasting a personal access token stays available behind **Advanced** for
enterprise and air-gapped setups.

The app's registration, the domains and what else the account is for are in
[accounts-and-domains.md](accounts-and-domains.md); this file is the
implementation.

## Why an OAuth App and not a GitHub App

A GitHub App gives nicer per-repository permissions, and that was the first
instinct. It does not work here: **a GitHub App cannot create a repository in a
user's personal account**, which is exactly what "Make it mine" does. Repository
creation needs an OAuth scope, so an OAuth App it is.

To keep the ask as small as possible we request `public_repo`, not `repo`:

| scope         | what it allows                                                                     |
| ------------- | ---------------------------------------------------------------------------------- |
| `public_repo` | read/write **public** repos, and create new ones. Cannot see private repos at all. |
| `repo`        | everything above **plus full access to every private repo** the user can reach.    |

The trade-off is that copies can only be public, which suits GitHub Pages
anyway, since Pages needs a public repo on the free plan. If private copies ever
become a requirement, widen `GITHUB_SCOPE` in
[`src/shared/githubApp.ts`](../src/shared/githubApp.ts) to `repo` and re-enable
the private option in `MakeItMine`.

## The app

One OAuth app, owned by the Mister-Industries organization, named `tinyStudio`.
Its **client id is public** and built in as the default in
[`src/shared/githubApp.ts`](../src/shared/githubApp.ts); `VITE_GITHUB_CLIENT_ID`
overrides it at build time (or `GITHUB_CLIENT_ID` at run time, for main-process
development).

Registered on the app:

- **Device Flow: on.** Without it desktop sign-in fails with
  `device_flow_disabled`.
- **Callback URLs**, one per host the web flow can start from:
  `https://studio.tinycore.cc/auth/github/callback`,
  `https://app.tinystudio.cc/auth/github/callback` (until that address
  forwards), `https://preview.tinystudio.cc/auth/github/callback` with the
  subdomain wildcard on (deploy previews), and
  `http://localhost:5173/auth/github/callback` plus `:5174` for development.
- **The client secret** exists only in the tinyStudio Netlify site's
  environment, as `GITHUB_CLIENT_SECRET`. It is never in the repo, the built
  app, a `.env` file that gets committed, or chat.

The path is `/auth/github/callback`, not `/auth/callback`: the tinyCore
sign-in uses `/auth/callback` on every tinycore.cc site, and the two must not
collide.

## How the desktop flow works

- [`src/main/githubAuth.ts`](../src/main/githubAuth.ts) runs the flow and stores
  the token with Electron `safeStorage` (OS keychain / DPAPI), the same way the
  Anthropic API key is stored. It lives in **main**, not the renderer, because
  GitHub's OAuth endpoints send no CORS headers — a renderer `fetch` to them
  fails outright.
- The renderer receives the token **in memory only** (`initAccount()` in
  `lib/github.ts`) and never writes it to `localStorage`.

## How the web flow works

1. [`lib/githubWebAuth.ts`](../src/renderer/src/lib/githubWebAuth.ts) makes a
   random `state` and a PKCE verifier, keeps both in `sessionStorage` with the
   page the user was on, and sends the browser to
   `github.com/login/oauth/authorize` with `redirect_uri` set to this host's
   own `/auth/github/callback`.
2. GitHub sends the browser back with a `code`. `App.tsx` sees the callback
   path, and `completeWebSignIn()` checks the state and POSTs the code, the
   verifier and the redirect URI to the token function.
3. [`netlify/functions/github-token.ts`](../netlify/functions/github-token.ts)
   accepts only the app's own origins (production, the transitional
   `app.tinystudio.cc`, deploy previews at
   `deploy-preview-N.preview.tinystudio.cc`, and localhost), checks that the
   redirect URI belongs to the calling origin, and asks GitHub for the token
   with the client secret. GitHub requires the secret here even with PKCE.
4. The page loads the profile, stores the account the way a pasted token was
   stored, and returns to the page the user started on, which may be a project
   deep link.

Every page exchanges the code on its own site. On `npm run dev:web`,
`githubTokenDev` in [`vite-plugins.ts`](../vite-plugins.ts) serves
`/.netlify/functions/github-token` by running the same function file, so
sign-in works on `http://localhost:5173` and `:5174` without a deploy:

1. Create `.env.local` in the repo root, which git ignores, with one line:
   `GITHUB_CLIENT_SECRET=<the client secret>`. `GITHUB_CLIENT_SECRET` in the
   environment works too.
2. Sign in. The file is read on every exchange, so there's nothing to restart.

Without a secret, the dev server answers with a message saying to add it. Other
ports aren't in the function's allowed origins or the app's callback URLs.

`VITE_GITHUB_TOKEN_ENDPOINT` points the exchange somewhere else, such as the
hosted app's function once it's deployed. That host has to be in the page's
Content Security Policy (`connect-src` in `src/renderer/index.html`).

## Sign-in surfaces

[`components/GitHubSignIn.tsx`](../src/renderer/src/components/GitHubSignIn.tsx)
is the one sign-in surface, used by both the header control and the GitHub
sidebar tab. It picks the device flow on desktop, the web flow in the browser,
and offers the pasted token under **Advanced** in both.
