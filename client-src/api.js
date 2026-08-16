/**
 * Browser → Host RPC wrapper for the `git/*` endpoints (Typert SRC mode).
 *
 * The host plugin binds the `git` namespace; the API gateway accepts plain
 * `{args}` payloads on the shared `/api` channel, so no generated Typert
 * artifacts are required on either side.
 */

class GitApiError extends Error {
  constructor(code, message, detail) {
    super(message)
    this.name = 'GitApiError'
    this.code = code
    this.detail = detail
  }
}

function makeGitApi(connection) {
  async function call(method, args, signal) {
    const result = await connection.rpc.call('/api', `git/${method}`, { args }, signal)
    if (!result.ok) {
      throw new GitApiError(result.error?.code ?? 'internal', result.error?.message ?? `git/${method} 调用失败`)
    }
    const value = result.value
    if (value && typeof value === 'object' && value.ok === false) {
      throw new GitApiError(value.code ?? 'GIT', value.message ?? 'Git 操作失败', value.detail)
    }
    return value
  }

  return {
    call,
    async check(cwd, signal) { return call('check', { cwd }, signal) },
    async status(cwd, signal) { return call('status', { cwd }, signal) },
    async diff(cwd, path, staged, base, untracked, signal) {
      return call('diff', { cwd, path, staged: staged === true, base: base ?? null, untracked: untracked === true }, signal)
    },
    async stage(cwd, paths, signal) { return call('stage', { cwd, paths }, signal) },
    async unstage(cwd, paths, signal) { return call('unstage', { cwd, paths }, signal) },
    async discard(cwd, paths, untracked, signal) { return call('discard', { cwd, paths, untracked: untracked === true }, signal) },
    async commit(cwd, message, signal) { return call('commit', { cwd, message }, signal) },
    async log(cwd, limit, path, signal) { return call('log', { cwd, limit, path: path ?? null }, signal) },
    async branches(cwd, signal) { return call('branches', { cwd }, signal) },
    async switchBranch(cwd, name, create, signal) { return call('switchBranch', { cwd, name, create: create === true }, signal) },
    async merge(cwd, ref, signal) { return call('merge', { cwd, ref }, signal) },
    async pull(cwd, mode, signal) { return call('pull', { cwd, mode }, signal) },
    async push(cwd, signal) { return call('push', { cwd }, signal) },
    async fetch(cwd, signal) { return call('fetch', { cwd }, signal) },
    async remoteList(cwd, signal) { return call('remoteList', { cwd }, signal) },
    async remoteAdd(cwd, name, url, signal) { return call('remoteAdd', { cwd, name, url }, signal) },
    async stash(cwd, op, message, stashId, signal) {
      return call('stash', { cwd, op, message: message ?? null, stashId: stashId ?? null }, signal)
    },
    async revert(cwd, commit, signal) { return call('revert', { cwd, commit }, signal) },
    async reset(cwd, mode, target, signal) { return call('reset', { cwd, mode, target: target ?? 'HEAD' }, signal) },
    async init(cwd, signal) { return call('init', { cwd }, signal) },
    async activity(cwd, limit, signal) { return call('activity', { cwd, limit }, signal) },
    async tree(cwd, signal) { return call('tree', { cwd }, signal) },
    async cat(cwd, path, signal) { return call('cat', { cwd, path }, signal) },
    async identity(cwd, signal) { return call('identity', { cwd }, signal) },
  }
}

module.exports = { makeGitApi, GitApiError }
