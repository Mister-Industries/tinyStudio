# Accounts, domains and classes

How tinycore.cc, tinyDocs and tinyStudio share one account:

- which domain serves what
- how tinyStudio's GitHub sign-in is registered
- the class and project features planned for later

Every decision here was made by the owner on 2026-09-14. Only **Change now** is 0.4.0 work.

**For the agent on `v0.4-dev`:**

- Read **Change now** first.
- Update step 6 of `docs/release-plan.md` to match it, and link this file from there.
- Commit this file with that change.

## Decisions

- **One account for everything.** It's the tinyCore account: Supabase Auth in the `tinycore-cc` repo, with sign-in through GitHub or Google.
  - Its session cookie is set on `.tinycore.cc`.
  - So every site that needs the login lives on a `tinycore.cc` subdomain.
- **The short domains stay forever.** `tinycore.cc`, `tinystudio.cc` and `tinydocs.cc` are on QR codes and links online. They forward to the real site and keep the path.
- **tinyStudio keeps its own GitHub OAuth app** for repo access (`public_repo`). It is never shared with the GitHub app inside Supabase.
- **Student work is saved on the student's computer.** There is no cloud storage for student copies. Public GitHub repos are fine for portfolio work.
- **Grades live in Canvas.** tinyStudio and tinyDocs never store grades.

## Domains

| Address                                  | Serves                        | Netlify site       | Signed in                           |
| ---------------------------------------- | ----------------------------- | ------------------ | ----------------------------------- |
| `tinycore.cc`                            | Home and store                | tinycore-cc        | Yes; sets the `.tinycore.cc` cookie |
| `studio.tinycore.cc`                     | tinyStudio web app            | tinyStudio         | Yes                                 |
| `docs.tinycore.cc`                       | tinyDocs                      | tinydocs-astro     | Yes, once sign-in is added          |
| `tinystudio.cc`                          | tinyStudio landing page       | tinydocs-astro     | No                                  |
| `deploy-preview-N.preview.tinystudio.cc` | tinyStudio deploy previews    | tinyStudio         | No                                  |

These addresses forward to another site:

| Visited                                                | Forwards to                 |
| ------------------------------------------------------ | --------------------------- |
| `app.tinystudio.cc/*`                                  | `studio.tinycore.cc/:splat` |
| `tinystudio.cc/*`, except the landing page's own pages | `studio.tinycore.cc/:splat` |
| `tinydocs.cc/*`                                        | `docs.tinycore.cc/:splat`   |
| `docs.mr.industries/*`                                 | `docs.tinycore.cc/:splat`   |

What's live today (checked 2026-09-14):

- **DNS.** `tinycore.cc`, `tinystudio.cc`, `tinydocs.cc` and `mr.industries` all use Netlify DNS. New subdomains, HTTPS certificates and deploy subdomains are dashboard settings.
- **tinyStudio.** `tinystudio.cc` and `app.tinystudio.cc` serve the same app, so project links like `/<owner>/<repo>` exist on both.
- **tinyDocs.** `tinydocs.cc` and `docs.mr.industries` serve the same Astro site.
  - The live site matches the `FacioErgoSum/tinydocs-cc` repo. The older `tinydocs-astro` repo is out of date.
  - `tinydocs.cc/get-started` returns 404; that page is at `/1_get-started/`.
  - The header's "Sign In" button links to `https://tinycore.cc/store`.
- **tinycore.cc.** No `tinycore.cc` subdomain exists yet; the store is at `tinycore.cc/store`.

Rules:

- **User-written pages stay off `tinycore.cc`.** Shared Visual previews and embeds in the project gallery never go on a `tinycore.cc` subdomain, because code there can read the session cookie. Use GitHub Pages or a domain outside `tinycore.cc`.
- **Deploy previews stay off `tinycore.cc` too.** A preview runs code that isn't merged yet.
- **Moving a domain loses what the browser saved.** Browser storage belongs to one domain, so users lose recent projects, folder permissions, custom parts, saved keys, GitHub sign-in and settings. Make `studio.tinycore.cc` the main address before GitHub sign-in in the browser reaches users, so nobody signs in twice.
- **Keep order history and accounts safe:**
  - Never create a new Supabase project.
  - In Supabase, only add redirect URLs; leave Site URL unchanged.
  - Keep `tinycore.cc` on its current Netlify site. Stripe webhooks call `tinycore.cc/api/webhooks/stripe`.
  - Keep the cookie domain `.tinycore.cc`.

### Moving the domains

The owner does these steps in Netlify, in this order:

1. Add `studio.tinycore.cc` to the tinyStudio site as a domain alias. Both addresses work.
2. Test the app on `studio.tinycore.cc`, including compile and upload through tinyService.
3. Make `studio.tinycore.cc` the primary domain and add the forwarding rule for `app.tinystudio.cc`.
4. At a quiet time, move `tinystudio.cc` from the tinyStudio site to the tinydocs site. That site serves the landing page (`/tinystudio/` in the tinydocs-cc repo) and already has the forwarding rules. The new certificate can take a few minutes.
5. For docs:
   - Add `docs.tinycore.cc` to the tinydocs site and make it primary.
   - Forward `tinydocs.cc` and `docs.mr.industries`.
   - Add a redirect for every printed short URL that doesn't exist, such as `/get-started`.

Forwarding rules in `netlify.toml`. Domain rules go above the site's other redirects, and `force` makes them apply even when a file exists at that path:

```toml
# tinyStudio site
[[redirects]]
  from = "https://app.tinystudio.cc/*"
  to = "https://studio.tinycore.cc/:splat"
  status = 301
  force = true

# tinydocs site (repeat for https://docs.mr.industries/*)
[[redirects]]
  from = "https://tinydocs.cc/*"
  to = "https://docs.tinycore.cc/:splat"
  status = 301
  force = true

# tinydocs site: tinystudio.cc shows the landing page at its root, loads the
# page's own files, and forwards every other path to the app
[[redirects]]
  from = "https://tinystudio.cc/"
  to = "/tinystudio/"
  status = 200
  force = true

[[redirects]]
  from = "https://tinystudio.cc/_astro/*"
  to = "/_astro/:splat"
  status = 200
  force = true

[[redirects]]
  from = "https://tinystudio.cc/*"
  to = "https://studio.tinycore.cc/:splat"
  status = 301
  force = true
```

The live rules, including `favicon.png` and the `/get-started` short URL, are in tinydocs-cc's `netlify.toml`.

## GitHub OAuth apps

There are two apps, and they are never shared.

**tinyCore sign-in (exists).**

- It lives inside Supabase, for tinycore.cc.
- Its callback is Supabase's: `https://<project-ref>.supabase.co/auth/v1/callback`.
- It asks only for `user:email`.
- Leave it as it is.

**tinyStudio (create now).** Repo access for Make it mine and Push, on desktop and web.

| Field                  | Value                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Owner                  | Mister-Industries organization: Settings → Developer settings → OAuth Apps                                             |
| Application name       | `tinyStudio`                                                                                                           |
| Homepage URL           | `https://tinystudio.cc`                                                                                                |
| Callback URLs          | See the next table                                                                                                     |
| Enable Device Flow     | On; the desktop app signs in this way                                                                                  |
| Scope the app requests | `public_repo`                                                                                                          |
| Client ID              | Public. It's the default in `src/main/githubAuth.ts` and `electron.vite.config.ts`                                     |
| Client secret          | Only in the tinyStudio Netlify site's environment, as `GITHUB_CLIENT_SECRET`. Never in the repo, the built app or chat |

GitHub allows up to 10 callback URLs per app. Matching subdomains is a wildcard setting you turn on per URL.

| Callback URL                                         | Wildcard | Used by                                                              |
| ---------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| `https://studio.tinycore.cc/auth/github/callback`    | Off      | Production                                                           |
| `https://app.tinystudio.cc/auth/github/callback`     | Off      | Until that domain forwards; remove after                             |
| `https://preview.tinystudio.cc/auth/github/callback` | On       | Deploy previews at `deploy-preview-N.preview.tinystudio.cc`          |
| `http://localhost:5173/auth/github/callback`         | Off      | Local development                                                    |
| `http://localhost:5174/auth/github/callback`         | Off      | Local development when port 5173 is taken, as on the owner's machine |

Why the settings are these:

- **The path is `/auth/github/callback`, not `/auth/callback`.** tinyCore sign-in uses `/auth/callback` on every tinycore.cc site, so the two must not collide. `docs/github-auth.md` still says `/auth/callback`.
- **The 5174 entry may be unnecessary.** GitHub lets a loopback redirect use any port, though it recommends `127.0.0.1` over `localhost`. If sign-in works on a second localhost port without it, drop that entry.
- **The apps are separate so no site can silently take repo access.**
  - GitHub skips the approval screen for scopes someone has already granted. With one shared app, any script on any tinycore.cc site could get a repo-write token without the person seeing a prompt.
  - Separate apps also keep the secret in one place.
  - They keep GitHub's token limits apart too. The limit is 10 tokens per user, app and scope, and GitHub silently revokes the oldest one.
- **The web flow still needs a Netlify function.** GitHub requires the client secret to exchange the code for a token, even when PKCE (S256) is used.
- **Deploy previews get their own address.**
  - Where: the tinyStudio Netlify site → Domain management → Automatic deploy subdomains → Deploy Previews.
  - Settings: domain `tinystudio.cc`, subdomain `preview`.
  - This needs Netlify DNS, which `tinystudio.cc` has.

## Change now (0.4.0)

### Owner

1. Create the tinyStudio GitHub OAuth app with the settings above, and send the client ID.
2. Put the client secret in the tinyStudio Netlify site's environment as `GITHUB_CLIENT_SECRET`.
3. Add `studio.tinycore.cc` to the tinyStudio Netlify site as a domain alias.
4. Turn on automatic deploy subdomains for Deploy Previews: domain `tinystudio.cc`, subdomain `preview`.
5. When 0.4.0 ships: make `studio.tinycore.cc` the primary domain and forward `app.tinystudio.cc`.

### Step 6: changes to the release plan

- **Origins the Netlify function accepts** (`netlify/functions/github-token.ts`):

  - `https://studio.tinycore.cc`
  - `https://app.tinystudio.cc`, until it forwards
  - `https://deploy-preview-<n>.preview.tinystudio.cc`
  - `http://localhost:5173` and `http://localhost:5174`

  This replaces "only `https://app.tinystudio.cc` and `http://localhost:5173`".

- **Redirect URI.** Build `redirect_uri` from `window.location.origin` plus `/auth/github/callback`, so every host returns to itself.
- **Local development.** An OAuth app allows up to 10 callback URLs, so no second app is needed. This replaces the bullet saying an app has one callback URL.
- **Done when** `studio.tinycore.cc` and a deploy preview at `deploy-preview-N.preview.tinystudio.cc` both sign in without a pasted token.
- **Docs to update:**
  - `docs/github-auth.md`: callback path, domains, where the secret lives
  - `docs/web-deploy.md`
  - the checklist in `docs/packaging-windows.md`
  - the README

### Domain references

Change `app.tinystudio.cc` to `studio.tinycore.cc` in:

- the header comment in `netlify.toml`
- the header comment in `src/renderer/src/lib/projectRouting.ts`
- `src/shared/agentGuides/tinystudio.md`, which is what Studio AI tells users
- `docs/github-auth.md`, `INTEGRATION_GUIDE.md` and `docs/release-plan.md`

Leave links to `https://tinystudio.cc` alone: the Visual export credit and the link tests. That address becomes the landing page.

### After tinyservice 1.2.0 is on npm

The change is on tinyService branch `release/1.2.0`, commits `c198db4` and `212d1bb`. Its default allowed origins already include `https://studio.tinycore.cc` and `https://app.tinystudio.cc`.

Already done on `v0.4-dev` (2026-09-14):

- **Port check.** It opens the port on both `127.0.0.1` and all interfaces (`src/main/freePort.ts`).
  - This matters because the owner's tray app runs 1.2.0 on `127.0.0.1:3000`.
  - On Windows, a check on all interfaces alone passes while the tray holds that port.
- **Allowed origins.** `allowedOrigins` in `src/main/index.ts` is `['file://', 'http://localhost:*', 'https://studio.tinycore.cc', 'https://app.tinystudio.cc']`.
- **Known issue.** The tinyService Known issue is gone from `README.md` and `CHANGELOG.md`.
- **Temporary dependency.** Until 1.2.0 is published, it is `file:local-packages/mister-industries-tinyservice-1.2.0.tgz`, packed from `release/1.2.0`.
  - The lockfile resolves it from that file, so `npm install`, `npm ci` and Netlify work without the registry.
  - To repack after tinyService changes, run `npm pack --pack-destination <tinyStudio>/local-packages` in `packages/service`, then run `npm install ./local-packages/<file>.tgz` here.

Once 1.2.0 is on npm:

1. Set `@mister-industries/tinyservice` back to `^1.2.0`.
2. Delete `local-packages/`.
3. Run `npm install`.

Deploy previews aren't in tinyService's default list, so compile and upload can't reach a local tinyService from a preview. Test those on `studio.tinycore.cc` or localhost.

### Not yet

tinyCore sign-in, the Share menu, courses, profiles and Canvas LTI are all later work, described below.

## Later: tinyCore sign-in on studio and docs

### Docs: built

On the tinydocs-cc branch `tinystudio-landing` (2026-09-14):

- **Browser only.** The docs site stays static.
  - `src/lib/supabase.ts` creates the browser client.
  - `src/components/AccountButton.tsx`, in the header, shows Sign In (GitHub or Google) or the signed-in account.
- **Cookie domain by host.** On `*.tinycore.cc` the session cookie goes on `.tinycore.cc`, so docs and tinycore.cc share one sign-in. On any other host, such as localhost or tinydocs.cc, it stays on that host.
- **Callback.** `/auth/callback` is a static page.
  - The browser client exchanges the `?code=` itself (PKCE).
  - Then the page returns to where sign-in started, which was saved in `sessionStorage`. That keeps the redirect URL exactly the one on Supabase's allow list.
- **Settings.**
  - Netlify environment: `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY`, the same values tinycore-cc uses. Without them the header keeps its old link to the store.
  - Supabase redirect URLs: `https://docs.tinycore.cc/auth/callback` and `http://localhost:4321/auth/callback`.
- **To fix in tinycore-cc.** `src/lib/supabase/client.ts`, the browser client, sets no cookie domain. The server and middleware clients do.
  - So when the browser refreshes the token or signs out on tinycore.cc, it writes or clears a host-only cookie, and signing out there may leave docs signed in.
  - The fix: pass `cookieOptions: { domain: process.env.NEXT_PUBLIC_COOKIE_DOMAIN }` to `createBrowserClient`.

### Studio, and what both follow

- **Same Supabase project.** Use the one in tinycore-cc, with the same URL and public anon key.
  - Put the session cookie on `.tinycore.cc`, the way `tinycore-cc/src/lib/supabase/server.ts` does.
  - Every table needs Row Level Security, because the anon key is public.
- **Supabase settings.** In Authentication → URL Configuration, add:

  - `https://studio.tinycore.cc/auth/callback`
  - `https://docs.tinycore.cc/auth/callback`
  - the localhost equivalents

  Leave Site URL unchanged.

- **Content Security Policy.** Add `https://<project-ref>.supabase.co` to `connect-src` in `src/renderer/index.html`.
- **The same sign-in buttons everywhere.** Someone who signs in with GitHub in one place and Google in another, with different emails, ends up with two accounts.
- **Connect GitHub stays a separate step,** using tinyStudio's own app. Ask for it the first time someone uses Make it mine or Push.
- **Desktop app.** It signs in through the browser and comes back through a `tinystudio://` link.

## Later: the Share button

1. **Publish to GitHub.**
   - The existing Make it mine and Push, then copy the repo link.
   - The link works for a portfolio, or for a Canvas assignment set to "Website URL".
2. **Send to Canvas.**
   - What it does:
     - zip the project and download it
     - open the Canvas assignment in a new tab, if the project link carries `?canvas=<assignment URL>`
     - the student uploads the zip
   - It works at every school with no setup.
   - It needs a zip writer (tinyStudio only reads zips today, in `circuit/parts/zip.ts`) and an Open .zip import for teachers.
   - Build it together with "Archive (export as .zip)", 1.0 beta step 7.
3. **Publish to tinyDocs.** Needs tinyCore sign-in. It adds the project to the person's profile (see profiles below).
4. **Canvas LTI 1.3.** Build this when a school wants to pilot it.
   - What students see:
     - a tinyStudio tab on Canvas's Submit Assignment page
     - an Open in tinyStudio button on the assignment
   - How it works:
     - The tab uses the `homework_submission` placement.
     - tinyStudio returns the zip to Canvas as a file item, through LTI deep linking.
   - What it needs:
     - each school's Canvas admin approves tinyStudio once
     - Netlify functions for the LTI handshake
     - a few minutes of hosting for the zip, which Canvas downloads
   - Other learning management systems use the Send to Canvas download and upload.

**Skip:** having tinyStudio submit straight into Canvas's API. It still needs approval from every school, plus Canvas sign-in inside tinyStudio, which is more access than LTI asks for.

## Later: courses on tinyDocs

How it works:

1. **Teacher.**
   - A teacher account is approved by an admin, the way student verification works today.
   - The teacher creates a course on docs.tinycore.cc.
   - Each assignment gets a title, a due date, a starter project link and, optionally, a Canvas assignment URL.
   - The teacher shares a join link.
2. **Student: joining and opening work.**
   - Open the join link and sign in.
   - Go to My courses. Assignments are sorted by due date.
   - Choose Open in tinyStudio, which opens `studio.tinycore.cc/<owner>/<repo>/<path>?canvas=…`.
3. **Student: turning it in.** Save the project to the computer, work on it, and submit with Send to Canvas. The teacher grades in Canvas.

Data, in the tinycore-cc Supabase project. The table names are a starting point:

| Table               | Holds                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `profiles` (exists) | Add `teacher_verified` next to `student_verified`                                                             |
| `courses`           | Owner, title, slug, description, join code, Canvas course URL                                                 |
| `course_members`    | Course, user, role (`teacher`, `ta`, `student`)                                                               |
| `assignments`       | Course, title, instructions, due date (`timestamptz`), starter project link, Canvas assignment URL, published |

- **Not stored:** grades, submissions and student files.
- **Rosters are still school records.** Collect only name and email, and let a teacher delete a course's data.
- **Access rules:**
  - teachers of a course manage it
  - members can read it
  - students see only their own membership
- **Later:** import rosters and due dates from Canvas over LTI.

## Later: profiles and user projects

- **A project entry is metadata only.** Fields:

  - owner, title, description and cover image
  - GitHub repo and path
  - visibility (`private`, `unlisted` or `public`)
  - tags and a featured flag

  The files stay in the person's public GitHub repo, so hosting costs stay near zero.

- **Profile pages.** A profile on docs.tinycore.cc lists the person's projects. Public projects can be curated into the User Projects tab, like Instructables. Public listing needs moderation first.
- **Check repo ownership.** Before listing a project, confirm its repo belongs to the person's connected GitHub account.
- **Live previews.** Visual previews in the gallery run from GitHub Pages or another domain outside `tinycore.cc`, in a sandboxed iframe. They never run on a tinycore.cc page.

## Storage and cost

- **Project size.** Measured 2026-09-14: the 70 projects in tinyStudio-examples average 11 KB; the largest is 52 KB. Compiled `firmware.bin` files are about 1.5 MB each, so build output is never stored.
- **Supabase plans.**

  - Free: 1 GB of storage and 5 GB of egress; a project pauses after a week with no activity.
  - Pro: $25 a month, with 100 GB of storage.

  The plans above store only small records, not files.

## Open questions for the owner

- Which Supabase plan is tinycore.cc on?
- Which short URLs are printed on QR codes or packaging? `tinydocs.cc/get-started` returns 404 today.
- Who moderates public projects, and what's the minimum age for an account?
- `studio.tinycore.cc` was chosen over `app.tinycore.cc`. If that changes, update tinyService's default allowed origins and the callback URLs.
