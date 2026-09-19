/**
 * Recognising a GitHub clone from the text files in `.git`.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  githubRepoFromUrl,
  packedRefCommit,
  parseGitHubRemote,
  parseHead,
  readClone
} from '../gitClone'

const SHA = '3fe957dda710598bdf3193f2b07bd2dc46042eb2'
const OTHER = 'ce013625030ba8dba906f756967f9e9ca394464a'

test('remote URLs in every form git writes', () => {
  const blink = { owner: 'Mister-Industries', repo: 'tinyStudio-examples' }
  for (const url of [
    'https://github.com/Mister-Industries/tinyStudio-examples.git',
    'https://github.com/Mister-Industries/tinyStudio-examples',
    'https://someone@github.com/Mister-Industries/tinyStudio-examples.git',
    'git@github.com:Mister-Industries/tinyStudio-examples.git',
    'ssh://git@github.com/Mister-Industries/tinyStudio-examples.git',
    'ssh://git@github.com:22/Mister-Industries/tinyStudio-examples'
  ]) {
    assert.deepEqual(githubRepoFromUrl(url), blink, url)
  }
  for (const url of [
    'https://gitlab.com/owner/repo.git',
    'https://github.com.evil.example/owner/repo.git',
    'git@bitbucket.org:owner/repo.git',
    'https://github.com/owner'
  ]) {
    assert.equal(githubRepoFromUrl(url), null, url)
  }
})

test('origin wins when it is on GitHub; otherwise the first GitHub remote', () => {
  const config = [
    '[core]',
    '\trepositoryformatversion = 0',
    '[remote "origin"]',
    '\turl = https://gitlab.com/me/fork.git',
    '\tfetch = +refs/heads/*:refs/remotes/origin/*',
    '[remote "upstream"]',
    '\turl = git@github.com:octo/blink.git',
    '[branch "main"]',
    '\tremote = origin'
  ].join('\r\n')
  assert.deepEqual(parseGitHubRemote(config), { owner: 'octo', repo: 'blink' })

  const withOrigin =
    '[remote "upstream"]\n url = https://github.com/a/b\n[remote "origin"]\n url = https://github.com/c/d.git\n'
  assert.deepEqual(parseGitHubRemote(withOrigin), { owner: 'c', repo: 'd' })
  assert.equal(parseGitHubRemote('[core]\n bare = false\n'), null)
})

test('HEAD names a branch or a detached commit', () => {
  assert.deepEqual(parseHead('ref: refs/heads/main\n'), { branch: 'main' })
  assert.deepEqual(parseHead('ref: refs/heads/feature/leds'), { branch: 'feature/leds' })
  assert.deepEqual(parseHead(`${SHA.toUpperCase()}\n`), { commit: SHA })
  assert.equal(parseHead('garbage'), null)
})

test('packed refs give a branch its commit', () => {
  const packed = `# pack-refs with: peeled fully-peeled sorted\n${OTHER} refs/heads/dev\n${SHA} refs/heads/main\n^${OTHER}\n`
  assert.equal(packedRefCommit(packed, 'main'), SHA)
  assert.equal(packedRefCommit(packed, 'missing'), null)
})

/** A fake `.git` at /proj; files not listed read as missing. */
const reader =
  (files: Record<string, string>) =>
  async (path: string): Promise<string | null> =>
    files[path] ?? null

const CONFIG = '[remote "origin"]\n\turl = https://github.com/octo/blink.git\n'

test('a clone reads its repo, branch and commit, loose or packed', async () => {
  assert.deepEqual(
    await readClone(
      '/proj',
      reader({
        '/proj/.git/config': CONFIG,
        '/proj/.git/HEAD': 'ref: refs/heads/main\n',
        '/proj/.git/refs/heads/main': `${SHA}\n`
      })
    ),
    { owner: 'octo', repo: 'blink', branch: 'main', head: SHA }
  )
  assert.deepEqual(
    await readClone(
      '/proj',
      reader({
        '/proj/.git/config': CONFIG,
        '/proj/.git/HEAD': 'ref: refs/heads/main\n',
        '/proj/.git/packed-refs': `${SHA} refs/heads/main\n`
      })
    ),
    { owner: 'octo', repo: 'blink', branch: 'main', head: SHA }
  )
})

test('not a usable clone: no .git, another host, detached HEAD, or no commits yet', async () => {
  assert.equal(await readClone('/proj', reader({})), null)
  assert.equal(
    await readClone(
      '/proj',
      reader({
        '/proj/.git/config': '[remote "origin"]\n url = https://gitlab.com/o/r.git\n',
        '/proj/.git/HEAD': 'ref: refs/heads/main'
      })
    ),
    null
  )
  assert.equal(
    await readClone('/proj', reader({ '/proj/.git/config': CONFIG, '/proj/.git/HEAD': SHA })),
    null
  )
  assert.equal(
    await readClone(
      '/proj',
      reader({ '/proj/.git/config': CONFIG, '/proj/.git/HEAD': 'ref: refs/heads/main' })
    ),
    null
  )
})
