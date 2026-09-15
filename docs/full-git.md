# Full git in project folders

A plan for the 1.0 beta (item 12 in [release-plan.md](release-plan.md)), written to
be picked up by another session. What tinyStudio does today is in
[github-sync.md](github-sync.md): it reads `.git` to link a clone, keeps a
baseline of file contents in browser storage, and pushes through GitHub's REST
API. The folder's own `.git` never sees those commits.

The goal: a project folder is a real git clone. tinyStudio commits into its
`.git`, pushes and pulls over git, and terminal git and VS Code see exactly
what tinyStudio did.

## What people get

- **Clone to this computer.** Opening a GitHub repo in Chrome, Edge or the
  desktop app offers to clone it into a folder. The first Save of a repo
  project offers the same, instead of the generic Save to computer.
- **Status from git.** The GitHub tab lists modified, added, deleted and
  untracked files, the way `git status` does, and respects `.gitignore`.
- **Commit, Push and Pull over git.** One Commit & Push button for the common
  case. Pull merges; conflicts are written into the files with markers and
  listed until they're committed.
- **Folders you cloned yourself** behave the same, including branch name.
- **Firefox and Safari** can't open folders. Repos there clone into browser
  storage (IndexedDB) and are still real git repos.

Not in the beta: history view, stash, rebase, creating branches, Git LFS,
submodules, SSH remotes, and private repos (sign-in asks for `public_repo`).

## How it's built

One engine for both builds: [isomorphic-git](https://isomorphic-git.org), a
JavaScript git (1.42.2 at the time of writing, about 70 KB gzipped). No system
git, so nothing to install and one code path to test.

| Where                        | File access                                   | Network                                    |
| ---------------------------- | --------------------------------------------- | ------------------------------------------ |
| Desktop                      | Node `fs` in the main process                 | `isomorphic-git/http/node`, no proxy       |
| Browser, folder picked       | an `fs` adapter over the File System Access API, in a Web Worker | `isomorphic-git/http/web` through the proxy |
| Browser, no folder (Firefox, Safari) | LightningFS (IndexedDB)               | `isomorphic-git/http/web` through the proxy |

- **A `GitService` interface in the renderer:** clone, status, add, remove,
  commit, push, pull, current branch. Desktop implements it over IPC to the
  main process, next to `window.api.fs`, and keeps the folder-access checks in
  `src/main/folderAccess.ts`. The browser implements it with a worker.
- **The File System Access adapter** provides what isomorphic-git needs:
  `readFile`, `writeFile`, `unlink`, `readdir`, `mkdir`, `rmdir`, `stat` and
  `lstat` (size, modified time, file or directory; no symlinks). It must write,
  not just read: working out status rewrites `.git/index`. Directory handles
  can be passed to a worker, which keeps hashing and checkout off the UI thread.
- **Auth:** isomorphic-git's `onAuth` returns the signed-in token. GitHub accepts
  a token as the username for git over HTTPS.
- **Shallow clones** (`depth: 1`, `singleBranch: true`) keep the first clone
  small and fast. A pull that needs older history deepens the clone.

### The CORS proxy

GitHub's git endpoints send no CORS headers, so a browser can't talk to them
directly. Desktop doesn't need this.

- A small first-party proxy: a Netlify Function at
  `/.netlify/functions/git-proxy`, modelled on
  [@isomorphic-git/cors-proxy](https://github.com/isomorphic-git/cors-proxy).
- It forwards only git smart-HTTP requests to `github.com`: `info/refs` with
  `service=git-upload-pack` or `git-receive-pack`, and POSTs to
  `git-upload-pack` and `git-receive-pack`. Everything else gets 403.
- It accepts only tinyStudio's origins, the same list as
  `netlify/functions/github-token.ts`.
- **It carries people's GitHub tokens.** No logging of headers or bodies.
  Never point real users at the public `cors.isomorphic-git.org`.
- Netlify limits: 6 MB for a buffered response, 20 MB and 60 seconds for a
  streamed one. Stream. Shallow clones of tinyStudio-sized projects fit; if
  real repos don't, move the proxy to a Cloudflare Worker or a small Node host.

### What it replaces

- For cloned projects, the browser-storage baseline, `lib/githubSync.ts` Push
  and Pull, and `commands/cloneLink.ts` give way to `GitService`.
- Until the browser-storage path (LightningFS) lands, keep `lib/githubSync.ts`
  for projects that aren't clones, then remove it.
- **Make it mine** and **Publish** still create the repo with the REST API,
  then push the first commit over git.
- The push reminder and the GitHub tab keep their shape; their numbers come
  from git status.

## Steps

Each step ships on its own.

1. **Spike, before anything else (2–3 days).** In Chrome, with the adapter and a
   local cors-proxy: shallow-clone a small repo, change a file, check status,
   commit, push. Then open a clone made by Git for Windows and check status is
   clean. Measure clone time and bundle size. Write down what broke. Stop and
   rethink if the risks below don't clear.
2. **Desktop `GitService` (3–5 days).** isomorphic-git in the main process, IPC,
   tests against a temporary repo on disk. The GitHub tab uses it for folders
   with `.git`.
3. **The proxy function (1–2 days).** Allowlists, streaming, tests.
4. **Browser `GitService` (1–2 weeks).** The worker and the adapter, Clone to
   this computer, and the Save prompt for repo projects.
5. **The GitHub tab on git (about 1 week).** Status list, Commit & Push, Pull
   with conflicts listed, branch name.
6. **Firefox and Safari (3–5 days).** LightningFS repos in place of `mem://`
   repo projects.
7. **Clean up (2–3 days).** Remove the REST sync for cloned projects, update
   github-sync.md, the changelog and the README.

Roughly three to five weeks of focused work. The spike decides whether that
holds.

## Risks the spike must check

- **Line endings.** isomorphic-git doesn't apply git's `core.autocrlf`. Git for
  Windows enables it by default, so a clone made there has CRLF files that may
  all show as modified. Possible fixes: normalise line endings when comparing,
  or add a `.gitattributes` to tinyStudio repos. Decide from the spike.
- **Index compatibility.** Git for Windows can write index extensions (such as
  the untracked cache). Check isomorphic-git reads that index, and that git
  still accepts the index after isomorphic-git writes it.
- **Merges.** isomorphic-git merges fast-forward and three-way with diff3. It
  fails when there are several merge bases, and an incomplete merge can't be
  aborted.
- **Speed.** The File System Access API writes file by file, and hashing runs in
  JavaScript. Keep the existing project-size limits.
- **Folder permission.** Reopening a folder in the browser asks for permission
  again; git operations must wait for it, like opening recent folders does now.

## Don't

- Don't bundle system git (dugite and similar) for desktop: tens of MB, and a
  second engine to test.
- Don't send tokens through a third-party proxy.
- Don't commit or push on Ctrl+S. Saving writes files; committing is a choice.
