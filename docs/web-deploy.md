# Deploying the web build to Netlify (studio.tinycore.cc)

The same React renderer that ships in the desktop app is built as a static
bundle and hosted in the browser. This is the cloud-hosted IDE at
`studio.tinycore.cc` (`app.tinystudio.cc` and `tinystudio.cc` forward to it;
the domain plan is in [accounts-and-domains.md](accounts-and-domains.md)).
Compile/upload/serial still run through **tinyService** on the user's own
machine — the hosted page just connects to it over a local WebSocket.

## 1. What's in the repo

- [`netlify.toml`](../netlify.toml) — build command (`npm run build:web`), publish
  dir (`dist-web`), Node version, the functions folder, and the SPA fallback
  redirect that makes `/<owner>/<repo>/<path>` deep links work.
- [`netlify/functions/github-token.ts`](../netlify/functions/github-token.ts) —
  the one server-side step of GitHub sign-in in the browser. It needs
  `GITHUB_CLIENT_SECRET` in the site's environment variables
  ([github-auth.md](github-auth.md)).
- The web build's asset base is `/` (see [`web.vite.config.mts`](../web.vite.config.mts))
  so assets resolve from any deep path.

## 2. Connect the site in Netlify

1. Netlify → **Add new site → Import an existing project** → pick this GitHub repo.
2. Build settings are read from `netlify.toml`; you shouldn't need to change them.
   (If asked: build command `npm run build:web`, publish directory `dist-web`.)
3. Site configuration → Environment variables: add `GITHUB_CLIENT_SECRET`, the
   tinyStudio OAuth app's secret.
4. Domain management → Automatic deploy subdomains → Deploy Previews: domain
   `tinystudio.cc`, subdomain `preview`, so previews get
   `deploy-preview-N.preview.tinystudio.cc` and can sign in.
5. Choose the branch to deploy (e.g. `main`). Deploy.

You now have a `*.netlify.app` URL. Confirm the app loads and that a deep link
like `https://<site>.netlify.app/Mister-Industries/tinyStudio-examples/basics/blink-basic`
opens that project (proves the SPA redirect works).

## 3. Point studio.tinycore.cc at it

1. Netlify → **Domain settings → Add a domain** → `studio.tinycore.cc`. All four
   domains use Netlify DNS, so the record is created for you.
2. Netlify auto-provisions a Let's Encrypt certificate once DNS resolves.
3. Make it the primary domain, and forward the old address with the rule in
   [accounts-and-domains.md](accounts-and-domains.md) (`app.tinystudio.cc/*` →
   `studio.tinycore.cc/:splat`). The apex `tinystudio.cc` becomes the landing
   page: it moves to the tinyDocs Netlify site, which serves the page at the
   root and forwards every other path to the app (rules in tinydocs-cc's
   `netlify.toml`).

## 4. Deep links to GitHub projects

Scheme: `studio.tinycore.cc/<owner>/<repo>/<optional/sub/path>`

- `…/Mister-Industries/tinyStudio-examples/basics/blink-basic` opens that folder.
- The folder is fetched from the repo's **default branch** via the GitHub API +
  `raw.githubusercontent.com`, loaded into an in-memory workspace, and opened —
  no local folder pick, no clone.
- Only public repos load anonymously. A signed-in GitHub token (the GitHub
  button in the app) just raises the rate limit. Anonymous GitHub API is
  60 req/hr/IP; content comes from raw to stay mostly off that limit.

## 5. Examples

The **Examples** tab (in the right-hand docs panel) reads a manifest from the
examples repo:

- Default URL:
  `https://raw.githubusercontent.com/Mister-Industries/tinyStudio-examples/main/examples.json`,
  set in [`lib/examples.ts`](../src/renderer/src/lib/examples.ts). It must be on
  that repo's `main` for the live site to see it.
- Each entry is `{ title, description, owner, repo, path, board?, tags? }`;
  clicking **Open** loads it exactly like a deep link. Entries can point at any
  public repo, which is how the tinyHAT examples live in their own repos.
- One folder per example (`basics/<name>/<name>.ino`, plus an optional
  `circuit.json`, `visual.js` and a `README.md`).
- The `tags` field is filled in by the examples repo's own workflow, which runs
  `tools/gen-example-tags.mjs` over the sketches on every push to `main`. The
  tag vocabulary has to match `lib/exampleTags.ts` here.

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
