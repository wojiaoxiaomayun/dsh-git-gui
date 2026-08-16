import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ActivityTracker } from '../lib/activity.js'

function fakeCtx() {
  const listeners = new Map()
  return {
    on(name, fn, options) {
      const key = `${String(name)}:${JSON.stringify(options ?? null)}`
      listeners.set(key, fn)
      return () => listeners.delete(key)
    },
    emit(name, ...args) {
      for (const [key, fn] of listeners) {
        if (key.startsWith(`${String(name)}:`)) fn(...args)
      }
    },
  }
}

test('records successful write/edit calls with turn and session', () => {
  const ctx = fakeCtx()
  const tracker = new ActivityTracker(ctx)
  const session = { id: 'session-1', header: { cwd: 'C:\\work' } }

  ctx.emit('session/event', session, {
    type: 'tool/call', turn: 3, callId: 'c1', name: 'write',
    arguments: JSON.stringify({ file_path: 'src/a.txt', content: 'x' }),
  })
  ctx.emit('session/event', session, {
    type: 'tool/result', turn: 3, callId: 'c1', message: 'ok',
  })
  const entries = tracker.list('C:\\work')
  assert.equal(entries.length, 1)
  assert.equal(entries[0].tool, 'write')
  assert.equal(entries[0].turn, 3)
  assert.equal(entries[0].sessionId, 'session-1')
  assert.equal(entries[0].path.toLowerCase(), 'c:\\work\\src\\a.txt')
})

test('ignores failed tool results and non-fs tools', () => {
  const ctx = fakeCtx()
  const tracker = new ActivityTracker(ctx)
  const session = { id: 's2', header: { cwd: '/repo' } }

  ctx.emit('session/event', session, {
    type: 'tool/call', turn: 1, callId: 'c2', name: 'edit',
    arguments: JSON.stringify({ file_path: 'a.txt', old_string: 'a', new_string: 'b' }),
  })
  ctx.emit('session/event', session, {
    type: 'tool/result', turn: 1, callId: 'c2', message: 'stale', error: { name: 'FS_STALE_VERSION', code: 'x' },
  })
  ctx.emit('session/event', session, {
    type: 'tool/call', turn: 1, callId: 'c3', name: 'bash',
    arguments: JSON.stringify({ command: 'rm -rf x' }),
  })
  ctx.emit('session/event', session, {
    type: 'tool/result', turn: 1, callId: 'c3', message: 'ok',
  })
  assert.equal(tracker.list('/repo').length, 0)
})

test('tolerates malformed arguments JSON', () => {
  const ctx = fakeCtx()
  const tracker = new ActivityTracker(ctx)
  ctx.emit('session/event', { id: 's3', header: { cwd: '/r' } }, {
    type: 'tool/call', turn: 2, callId: 'c4', name: 'write', arguments: 'not json',
  })
  assert.equal(tracker.list('/r').length, 0)
})

test('caps per-workspace history', () => {
  const ctx = fakeCtx()
  const tracker = new ActivityTracker(ctx)
  const session = { id: 's4', header: { cwd: '/repo' } }
  for (let i = 0; i < 220; i++) {
    ctx.emit('session/event', session, {
      type: 'tool/call', turn: i, callId: `c${i}`, name: 'write',
      arguments: JSON.stringify({ file_path: `f${i}.txt` }),
    })
    ctx.emit('session/event', session, { type: 'tool/result', turn: i, callId: `c${i}`, message: 'ok' })
  }
  const entries = tracker.list('/repo', 200)
  assert.equal(entries.length, 200)
  // newest first
  assert.match(entries[0].path, /f219\.txt$/)
})
