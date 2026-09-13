# GitHub sign-in

tinyStudio signs users in with the GitHub **OAuth device flow** — the user gets
a short code, types it on github.com, and the app polls until GitHub says yes.
No token to paste, and nothing secret ships inside the app.

## Why an OAuth App and not a GitHub App

A GitHub App gives nicer per-repository permissions, and that was the first
instinct. It does not work here: **a GitHub App cannot create a repository in a
user's personal account**, which is exactly what "Make it mine" does. Repository
creation needs an OAuth scope, so an OAuth App it is.

To keep the ask as small as possible we request `public_repo`, not `repo`:

| scope | what it allows |
| --- | --- |
| `public_repo` | read/write **public** repos, and create new ones. Cannot see private repos at all. |
| `repo` | everything above **plus full access to every private repo** the user can reach. |

`public_repo` is strictly less access than the full-`repo` Personal Access Token
the app used to ask people to paste. The trade-off is that copies can only be
public — which suits GitHub Pages anyway, since Pages needs a public repo on the
free plan. If private copies ever become a requirement, widen `SCOPE` in
[`src/main/githubAuth.ts`](../src/main/githubAuth.ts) to `repo` and re-enable the
private option in `MakeItMine`.

## Registering the app (one-time)

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Fill in:
   - **Application name**: `tinyStudio`
   - **Homepage URL**: `https://app.tinystudio.cc`
   - **Authorization callback URL**: `https://app.tinystudio.cc/auth/callback`
     (unused by the device flow; required by the form, and needed later for the
     web build's PKCE flow)
3. Create it, then on the app's page tick **Enable Device Flow** and save.
   Without this, sign-in fails with `device_flow_disabled`.
4. Copy the **Client ID**. It is public — it is fine in the repo, in the built
   app, and in CI.

Do **not** generate a client secret for the desktop app. The device flow does
not use one, and anything shipped in a desktop binary is not a secret.

## Wiring it in

Set `VITE_GITHUB_CLIENT_ID` at build time:

```bash
# local dev
VITE_GITHUB_CLIENT_ID=Ov23li... npm run dev

# packaged build
VITE_GITHUB_CLIENT_ID=Ov23li... npm run build:win
```

Or put it in a `.env` file at the repo root. Without it the app still runs and
falls back to the Personal Access Token path, with a message saying no client ID
is configured.

## How it fits together

- [`src/main/githubAuth.ts`](../src/main/githubAuth.ts) runs the flow and stores
  the token with Electron `safeStorage` (OS keychain / DPAPI), the same way the
  Anthropic API key is stored. It lives in **main**, not the renderer, because
  GitHub's OAuth endpoints send no CORS headers — a renderer `fetch` to them
  fails outright.
- The renderer receives the token **in memory only** (`initAccount()` in
  `lib/github.ts`) and never writes it to `localStorage`, which is where it used
  to sit in plaintext.
- [`components/GitHubSignIn.tsx`](../src/renderer/src/components/GitHubSignIn.tsx)
  is the one sign-in surface, used by both the header control and the GitHub
  sidebar tab. Pasting a token is still available behind "Advanced" for
  enterprise and air-gapped setups.

## Still to do: the web build

`app.tinyStudio.cc` still uses the token path. The device flow cannot run there:
the browser cannot call GitHub's OAuth endpoints (no CORS), so the web build
needs the authorization-code flow with PKCE plus a small Netlify Function
holding the client secret to do the code→token exchange. That is the next piece
of work; everything else — the account store, the sign-in UI, the permission
checks — is already shared.
