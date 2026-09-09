import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// Shim the browser module-system handshake the web shell performs.
let capturedFactory = null
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      capturedFactory = entry
    },
  },
}

// The bundle executes the load() call at require time.
require('../lib/client.js')

test('bundle registers itself under the package id', () => {
  assert.ok(capturedFactory !== null)
  const pkgName = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'package.json'), 'utf8')).name
  assert.equal(capturedFactory.id, pkgName)
  assert.equal(typeof capturedFactory.factory, 'function')
})

test('factory materializes a cordis object plugin face', () => {
  const exports = capturedFactory.factory((spec) => require(spec))
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(exports.inject, ['connection', 'slots'])
})

test('apply registers the header entry and the overlay panel', () => {
  const exports = capturedFactory.factory((spec) => require(spec))
  const registrations = []
  const injected = []
  const mockCtx = {
    connection: { rpc: { call: async () => ({ ok: true, value: { ok: true } }) } },
    slots: {
      inject(name, callback) {
        injected.push(name)
        const disposer = callback()
        return () => disposer()
      },
      register(options) {
        registrations.push(options)
        return () => {}
      },
    },
    effect(fn) {
      const disposer = fn()
      return disposer
    },
  }
  exports.apply(mockCtx)
  assert.deepEqual(injected, ['conversation.session.header.utilities', 'shell.overlay'])
  const header = registrations.find((r) => r.name === 'conversation.session.header.utilities')
  const panel = registrations.find((r) => r.name === 'shell.overlay' && r.id === 'dsh-git-gui')
  const hero = registrations.find((r) => r.name === 'shell.overlay' && r.id === 'dsh-git-gui-hero')
  assert.equal(header.id, 'dsh-git-gui')
  assert.equal(panel.id, 'dsh-git-gui')
  assert.equal(hero.id, 'dsh-git-gui-hero')
  assert.equal(hero.order, 90)
  assert.equal(typeof header.component, 'undefined') // options-only object; component is the 2nd arg of register
})

test('header entry renders (SSR smoke) with a badge when files changed', () => {
  const React = require('react')
  const { renderToString } = require('react-dom/server')
  const exports = capturedFactory.factory((spec) => require(spec))

  // capture the component passed as the second register() argument
  let headerComponent = null
  const mockCtx = {
    connection: { rpc: { call: async () => ({ ok: true, value: { ok: true } }) } },
    slots: {
      inject(name, callback) {
        callback()
        return () => {}
      },
      register(options, component) {
        if (options.name === 'conversation.session.header.utilities') headerComponent = component
        return () => {}
      },
    },
    effect(fn) {
      fn()
    },
  }
  exports.apply(mockCtx)
  assert.equal(typeof headerComponent, 'function')

  // session hook that yields a session whose workspace has 2 changed files
  const sessions = {
    current: 'sess-1',
    byId: {
      'sess-1': {
        id: 'sess-1', cwd: 'C:\\repo', running: false, blank: false, displayTitle: 't', updatedAt: 0,
      },
    },
  }
  const props = {
    sessionId: 'sess-1',
    useSessions: (selector) => selector(sessions),
  }

  // seed the store with a status snapshot carrying 2 changed files;
  // cwd/sessionId must match the mocked session, otherwise syncSession resets
  exports.__test.setState({
    cwd: 'C:\\repo',
    sessionId: 'sess-1',
    check: { repo: true, root: 'C:\\repo', gitVersion: 'git version 2.43.0' },
    status: {
      branch: { head: 'main' },
      files: [{ x: 'M', y: '.', sub: 'N...', path: 'a.txt' }, { x: '?', y: '?', sub: '', path: 'b.txt' }],
    },
    statusError: null,
  })

  const html = renderToString(React.createElement(headerComponent, props))
  assert.match(html, /gg-header-btn/)
  assert.match(html, /gg-badge/)
  assert.match(html, />2</)
})

test('hero twin mounts GitButton as a component (h(GitButton)), not a direct call', () => {
  // The hero FAB previously rendered `GitButton()` inside HeroGitButton. A
  // direct call counts GitButton's hooks (useStore → useRef) against
  // HeroGitButton, and because pos starts null and only later becomes
  // non-null, the hook count flips between renders → React error #310, which
  // crashed the whole shell.overlay slot in the hero. The fix mounts it via
  // h(GitButton) so the hooks live in GitButton's own instance.
  const bundle = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8')
  // HeroGitButton returns h('div', {className: 'gg-hero-fab', ...}, h(GitButton))
  assert.match(bundle, /gg-hero-fab'[\s\S]*?h\(GitButton\)/)
  // And never a bare GitButton() call inside the hero return
  assert.doesNotMatch(bundle, /gg-hero-fab'[\s\S]*?GitButton\(\)/)
})
