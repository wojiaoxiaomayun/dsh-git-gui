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

test('apply registers the header entry, the overlay panel, and the hero.flex entry', () => {
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
  assert.deepEqual(injected, ['conversation.session.header.utilities', 'shell.overlay', 'hero.flex'])
  const header = registrations.find((r) => r.name === 'conversation.session.header.utilities')
  const panel = registrations.find((r) => r.name === 'shell.overlay')
  const hero = registrations.find((r) => r.name === 'hero.flex')
  assert.equal(header.id, 'dsh-git-gui')
  assert.equal(panel.id, 'dsh-git-gui')
  assert.equal(hero.id, 'dsh-git-gui')
  assert.equal(hero.order, 20)
  // The hero entry rides the hero-flex plugin's slot only — the plugin no
  // longer occupies the corner seat nor floats a shell.overlay fallback.
  assert.equal(registrations.some((r) => r.name === 'conversation.session.header.corner'), false)
  assert.equal(registrations.some((r) => r.name === 'shell.overlay' && r.id === 'dsh-git-gui-hero'), false)
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
  // (DSH 0.1.6-alpha.2 list snapshot: no `current` field — the plugin must
  // derive the active session from `sessionId` / `ids` / `retainedBy.mainView`)
  const sessions = {
    ids: ['sess-1'],
    byId: {
      'sess-1': {
        id: 'sess-1', cwd: 'C:\\repo', running: false, blank: false, displayTitle: 't', updatedAt: 0,
        retainedBy: { mainView: 1 },
      },
    },
    phase: 'ready',
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

test('hero entry mounts GitButton as a component (h(GitButton)), not a direct call', () => {
  // The hero FAB previously rendered `GitButton()` inside HeroGitButton. A
  // direct call counts GitButton's hooks (useStore → useRef) against the
  // parent, and the hook count flipped between renders → React error #310,
  // which crashed the whole slot in the hero. The fix mounts it via
  // h(GitButton) so the hooks live in GitButton's own instance.
  const bundle = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8')
  // HeroFlexEntry returns h('span', {className: 'gg-hero-flex', ...}, h(GitButton))
  assert.match(bundle, /gg-hero-flex'[\s\S]*?h\(GitButton\)/)
  // And never a bare GitButton() call inside the hero return
  assert.doesNotMatch(bundle, /gg-hero-flex'[\s\S]*?GitButton\(\)/)
  // No corner-seat or floating-fab machinery remains: the hero rides the
  // hero-flex plugin's slot only.
  assert.doesNotMatch(bundle, /data-conversation-header-corner/)
  assert.doesNotMatch(bundle, /gg-hero-fab/)
})

test('hero.flex entry renders the Git button (SSR smoke)', () => {
  const React = require('react')
  const { renderToString } = require('react-dom/server')
  const exports = capturedFactory.factory((spec) => require(spec))

  let heroComponent = null
  const mockCtx = {
    connection: { rpc: { call: async () => ({ ok: true, value: { ok: true } }) } },
    slots: {
      inject(name, callback) {
        callback()
        return () => {}
      },
      register(options, component) {
        if (options.name === 'hero.flex') heroComponent = component
        return () => {}
      },
    },
    effect(fn) {
      fn()
    },
  }
  exports.apply(mockCtx)
  assert.equal(typeof heroComponent, 'function')

  const sessions = {
    ids: ['sess-1'],
    byId: {
      'sess-1': {
        id: 'sess-1', cwd: 'C:\\repo', running: false, blank: false,
        displayTitle: 't', updatedAt: 0, retainedBy: { mainView: 1 },
      },
    },
    phase: 'ready',
  }
  const props = { sessionId: 'sess-1', useSessions: (selector) => selector(sessions) }
  const html = renderToString(React.createElement(heroComponent, props))
  assert.match(html, /gg-hero-flex/)
  assert.match(html, /gg-header-btn/)
})

test('applySession derives the workspace from the DSH list snapshot (no `current` field)', () => {
  const exports = capturedFactory.factory((spec) => require(spec))
  // source-level require of the bundled control module via the micro-bundler's
  // internal registry: './control.js' is the bundled id
  const control = exports.__test.control
  assert.ok(control, 'control module exposed for tests')

  // fresh store, no seeded workspace
  exports.__test.setState({ cwd: null, sessionId: null, check: null })

  // DSH 0.1.6-alpha.2 snapshot: `current` is gone; the active session is the
  // first `ids` row retained by the main view.
  control.applySession({
    ids: ['sess-2'],
    byId: {
      'sess-2': {
        id: 'sess-2', cwd: 'C:\\repo', running: false, blank: false,
        displayTitle: 't', updatedAt: 0, retainedBy: { mainView: 1 },
      },
    },
    phase: 'ready',
  })

  const state = exports.__test.getState()
  assert.equal(state.cwd, 'C:\\repo')
  assert.equal(state.sessionId, 'sess-2')
  // check stays null until the async refreshCheck settles; only the cwd
  // binding matters for the "stuck at detecting" regression
})
