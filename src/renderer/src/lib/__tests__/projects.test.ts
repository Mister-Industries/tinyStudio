/**
 * Tests for how projects are laid out on disk and how a pasted repo is read.
 *
 * The layout rule is the one the Arduino IDE enforces: a sketch's .ino must be
 * named after its folder. tinyStudio adds that every project file sits beside
 * it, so the folder a user saves is the whole project and opens in either tool.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseRepoRef } from '../github'
import { findMainIno, flattenSketchLayout, toSketchName } from '../projectLayout'

test('sketch names follow the Arduino IDE rules', () => {
  assert.equal(toSketchName('blink-alternate'), 'blink-alternate')
  assert.equal(toSketchName(' Long Distance Box '), 'Long_Distance_Box')
  assert.equal(toSketchName('2 cool!! project'), '2_cool_project')
  assert.equal(toSketchName('__hidden'), 'hidden')
  assert.equal(toSketchName('fade.ino'), 'fade')
  assert.equal(toSketchName('!!!'), 'sketch')
  assert.equal(toSketchName('x'.repeat(80)).length, 63)
})

test('an already-flat example is left alone', () => {
  const files = { 'blink-alternate.ino': 'void setup(){}', 'README.md': '# hi' }
  const layout = flattenSketchLayout(files)
  assert.equal(layout.name, 'blink-alternate')
  assert.deepEqual(layout.files, files)
  assert.deepEqual(layout.moved, {})
})

test('a sketch in its own subfolder is lifted to the top, siblings and all', () => {
  const layout = flattenSketchLayout({
    'README.md': '# Blink',
    'visual.js': 'draw()',
    'led_blink/led_blink.ino': 'void loop(){}',
    'led_blink/pins.h': '#define LED 13'
  })
  assert.equal(layout.name, 'led_blink')
  assert.deepEqual(Object.keys(layout.files).sort(), [
    'README.md',
    'led_blink.ino',
    'pins.h',
    'visual.js'
  ])
  assert.equal(layout.moved['led_blink/pins.h'], 'pins.h')
})

test('lifting never overwrites a top-level file', () => {
  const layout = flattenSketchLayout({
    'README.md': 'outer',
    'sk/README.md': 'inner',
    'sk/sk.ino': ''
  })
  assert.equal(layout.files['README.md'], 'outer')
  assert.equal(layout.files['sk/README.md'], 'inner')
  assert.equal(layout.files['sk.ino'], '')
})

test('the main .ino is renamed to match the chosen folder name', () => {
  const layout = flattenSketchLayout({ 'blink.ino': 'code', 'README.md': '' }, 'My Blink')
  assert.equal(layout.name, 'My_Blink')
  assert.equal(layout.files['My_Blink.ino'], 'code')
  assert.equal(layout.moved['blink.ino'], 'My_Blink.ino')
  assert.ok(!('blink.ino' in layout.files))
})

test('a repo-linked project keeps its paths so pushes still line up', () => {
  const files = { 'firmware/firmware.ino': '', 'README.md': '', 'app.ino': '' }
  const layout = flattenSketchLayout(files, 'my-firmware', { keepPaths: true })
  assert.equal(layout.name, 'my-firmware')
  assert.deepEqual(layout.files, files)
  assert.deepEqual(layout.moved, {})
})

test('the shallowest .ino is the main sketch', () => {
  assert.equal(findMainIno(['lib/examples/demo/demo.ino', 'app/app.ino']), 'app/app.ino')
  assert.equal(findMainIno(['README.md']), null)
})

test('repo refs parse from shorthand and from github.com links', () => {
  assert.deepEqual(parseRepoRef('Mister-Industries/tinyStudio-examples'), {
    owner: 'Mister-Industries',
    repo: 'tinyStudio-examples',
    path: ''
  })
  assert.deepEqual(parseRepoRef('octo/cat/basics/blink '), {
    owner: 'octo',
    repo: 'cat',
    path: 'basics/blink'
  })
  assert.deepEqual(parseRepoRef('https://github.com/octo/cat.git'), {
    owner: 'octo',
    repo: 'cat',
    path: '',
    branch: undefined
  })
  assert.deepEqual(parseRepoRef('https://github.com/octo/cat/tree/dev/basics/Blink%20Example'), {
    owner: 'octo',
    repo: 'cat',
    path: 'basics/Blink Example',
    branch: 'dev'
  })
  // A link to a file opens the folder that holds it.
  assert.deepEqual(parseRepoRef('github.com/octo/cat/blob/main/blink/blink.ino'), {
    owner: 'octo',
    repo: 'cat',
    path: 'blink',
    branch: 'main'
  })
  assert.equal(parseRepoRef('just-a-name'), null)
  assert.equal(parseRepoRef('https://gitlab.com/octo/cat'), null)
  assert.equal(parseRepoRef(''), null)
})
