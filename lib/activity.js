/**
 * Activity tracker: attributes filesystem mutations made by the agent to
 * (session, turn, tool) tuples by listening to the session event log.
 *
 * Only the native fs tools (`write`, `edit`) carry exact paths. Shell
 * mutations (bash) cannot be attributed reliably and are intentionally left
 * out — the git status view is the ground truth for those, and the tracker
 * exists to answer "which session/turn touched which file".
 */

import path from 'node:path'

const MAX_ENTRIES = 400
const MAX_ENTRIES_PER_CWD = 200

export class ActivityTracker {
  /** @type {Map<string, Array<object>>} key = normalized cwd */
  entries = new Map()
  /** @type {Map<string, object>} pending tool/call by callId */
  pending = new Map()

  constructor(ctx) {
    this.ctx = ctx
    // `global: true` so the root-level listener also sees events emitted on
    // per-session isolate contexts (every session's tool calls).
    const dispose = ctx.on('session/event', (session, event) => this.onEvent(session, event), { global: true })
    this.dispose = dispose
  }

  onEvent(session, event) {
    if (event === null || typeof event !== 'object') return
    if (event.type === 'tool/call') {
      this.onToolCall(session, event)
    } else if (event.type === 'tool/result') {
      this.onToolResult(event)
    }
  }

  onToolCall(session, event) {
    const { name, callId, turn } = event
    if (name !== 'write' && name !== 'edit') return
    let args = null
    try {
      args = JSON.parse(event.arguments ?? '{}')
    } catch {
      return
    }
    if (args === null || typeof args !== 'object') return
    const filePath = typeof args.file_path === 'string' ? args.file_path : undefined
    if (!filePath) return
    const cwd = this.sessionCwd(session)
    this.pending.set(callId, {
      sessionId: this.sessionId(session),
      turn,
      tool: name,
      filePath,
      cwd,
      at: Date.now(),
    })
  }

  onToolResult(event) {
    const callId = event.callId
    if (callId === undefined) return
    const pending = this.pending.get(callId)
    if (pending === undefined) return
    this.pending.delete(callId)
    if (event.error !== undefined && event.error !== null) return
    const entry = {
      ...pending,
      path: this.resolvePath(pending.filePath, pending.cwd),
      error: false,
    }
    delete entry.filePath
    if (pending.cwd) {
      const key = normalizeCwd(pending.cwd)
      const list = this.entries.get(key) ?? []
      list.push(entry)
      if (list.length > MAX_ENTRIES_PER_CWD) list.splice(0, list.length - MAX_ENTRIES_PER_CWD)
      this.entries.set(key, list)
    }
    // global cap across workspaces
    let total = 0
    for (const list of this.entries.values()) total += list.length
    if (total > MAX_ENTRIES) {
      for (const [key, list] of this.entries) {
        const overflow = total - MAX_ENTRIES
        if (overflow <= 0) break
        const drop = Math.min(list.length, overflow)
        list.splice(0, drop)
        total -= drop
        if (list.length === 0) this.entries.delete(key)
      }
    }
  }

  sessionId(session) {
    return typeof session?.id === 'string' ? session.id : 'unknown'
  }

  sessionCwd(session) {
    const cwd = session?.header?.cwd
    return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
  }

  resolvePath(filePath, cwd) {
    if (cwd && !path.isAbsolute(filePath)) return path.join(cwd, filePath)
    return filePath
  }

  /**
   * Timeline entries for one workspace (most recent first).
   * @param {string} cwd
   * @param {number} limit
   * @returns {Array<object>}
   */
  list(cwd, limit = 100) {
    const list = this.entries.get(normalizeCwd(cwd)) ?? []
    const capped = Math.max(1, Math.min(Number(limit) || 100, 200))
    return [...list].reverse().slice(0, capped).map((e) => ({
      sessionId: e.sessionId,
      turn: e.turn,
      tool: e.tool,
      path: e.path,
      at: e.at,
    }))
  }

  dispose() {
    this.dispose?.()
  }
}

function normalizeCwd(cwd) {
  try {
    return path.resolve(cwd).toLowerCase()
  } catch {
    return String(cwd).toLowerCase()
  }
}
