# Syncing with GitHub

How a project stays linked to a GitHub repo, and what Push and Pull do. Sign-in
is in [github-auth.md](github-auth.md).

## The link

A project linked to a repo has a record in browser storage, under
`tinystudio.github.link.<project path>` (`RepoLink` in `lib/github.ts`):

| Field     | Holds                                                                  |
| --------- | ---------------------------------------------------------------------- |
| `remote`  | `owner/name`                                                           |
| `branch`  | the branch Push and Pull use                                           |
| `path`    | the folder inside the repo the project maps onto; `''` is the repo root |
| `base`    | every text file's content at the last sync, by project-relative path   |
| `baseSha` | GitHub's blob id for each of those files                               |
| `commit`  | the commit the last sync matched                                       |
| `clone`   | set when the link came from the folder's `.git`: the commit checked out then |

A project gets a link when:

- a repo you can push to is opened in the browser
- **Make it mine** or **Publish** copies a project into a new repo
- **Link & pull** in the GitHub tab points it at a repo
- a folder that is a git clone of a GitHub repo is opened (see Clones)

## Changes

The changes are the project's text files compared with `base`: edited, added,
and deleted. `lib/repoSync.ts` keeps one shared copy of them for the GitHub tab
and the push reminder above the editor. It recomputes shortly after any write
through `lib/fileSystem.ts`, which fires `FILES_CHANGED_EVENT`, and when the
project or the signed-in account changes. Unsaved editor buffers don't count.

## Push

Push makes one commit through GitHub's Git Data API (`lib/githubSync.ts`):

1. Read the branch's head commit and the file list at that commit.
2. For each changed or deleted file, compare GitHub's blob id with the one from
   the last sync. If GitHub's differs from both that and ours, someone changed
   the file on GitHub since: Push stops, writes nothing, and names the files.
3. Create a tree on the head's tree with the changed files' content and
   `sha: null` for deletions, a commit with the message (or a default such as
   "Update blink.ino"), and move the branch with `force: false`. If the branch
   moved in the meantime, Push asks you to push again.
4. Save the link with the pushed files as the new baseline.

## Pull

Pull reads the branch's head and decides each file (`pullDecision`):

| This project        | GitHub              | Pull                                    |
| ------------------- | ------------------- | --------------------------------------- |
| unchanged           | changed             | writes GitHub's version                 |
| changed             | unchanged           | keeps yours                             |
| changed             | changed differently | keeps yours and says so; Push then replaces GitHub's |
| unchanged           | deleted             | deletes the file                        |

The first sync of a new link writes GitHub's version of every file.

## Clones

When a folder opens, `commands/cloneLink.ts` reads `.git/config` for a GitHub
remote (`origin` first), `.git/HEAD` for the branch, and the branch's commit from
`refs/heads` or `packed-refs` (`lib/gitClone.ts`). It links the folder with that
commit's files as the baseline, so changes match what `git status` would show.

- A link made by hand is never replaced.
- The link is kept while the clone's checked-out commit stays the same, so
  commits pushed from tinyStudio stay in the baseline. When the checked-out
  commit changes (after `git pull` in a terminal, say), the baseline moves to it.
- Commits pushed from tinyStudio go through the GitHub API, so the folder's own
  `.git` doesn't have them until you run `git pull`. Because the files already
  match, that pull has nothing to merge.
- Not recognised: a folder inside a clone (the browser can't see its parent), a
  worktree or submodule, a detached HEAD, a branch with no commits, a remote not
  on github.com, and a commit that isn't on GitHub.

## Limits

Text files only, up to 1 MB each and 300 per project. The baseline is kept in
browser storage, so a very large project can hit its quota; saving the link then
fails with a message.

Real git in the folder, where tinyStudio's commits land in `.git` and a repo can
be cloned from the browser, is planned for the 1.0 beta (see the release plan).
