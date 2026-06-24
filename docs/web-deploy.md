# Deploying the web build to Netlify (app.tinyStudio.cc)

The same React renderer that ships in the desktop app is built as a static
bundle and hosted in the browser. This is the cloud-hosted IDE at
`app.tinyStudio.cc`. Compile/upload/serial still run through **tinyService** on
the user's own machine — the hosted page just connects to it over a local
WebSocket.

## 1. What's in the repo

- [`netlify.toml`](../netlify.toml) — build command (`npm run build:web`), publish
  dir (`dist-web`), Node version, and the SPA fallback redirect that makes
  `/<owner>/<repo>/<path>` deep links work.
- The web build's asset base is `/` (see [`web.vite.config.mts`](../web.vite.config.mts))
  so assets resolve from any deep path.

## 2. Connect the site in Netlify

1. Netlify → **Add new site → Import an existing project** → pick this GitHub repo.
2. Build settings are read from `netlify.toml`; you shouldn't need to change them.
   (If asked: build command `npm run build:web`, publish directory `dist-web`.)
3. Choose the branch to deploy (e.g. `main`). Deploy.

You now have a `*.netlify.app` URL. Confirm the app loads and that a deep link
like `https://<site>.netlify.app/Mister-Industries/tinyStudio/demo/Blink%20Example`
opens that project (proves the SPA redirect works).

## 3. Point app.tinyStudio.cc at it

1. Netlify → **Domain settings → Add a domain** → `app.tinyStudio.cc`.
2. At your DNS provider for `tinyStudio.cc`, add the record Netlify shows. Usually:

   | Type  | Name  | Value                         |
   | ----- | ----- | ----------------------------- |
   | CNAME | `app` | `<your-site>.netlify.app`     |

   (Netlify may instead give you their `apex`/`ALIAS` instructions — follow what
   the dashboard shows for the subdomain.)
3. Netlify auto-provisions a Let's Encrypt certificate once DNS resolves. The
   apex `tinyStudio.cc` is left free for the marketing homepage (a separate repo,
   later).

## 4. Deep links to GitHub projects

Scheme: `app.tinyStudio.cc/<owner>/<repo>/<optional/sub/path>`

- `…/Mister-Industries/tinyStudio/demo/Blink%20Example` opens that folder.
- The folder is fetched from the repo's **default branch** via the GitHub API +
  `raw.githubusercontent.com`, loaded into an in-memory workspace, and opened —
  no local folder pick, no clone.
- Only public repos load anonymously. A signed-in GitHub token (the GitHub
  button in the app) just raises the rate limit. Anonymous GitHub API is
  60 req/hr/IP; content comes from raw to stay mostly off that limit.

## 5. Examples

The **Examples** tab (in the right-hand docs panel) reads a manifest:

- Default URL: `https://raw.githubusercontent.com/Mister-Industries/tinyStudio/main/examples.json`
  — i.e. [`examples.json`](../examples.json) **on the `main` branch**. It must be
  on `main` for the live site to see it.
- Each entry is `{ title, description, owner, repo, path, board? }`; clicking
  **Open** loads it exactly like a deep link.

### Moving to a dedicated examples repo (the intended end state)

1. Create a public repo, e.g. `Mister-Industries/tinyStudio-examples`, with an
   `examples.json` at its root and one folder per example (same project layout as
   `demo/`: `sketch/sketch.ino`, `diagram.json`, `visual.js`, `README.md`).
2. Point each manifest entry's `owner`/`repo`/`path` at that repo.
3. Repoint `DEFAULT_MANIFEST_URL` in
   [`ExamplesContent.tsx`](../src/renderer/src/components/ExamplesContent.tsx) to
   the new repo's raw `examples.json`.

## 6. Local overrides (for testing)

Set these in the browser console / devtools `localStorage`:

- `tinyservice.url` — point the app at a non-default backend
  (default `ws://localhost:3000`).
- `tinystudio.examples.url` — point the Examples tab at a different manifest
  (e.g. a branch or fork) before it's merged to `main`.

## 7. Browser note (important)

The hosted page is `https://`, but tinyService is `ws://localhost:3000`
(insecure WebSocket). **Chrome and Edge** treat `localhost` as trustworthy and
allow this; **Safari and some Firefox setups may block it** as mixed content.
The in-app "Start tinyService" banner recommends Chrome/Edge for this reason.
