import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

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
  assert.equal(capturedFactory.id, '@dsh/git-gui')
  assert.equal(typeof capturedFactory.factory, 'function')
})

test('factory materializes a cordis object plugin face', () => {
  const exports = capturedFactory.factory((spec) => require(spec))
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(exports.inject, ['connection', 'slots'])
})

test('apply registers the footer entry and the overlay panel', () => {
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
  assert.deepEqual(injected, ['sidebar.footer.action', 'shell.overlay'])
  const footer = registrations.find((r) => r.name === 'sidebar.footer.action')
  const panel = registrations.find((r) => r.name === 'shell.overlay')
  assert.equal(footer.id, 'dsh-git-gui')
  assert.equal(panel.id, 'dsh-git-gui')
  assert.equal(typeof footer.component, 'undefined') // options-only object; component is the 2nd arg of register
})

test('footer entry renders (SSR smoke) with a badge when files changed', () => {
  const React = require('react')
  const { renderToString } = require('react-dom/server')
  const exports = capturedFactory.factory((spec) => require(spec))

  // capture the component passed as the second register() argument
  let footerComponent = null
  const mockCtx = {
    connection: { rpc: { call: async () => ({ ok: true, value: { ok: true } }) } },
    slots: {
      inject(name, callback) {
        if (name === 'sidebar.footer.action') callback()
        else callback()
        return () => {}
      },
      register(options, component) {
        if (options.name === 'sidebar.footer.action') footerComponent = component
        return () => {}
      },
    },
    effect(fn) {
      fn()
    },
  }
  exports.apply(mockCtx)
  assert.equal(typeof footerComponent, 'function')

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
    wide: true,
    useSessions: (selector) => selector(sessions),
    useWorkspaces: () => ({}),
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

  const html = renderToString(React.createElement(footerComponent, props))
  assert.match(html, /Git/)
  assert.match(html, /gg-badge/)
  assert.match(html, />2</)
})
