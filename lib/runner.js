/**
 * Git process runner (zero dependencies).
 *
 * - spawns `git` with explicit argv (never a shell), `-C <cwd>` anchoring;
 * - collects stdout/stderr with a byte cap (tail kept) so a runaway diff or
 *   log cannot exhaust host memory;
 * - serializes mutating commands per workspace (git's own index.lock is the
 *   final arbiter, but the queue keeps UI state coherent);
 * - classifies common failures into stable error codes for the client.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'

export const GIT_ERROR_CODES = {
  NOT_REPO: 'NOT_REPO',
  NO_COMMITS: 'NO_COMMITS',
  LOCKED: 'LOCKED',
  UNMERGED: 'UNMERGED',
  CONFLICT: 'CONFLICT',
  HOOK_FAILED: 'HOOK_FAILED',
  IDENTITY: 'IDENTITY',
  AUTH: 'AUTH',
  NETWORK: 'NETWORK',
  NO_UPSTREAM: 'NO_UPSTREAM',
  REMOTE_EXISTS: 'REMOTE_EXISTS',
  NOT_FOUND: 'NOT_FOUND',
  CANCELLED: 'CANCELLED',
  TIMEOUT: 'TIMEOUT',
  GIT: 'GIT',
}

export class GitError extends Error {
  /**
   * @param {string} code one of GIT_ERROR_CODES
   * @param {string} message human readable
   * @param {string} [detail] raw stderr tail for diagnostics
   */
  constructor(code, message, detail) {
    super(message)
    this.name = 'GitError'
    this.code = code
    this.detail = detail
  }
}

const MAX_STREAM_BYTES = 4 * 1024 * 1024
const TRUNCATION_MARKER = '\n\u2026 [output truncated by the Git panel]'
const READ_ONLY_COMMANDS = new Set([
  'status', 'diff', 'log', 'for-each-ref', 'show', 'rev-parse', 'config',
  'remote', 'stash', 'var', 'version', 'rev-list', 'ls-files', 'branch',
])

/** Per-workspace FIFO queue for mutating commands. */
const queues = new Map()

/**
 * Run one git command.
 *
 * @param {object} ctx cordis context (unused beyond logging, kept for the seam)
 * @param {string} cwd workspace root (git resolves the real repo root itself)
 * @param {string[]} args argv after `git` (first element = git subcommand)
 * @param {object} [opts]
 * @param {boolean} [opts.mutating] serialized per workspace when true
 * @param {string} [opts.input] stdin text (e.g. commit message)
 * @param {number} [opts.timeoutMs] deadline; default 30s
 * @param {AbortSignal} [opts.signal] caller cancellation
 * @param {string} [opts.gitPath] explicit git executable (settings override)
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number, stdoutTruncated: boolean, stderrTruncated: boolean }>}
 */
export async function runGit(ctx, cwd, args, opts = {}) {
  const mutating = opts.mutating === true
  const run = () => executeGit(ctx, cwd, args, opts)
  if (!mutating) return run()
  const key = queueKey(cwd)
  const prev = queues.get(key) ?? Promise.resolve()
  const next = prev.then(run, run)
  queues.set(key, next.catch(() => {}))
  try {
    return await next
  } finally {
    if (queues.get(key) === next) queues.delete(key)
  }
}

function queueKey(cwd) {
  return path.resolve(cwd).toLowerCase()
}

async function executeGit(ctx, cwd, args, opts) {
  const gitPath = opts.gitPath && opts.gitPath.trim() !== '' ? opts.gitPath : 'git'
  const argv = ['-C', path.resolve(cwd), ...args]
  const timeoutMs = opts.timeoutMs ?? 30_000
  const isRead = READ_ONLY_COMMANDS.has(args[0] ?? '')
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    ...(isRead ? { GIT_OPTIONAL_LOCKS: '0' } : {}),
    // 网络操作(ssh/https)禁交互:新主机密钥自动接受(BatchMode 下仅接受新密钥,
    // 已知密钥变化仍会拒绝),口令/口令短语提示则直接失败而不是挂起。
    ...(opts.remote === true ? { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new' } : {}),
  }

  return await new Promise((resolve, reject) => {
    let settled = false
    const stdoutChunks = []
    const stderrChunks = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let stdoutTruncated = false
    let stderrTruncated = false
    let timedOut = false

    let child
    try {
      child = spawn(gitPath, argv, {
        cwd: path.resolve(cwd),
        env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      reject(new GitError(GIT_ERROR_CODES.GIT, `failed to start git: ${String(error.message ?? error)}`))
      return
    }

    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, timeoutMs)
    if (timer.unref) timer.unref()

    const onAbort = () => killTree(child)
    if (opts.signal) {
      if (opts.signal.aborted) onAbort()
      else opts.signal.addEventListener('abort', onAbort, { once: true })
    }

    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort)
      const message = /ENOENT/.test(String(error.code)) && gitPath === 'git'
        ? 'git executable not found on PATH'
        : `failed to start git: ${String(error.message ?? error)}`
      reject(new GitError(GIT_ERROR_CODES.GIT, message))
    })

    child.stdout.on('data', (chunk) => {
      const keep = Math.min(chunk.length, MAX_STREAM_BYTES - stdoutBytes)
      if (keep > 0) stdoutChunks.push(chunk.subarray(0, keep))
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_STREAM_BYTES) stdoutTruncated = true
    })
    child.stderr.on('data', (chunk) => {
      const keep = Math.min(chunk.length, MAX_STREAM_BYTES - stderrBytes)
      if (keep > 0) stderrChunks.push(chunk.subarray(0, keep))
      stderrBytes += chunk.length
      if (stderrBytes > MAX_STREAM_BYTES) stderrTruncated = true
    })

    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort)
      const stdout = Buffer.concat(stdoutChunks).toString('utf8')
      const stderr = Buffer.concat(stderrChunks).toString('utf8')
      if (timedOut) {
        reject(new GitError(GIT_ERROR_CODES.TIMEOUT, `git ${args[0]} timed out after ${Math.round(timeoutMs / 1000)}s`, stderr))
        return
      }
      if (opts.signal?.aborted) {
        reject(new GitError(GIT_ERROR_CODES.CANCELLED, 'cancelled'))
        return
      }
      resolve({
        stdout: stdoutTruncated ? stdout + TRUNCATION_MARKER : stdout,
        stderr: stderrTruncated ? stderr + TRUNCATION_MARKER : stderr,
        exitCode: code ?? (signal === null ? 0 : 128),
        stdoutTruncated,
        stderrTruncated,
      })
    })

    if (opts.input !== undefined && opts.input !== null) {
      child.stdin.on('error', () => {})
      child.stdin.end(opts.input, 'utf8')
    } else {
      child.stdin.end()
    }
  })
}

function killTree(child) {
  try {
    if (child && child.pid !== undefined && child.exitCode === null) {
      child.kill('SIGTERM')
      const force = setTimeout(() => {
        try {
          if (child.exitCode === null) child.kill('SIGKILL')
        } catch { /* already gone */ }
      }, 1500)
      if (force.unref) force.unref()
    }
  } catch { /* already gone */ }
}

/**
 * Classify a failed git exit into a stable code + message.
 * @param {string} stderr
 * @param {string} subcommand
 * @returns {{ code: string, message: string } | null} null when unknown
 */
export function classifyGitFailure(stderr, subcommand) {
  const s = stderr ?? ''
  const hay = s.toLowerCase()
  if (/not a git repository|does not appear to be a git repository|outside repository/.test(hay)) {
    return { code: GIT_ERROR_CODES.NOT_REPO, message: '当前目录不是 Git 仓库 (not a git repository)' }
  }
  if (/unable to create .*index\.lock|another git process seems to be running/.test(hay)) {
    return { code: GIT_ERROR_CODES.LOCKED, message: 'Git 索引被锁定:另一个 Git 进程正在运行 (index.lock)' }
  }
  if (/your local changes to the following files would be overwritten|untracked working tree files would be overwritten/.test(hay)) {
    return { code: GIT_ERROR_CODES.UNMERGED, message: '切换被阻止:本地改动会被覆盖,请先提交或暂存 (checkout conflict)' }
  }
  if (/automatic merge failed|fix conflicts|unmerged paths|merge conflict|conflict \(content\)|conflict \(modify\/delete\)|conflict \(rename\/delete\)|conflict \(add\/add\)/.test(hay)) {
    return { code: GIT_ERROR_CODES.CONFLICT, message: '合并冲突:请解决冲突后提交 (merge conflict)' }
  }
  if (/please tell me who you are|user\.name|user\.email|empty ident name/.test(hay)) {
    return { code: GIT_ERROR_CODES.IDENTITY, message: '未配置 Git 身份 (user.name / user.email)' }
  }
  if (/authentication failed|could not read username|could not read password|permission denied \(publickey\)|terminal prompts disabled|credentials/.test(hay)) {
    return { code: GIT_ERROR_CODES.AUTH, message: '认证失败:请配置凭据助手或 SSH key (authentication failed)' }
  }
  if (/host key verification failed|could not resolve host|connection timed out|connection refused|network is unreachable|failed to connect|operation timed out/.test(hay)) {
    return { code: GIT_ERROR_CODES.NETWORK, message: '网络/SSH 连接失败:请检查网络与远程地址 (network error)' }
  }
  if (/no upstream branch|has no upstream|no tracking information/.test(hay)) {
    return { code: GIT_ERROR_CODES.NO_UPSTREAM, message: '当前分支还没有关联远程分支,请先 Push 一次建立关联' }
  }
  if (/remote .* already exists/.test(hay)) {
    return { code: GIT_ERROR_CODES.REMOTE_EXISTS, message: '同名远程仓库已存在' }
  }
  if (/hook declined|pre-commit hook exited|error: cannot run .* hook/.test(hay)) {
    return { code: GIT_ERROR_CODES.HOOK_FAILED, message: 'Git 钩子 (hook) 拒绝或失败' }
  }
  if (/does not have any commits yet|ambiguous argument 'head|bad revision 'head/.test(hay)) {
    return { code: GIT_ERROR_CODES.NO_COMMITS, message: '仓库还没有任何提交 (no commits yet)' }
  }
  if (/unknown revision or path not in the working tree|pathspec .* did not match/.test(hay)) {
    return { code: GIT_ERROR_CODES.NOT_FOUND, message: '目标不存在于工作区 (path not found)' }
  }
  return null
}

/**
 * Convenience: run a read command and return parsed output or throw GitError.
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
export async function gitRead(ctx, cwd, args, opts = {}) {
  const result = await runGit(ctx, cwd, args, { ...opts, mutating: false })
  if (result.exitCode !== 0) {
    const combined = `${result.stdout}\n${result.stderr}`
    const classified = classifyGitFailure(combined, args[0])
    throw new GitError(
      classified?.code ?? GIT_ERROR_CODES.GIT,
      classified?.message ?? `git ${args[0]} failed`,
      combined.trim(),
    )
  }
  return result
}

/**
 * Convenience: run a mutating command (queued per workspace) or throw GitError.
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
export async function gitWrite(ctx, cwd, args, opts = {}) {
  const result = await runGit(ctx, cwd, args, { ...opts, mutating: true })
  if (result.exitCode !== 0) {
    const combined = `${result.stdout}\n${result.stderr}`
    const classified = classifyGitFailure(combined, args[0])
    throw new GitError(
      classified?.code ?? GIT_ERROR_CODES.GIT,
      classified?.message ?? `git ${args[0]} failed`,
      combined.trim(),
    )
  }
  return result
}
