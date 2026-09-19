import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isSafeExternalUrl } from '../externalLinks'
import { canOpenFile, OPENABLE_EXTENSIONS } from '../ipc/files'

test('only web and mail links may leave the app', () => {
  assert.equal(isSafeExternalUrl('https://tinystudio.cc/docs'), true)
  assert.equal(isSafeExternalUrl('http://localhost:5173/'), true)
  assert.equal(isSafeExternalUrl('mailto:hello@example.com'), true)
  assert.equal(isSafeExternalUrl('file:///C:/Windows/System32/cmd.exe'), false)
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false)
  assert.equal(isSafeExternalUrl('data:text/html,<script>1</script>'), false)
  assert.equal(isSafeExternalUrl('ms-settings:display'), false)
  assert.equal(isSafeExternalUrl('not a url'), false)
  assert.equal(isSafeExternalUrl(''), false)
  assert.equal(isSafeExternalUrl(null), false)
  assert.equal(isSafeExternalUrl(undefined), false)
})

test('open-path hands only documents and images to the OS', () => {
  for (const ext of OPENABLE_EXTENSIONS) assert.ok(ext.startsWith('.'), ext)
  assert.equal(canOpenFile('C:/proj/index.html'), true)
  assert.equal(canOpenFile('/home/me/proj/wiring.PNG'), true, 'extension case is ignored')
  assert.equal(canOpenFile('/tmp/notes.md'), true)
  assert.equal(canOpenFile('C:/proj/setup.exe'), false)
  assert.equal(canOpenFile('C:/proj/run.bat'), false)
  assert.equal(canOpenFile('/usr/bin/script.sh'), false)
  assert.equal(canOpenFile('/proj/Makefile'), false, 'no extension')
  assert.equal(canOpenFile('/proj/archive.html.zip'), false, 'only the last extension counts')
})
