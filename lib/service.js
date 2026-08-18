/**
 * GitService — the Host half of dsh-git-gui.
 *
 * Registered under the cordis key `gitService` with the Typert wire namespace
 * `git`, so every `@Remote`-marked method below becomes a browser-callable
 * endpoint `git/<method>` through the API gateway's source (SRC) mode:
 * the client calls `ctx.connection.rpc.call('/api', 'git/status', {args})`.
 *
 * SRC constraints observed here:
 * - every method signature is plain unique identifiers (`cwd`, `signal`),
 *   because the gateway parses parameter names from the function source;
 * - the optional final parameter MUST be named `signal` (injected AbortSignal);
 * - business errors never throw: they return `{ok:false, code, message}` so
 *   the browser keeps structured error codes instead of a folded `internal`.
 *
 * Decorator note: this package ships plain JavaScript (no build step), so the
 * `@Remote` stage-3 decorator is applied manually with a standards-shaped
 * decorator context — the exact contract the compiled monorepo emits
 * (`__esDecorate` + instance initializers).
 */

import fs from 'node:fs'
import path from 'node:path'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { gitRead, gitWrite, GitError, GIT_ERROR_CODES, runGit } from './runner.js'
import {
  parseStatusPorcelainV2,
  parseUnifiedDiff,
  parseLog,
  parseRefs,
  parseStashList,
  parseRemotes,
  sortStatusFiles,
} from './parse.js'

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const MAX_PATHS = 500
const MAX_MESSAGE = 50_000
const MAX_UNTRAKED_PREVIEW = 512 * 1024
const NEGATIVE_TTL_MS = 5_000

const remoteInitializers = []
/**
 * @param {object} proto class prototype
 * @param {string} name public method name
 */
function markRemote(proto, name) {
  Remote(proto[name], {
    kind: 'method',
    name,
    static: false,
    private: false,
    addInitializer(fn) { remoteInitializers.push(fn) },
  })
}

/** Validate a batch of pathspecs coming from the wire. */
function sanitizePaths(paths) {
  if (!Array.isArray(paths)) return { ok: false, message: 'paths must be an array' }
  if (paths.length === 0) return { ok: false, message: '没有选择任何文件' }
  if (paths.length > MAX_PATHS) return { ok: false, message: `一次最多操作 ${MAX_PATHS} 个文件` }
  for (const p of paths) {
    if (typeof p !== 'string' || p === '') return { ok: false, message: '非法路径' }
    if (p.includes('\0') || p.startsWith('-') || p.includes('\n') || p.includes('\r')) {
      return { ok: false, message: `非法路径: ${p.slice(0, 80)}` }
    }
  }
  return { ok: true, paths }
}

/** Validate a branch name the wire asked us to create/switch to. */
function sanitizeBranch(name) {
  if (typeof name !== 'string' || name === '') return { ok: false, message: '分支名不能为空' }
  if (name.length > 240) return { ok: false, message: '分支名过长' }
  if (name.startsWith('-') || name.includes(' ') || name.includes('..') || name.includes('\\')) {
    return { ok: false, message: '非法分支名' }
  }
  if (/[~^:?*\[\]]/.test(name)) return { ok: false, message: '分支名包含非法字符' }
  if (name.startsWith('refs/') || /^(HEAD|FETCH_HEAD|ORIG_HEAD|MERGE_HEAD)$/.test(name)) {
    return { ok: false, message: '该名称是保留引用' }
  }
  return { ok: true, name }
}

function sanitizeCommit(commit, allowHeadExp = false) {
  if (typeof commit !== 'string' || commit === '') return { ok: false, message: '目标为空' }
  if (allowHeadExp && /^HEAD(~[0-9]{1,3})?$/.test(commit)) return { ok: true, commit }
  if (/^[0-9a-fA-F]{7,40}$/.test(commit)) return { ok: true, commit }
  return { ok: false, message: '非法的提交哈希' }
}

function sanitizeStashRef(ref) {
  if (typeof ref !== 'string') return { ok: false, message: '非法 stash 引用' }
  if (/^stash@\{\d+\}$/.test(ref)) return { ok: true, ref }
  return { ok: false, message: '非法 stash 引用' }
}

/**
 * Deep-clean a value for the Typert boundary: SRC results must be strictly
 * JSON-safe (the gateway's `assertJsonValue` rejects undefined, non-finite
 * numbers, functions, and cyclic values). `undefined` becomes `null` so the
 * object shape is preserved.
 * @param {unknown} value
 * @returns {unknown}
 */
function scrubJson(value, seen = new Set()) {
  if (value === undefined || value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value === undefined ? null : value
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'object') return null
  if (seen.has(value)) return null
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      const out = new Array(value.length)
      for (let i = 0; i < value.length; i++) out[i] = scrubJson(value[i], seen)
      return out
    }
    const out = {}
    for (const key of Object.keys(value)) {
      out[key] = scrubJson(value[key], seen)
    }
    return out
  } finally {
    seen.delete(value)
  }
}

export class GitService extends TypertRemoteService {
  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx
   * @param {import('./activity.js').ActivityTracker} tracker
   */
  constructor(ctx, tracker) {
    super(ctx, 'gitService', { namespace: 'git' })
    for (const initializer of remoteInitializers) initializer.call(this)
    this.tracker = tracker
    this.versionCache = undefined
    /** @type {Map<string, {root: string|null, nested: number, at: number}>} session-cwd → discovery */
    this.rootCache = new Map()
  }

  /**
   * Wrap a body: GitError and unexpected errors become `{ok:false}`; every
   * successful result passes through `scrubJson` so the Typert gateway's
   * strict JSON boundary validation never rejects it.
   */
  async guard(body) {
    try {
      return scrubJson(await body())
    } catch (error) {
      if (error instanceof GitError) {
        return scrubJson({ ok: false, code: error.code, message: error.message, detail: error.detail })
      }
      return scrubJson({
        ok: false,
        code: GIT_ERROR_CODES.GIT,
        message: `内部错误: ${String(error?.message ?? error).slice(0, 300)}`,
      })
    }
  }

  // ── read surface ──────────────────────────────────────────────────────────

  /**
   * Repository detection + git version.
   * @returns {{ok:true, repo:boolean, root?:string, gitVersion?:string} | {ok:false,...}}
   */
  async check(cwd, signal) {
    return this.guard(async () => {
      const version = await this.gitVersion()
      const { root, nested } = await this.resolveRoot(cwd)
      if (root === null) {
        return { ok: true, repo: false, nested, gitVersion: version }
      }
      return { ok: true, repo: true, root, nested, gitVersion: version }
    })
  }

  async gitVersion() {
    if (this.versionCache !== undefined) return this.versionCache
    try {
      const { stdout } = await runGit(this.ctx, process.cwd(), ['--version'], { timeoutMs: 10_000 })
      this.versionCache = stdout.trim()
    } catch {
      this.versionCache = ''
    }
    return this.versionCache
  }

  /**
   * Resolve the effective git root for a session cwd.
   *
   * git only discovers repositories by walking UP from the cwd. When the
   * session workspace itself is not a repo (e.g. the repo lives in a
   * subdirectory like `dsh-git-gui/`), scan one level down for a single
   * nested repository and operate on it.
   *
   * @param {string} cwd session workspace root
   * @returns {Promise<{root: string|null, nested: number}>}
   */
  async resolveRoot(cwd) {
    const key = path.resolve(cwd).toLowerCase()
    const cached = this.rootCache.get(key)
    if (cached !== undefined) {
      // positive discoveries stay cached; negatives expire so a repo created
      // later (init in the panel, another tool) is picked up quickly
      if (cached.root !== null || Date.now() - cached.at < NEGATIVE_TTL_MS) return cached
    }
    let discovery = { root: null, nested: 0, at: Date.now() }
    try {
      const result = await runGit(this.ctx, cwd, ['rev-parse', '--show-toplevel'], {})
      if (result.exitCode === 0) {
        const root = result.stdout.trim()
        if (root !== '') discovery = { root, nested: 0, at: Date.now() }
      }
    } catch { /* not a repo at/above cwd */ }
    if (discovery.root === null) {
      discovery = { ...(await this.findNestedRepo(cwd)), at: Date.now() }
    }
    this.rootCache.set(key, discovery)
    return discovery
  }

  /**
   * Scan direct subdirectories of cwd for nested `.git` markers (depth 1).
   * Returns the repo root when exactly one is found; several nested repos
   * are reported via `nested` > 1 without picking a winner.
   */
  async findNestedRepo(cwd) {
    let entries = []
    try {
      entries = fs.readdirSync(cwd, { withFileTypes: true })
    } catch {
      return { root: null, nested: 0 }
    }
    const roots = []
    let scanned = 0
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const name = entry.name
      if (name === 'node_modules' || name === '.git' || name.startsWith('.')) continue
      if (++scanned > 300) break
      const sub = path.join(cwd, name)
      let marker = false
      try {
        marker = fs.existsSync(path.join(sub, '.git'))
      } catch { continue }
      if (!marker) continue
      try {
        const result = await runGit(this.ctx, sub, ['rev-parse', '--show-toplevel'], {})
        if (result.exitCode === 0 && result.stdout.trim() !== '') {
          roots.push(result.stdout.trim())
        }
      } catch { /* marker exists but unusable */ }
      if (roots.length > 1) break
    }
    if (roots.length === 1) return { root: roots[0], nested: 1 }
    if (roots.length > 1) return { root: null, nested: roots.length }
    return { root: null, nested: 0 }
  }

  /** Effective root or a structured NOT_REPO failure. */
  async requireRoot(cwd) {
    const { root } = await this.resolveRoot(cwd)
    if (root === null) throw new GitError(GIT_ERROR_CODES.NOT_REPO, '当前目录不是 Git 仓库 (not a git repository)')
    return root
  }

  /**
   * Working tree status (porcelain v2) + branch facts.
   * @returns {{ok:true, branch:object, files:object[]} | {ok:false,...}}
   */
  async status(cwd, signal) {
    return this.guard(async () => {
      const root = await this.requireRoot(cwd)
      const { stdout } = await gitRead(this.ctx, root, ['status', '--porcelain=v2', '-z', '--branch'], { signal })
      const parsed = parseStatusPorcelainV2(stdout)
      return { ok: true, branch: parsed.branch, files: sortStatusFiles(parsed.files) }
    })
  }

  /**
   * Unified diff for one path.
   * @param {string} cwd workspace root
   * @param {string} path repo-relative path
   * @param {boolean} staged true = index vs HEAD; false = worktree vs index
   * @param {string|null} base optional commit to diff the worktree against
   * @param {boolean} untracked the path is untracked: synthesize an all-added file
   * @returns {{ok:true, diff:object} | {ok:false,...}}
   */
  async diff(cwd, path, staged, base, untracked, signal) {
    return this.guard(async () => {
      const root = await this.requireRoot(cwd)
      if (typeof path !== 'string' || path === '' || path.includes('\0') || path.startsWith('-')) {
        return { ok: false, code: GIT_ERROR_CODES.NOT_FOUND, message: '非法路径' }
      }
      if (untracked === true) return this.untrackedFileDiff(root, path)
      const args = ['diff', '--no-ext-diff', '--no-color', '--src-prefix=a/', '--dst-prefix=b/']
      if (staged === true) {
        args.push('--cached')
      } else if (typeof base === 'string' && base !== '') {
        const commit = sanitizeCommit(base)
        if (!commit.ok) return commit
        args.push(commit.commit)
      }
      args.push('--', path)
      let stdout
      try {
        ;({ stdout } = await gitRead(this.ctx, root, args, { signal, timeoutMs: 45_000 }))
      } catch (error) {
        // `git diff --cached` needs a HEAD; empty repos diff against the empty tree.
        if (staged === true && error instanceof GitError && error.code === GIT_ERROR_CODES.NO_COMMITS) {
          const fallback = ['diff', '--no-ext-diff', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', '--cached', EMPTY_TREE, '--', path]
          ;({ stdout } = await gitRead(this.ctx, root, fallback, { signal, timeoutMs: 45_000 }))
        } else {
          throw error
        }
      }
      return { ok: true, diff: parseUnifiedDiff(stdout), raw: stdout }
    })
  }

  /**
   * Read one workspace file for preview: returns plain JSON-safe content
   * facts ({content, binary, tooLarge, size}) or a structured failure.
   */
  readFilePreview(root, filePath) {
    const rootAbs = path.resolve(root)
    const absolute = path.resolve(rootAbs, filePath)
    if (!absolute.toLowerCase().startsWith(rootAbs.toLowerCase() + path.sep)) {
      return { ok: false, code: GIT_ERROR_CODES.NOT_FOUND, message: '路径越界' }
    }
    let stat = null
    try {
      stat = fs.statSync(absolute)
    } catch {
      return { ok: false, code: GIT_ERROR_CODES.NOT_FOUND, message: '文件不存在' }
    }
    if (stat.isDirectory()) {
      return { ok: false, code: 'IS_DIR', message: '这是一个目录' }
    }
    if (stat.size > MAX_UNTRAKED_PREVIEW) {
      return { ok: true, content: null, binary: false, tooLarge: true, size: stat.size }
    }
    try {
      const buffer = fs.readFileSync(absolute)
      const probe = buffer.subarray(0, Math.min(buffer.length, 8192))
      if (probe.includes(0)) {
        return { ok: true, content: null, binary: true, tooLarge: false, size: stat.size }
      }
      return { ok: true, content: buffer.toString('utf8'), binary: false, tooLarge: false, size: stat.size }
    } catch (error) {
      return { ok: false, code: GIT_ERROR_CODES.GIT, message: `读取失败: ${String(error?.message ?? error)}` }
    }
  }

  async untrackedFileDiff(root, filePath) {
    const preview = this.readFilePreview(root, filePath)
    if (!preview.ok) return preview
    if (preview.tooLarge) {
      return {
        ok: true,
        diff: {
          files: [{ newPath: filePath, binary: false, newFile: true, hunks: [], tooLarge: true, size: preview.size }],
        },
      }
    }
    if (preview.binary) {
      return { ok: true, diff: { files: [{ newPath: filePath, binary: true, newFile: true, hunks: [], size: preview.size }] } }
    }
    const lines = preview.content.split('\n')
    const hasTrailingNewline = lines.length > 1 && lines[lines.length - 1] === ''
    if (hasTrailingNewline) lines.pop()
    const hunkLines = lines.map((text, i) => ({ type: 'add', text, newLine: i + 1, newline: i < lines.length - 1 || hasTrailingNewline }))
    return {
      ok: true,
      diff: {
        files: [{
          newPath: filePath, binary: false, newFile: true,
          hunks: [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: lines.length, lines: hunkLines }],
        }],
      },
    }
  }

  /**
   * Commit history.
   * @param {number} limit 1..500
   * @param {string|null} path optional file filter
   */
  async log(cwd, limit, path, signal) {
    return this.guard(async () => {
      const root = await this.requireRoot(cwd)
      const n = Math.max(1, Math.min(Number(limit) || 100, 500))
      const args = ['log', `--max-count=${n}`, '--pretty=format:%H%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%D%x1e']
      if (typeof path === 'string' && path !== '' && !path.includes('\0') && !path.startsWith('-')) {
        args.push('--', path)
      }
      try {
        const { stdout } = await gitRead(this.ctx, root, args, { signal })
        return { ok: true, commits: parseLog(stdout) }
      } catch (error) {
        if (error instanceof GitError && error.code === GIT_ERROR_CODES.NO_COMMITS) {
          return { ok: true, commits: [] }
        }
        throw error
      }
    })
  }

  /** Local + remote refs, remotes list. */
  async branches(cwd, signal) {
    return this.guard(async () => {
      const root = await this.requireRoot(cwd)
      const format = '%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(upstream:track)%00%(HEAD)%00%(subject)'
      const { stdout } = await gitRead(this.ctx, root, ['for-each-ref', `--format=${format}`, '--sort=-committerdate', 'refs/heads', 'refs/remotes'], { signal })
      let remotes = []
      try {
        const { stdout: remoteOut } = await gitRead(this.ctx, root, ['remote', '-v'], { signal })
        remotes = parseRemotes(remoteOut)
      } catch { /* no remotes is fine */ }
      return { ok: true, refs: parseRefs(stdout), remotes }
    })
  }

  /** user.name / user.email resolution for the commit box. */
  async identity(cwd, signal) {
    return this.guard(async () => {
      const root = await this.requireRoot(cwd)
      let name
      let email
      try {
        name = (await gitRead(this.ctx, root, ['config', '--get', 'user.name'], { signal })).stdout.trim()
      } catch { name = '' }
      try {
        email = (await gitRead(this.ctx, root, ['config', '--get', 'user.email'], { signal })).stdout.trim()
      } catch { email = '' }
      return { ok: true, name: name || undefined, email: email || undefined, hasIdentity: name !== '' && email !== '' }
    })
  }

  /** Agent activity timeline for this workspace. */
  async activity(cwd, limit, signal) {
    const entries = this.tracker.list(cwd, limit)
    return { ok: true, entries }
  }

  /**
   * Workspace file inventory with per-file git state:
   * `clean` | `modified` (changed vs HEAD, incl. staged) | `untracked`.
   * Uses git's own lists (`ls-files --cached` + `--others --exclude-standard`)
   * so .gitignore semantics are respected; directories are synthesized by
   * the client from path segments.
   */
  async tree(cwd, signal) {
    return this.guard(async () => {
      const root = await this.requireRoot(cwd)
      const tracked = (await gitRead(this.ctx, root, ['ls-files', '--cached', '-z'], { signal })).stdout
      const others = (await gitRead(this.ctx, root, ['ls-files', '--others', '--exclude-standard', '-z'], { signal })).stdout
      const statusRaw = (await gitRead(this.ctx, root, ['status', '--porcelain=v2', '-z'], { signal })).stdout
      const status = parseStatusPorcelainV2(statusRaw)

      const stateByPath = new Map()
      for (const file of status.files) {
        if (file.x === '!' || file.y === '!') continue
        if (file.x === '?' || file.y === '?') stateByPath.set(file.path, 'untracked')
        else stateByPath.set(file.path, 'modified')
      }
      const seen = new Set()
      const files = []
      for (const raw of `${tracked}\0${others}`.split('\0')) {
        const filePath = raw.trim()
        if (filePath === '') continue
        if (seen.has(filePath)) continue
        seen.add(filePath)
        files.push({
          path: filePath,
          state: stateByPath.get(filePath) ?? 'clean',
        })
      }
      files.sort((a, b) => a.path.localeCompare(b.path))
      const MAX_TREE_FILES = 3000
      const truncated = files.length > MAX_TREE_FILES
      if (truncated) files.length = MAX_TREE_FILES
      return { ok: true, files, truncated, total: files.length }
    })
  }

  /**
   * Read a workspace file for the tree view (clean files have no diff).
   * @returns {{ok:true, content:string|null, binary:boolean, tooLarge:boolean, size:number} | {ok:false,...}}
   */
  async cat(cwd, path, signal) {
    return this.guard(async () => {
      const root = await this.requireRoot(cwd)
      if (typeof path !== 'string' || path === '' || path.includes('\0') || path.startsWith('-')) {
        return { ok: false, code: GIT_ERROR_CODES.NOT_FOUND, message: '非法路径' }
      }
      return this.readFilePreview(root, path)
    })
  }

  // ── mutating surface (serialized per workspace by the runner) ─────────────

  /** `git add -- <paths>` */
  async stage(cwd, paths, signal) {
    const checked = sanitizePaths(paths)
    if (!checked.ok) return { ok: false, code: 'INVALID', message: checked.message }
    return this.guard(async () => {
      const root = await this.requireRoot(cwd)
      await gitWrite(this.ctx, root, ['add', '--', ...checked.paths], { signal })
      return { ok: true }
    })
  }

  /** `git restore --staged -- <paths>` */
  async unstage(cwd, paths, signal) {
    const checked = sanitizePaths(paths)
    if (!checked.ok) return { ok: false, code: 'INVALID', message: checked.message }
    return this.guard(async () => {
      const root = await this.requireRoot(cwd)
      await gitWrite(this.ctx, root, ['restore', '--staged', '--', ...checked.paths], { signal })
      return { ok: true }
    })
  }

  /**
   * Discard worktree changes (`git restore --`) or delete untracked files
   * (`git clean -f -d --`).
   */
  async discard(cwd, paths, untracked, signal) {
    const checked = sanitizePaths(paths)
    if (!checked.ok) return { ok: false, code: 'INVALID', message: checked.message }
    return this.guard(async () => {
      const root = await this.requireRoot(cwd)
      if (untracked === true) {
        await gitWrite(this.ctx, root, ['clean', '-f', '-d', '--', ...checked.paths], { signal })
      } else {
        await gitWrite(this.ctx, root, ['restore', '--', ...checked.paths], { signal })
      }
      return { ok: true }
    })
  }

  /** Commit staged changes with the given message. */
  async commit(cwd, message, signal) {
    if (typeof message !== 'string' || message.trim() === '') {
      return { ok: false, code: 'INVALID', message: '提交信息不能为空' }
    }
    if (message.length > MAX_MESSAGE) {
      return { ok: false, code: 'INVALID', message: '提交信息过长' }
    }
    return this.guard(async () => {
      const root = await this.requireRoot(cwd)
      const result = await gitWrite(this.ctx, root, ['commit', '-F', '-'], { signal, input: message, timeoutMs: 120_000 })
      let hash
      try {
        hash = (await gitRead(this.ctx, root, ['rev-parse', 'HEAD'], { signal })).stdout.trim()
      } catch { hash = undefined }
      const output = (result.stdout + result.stderr).trim()
      return { ok: true, hash, output }
    })
  }

  /**
   * Generate a commit message using the LLM based on staged changes.
   * Reads `git diff --cached` and asks the model to produce a concise
   * conventional-commit message.
   */
  async generateCommitMessage(cwd, signal) {
    return this.guard(async () => {
      const root = await this.requireRoot(cwd)

      // 1. Collect staged diff (limit to avoid overwhelming the model)
      const MAX_DIFF_BYTES = 60 * 1024
      let diffResult
      try {
        diffResult = await gitRead(this.ctx, root, [
          'diff', '--cached', '--no-color', '--no-ext-diff',
          '--src-prefix=a/', '--dst-prefix=b/',
        ], { signal, timeoutMs: 30_000 })
      } catch (error) {
        if (error instanceof GitError && error.code === GIT_ERROR_CODES.NO_COMMITS) {
          // Empty repo: diff against empty tree
          diffResult = await gitRead(this.ctx, root, [
            'diff', '--cached', '--no-color', '--no-ext-diff',
            '--src-prefix=a/', '--dst-prefix=b/',
            '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
          ], { signal, timeoutMs: 30_000 })
        } else {
          throw error
        }
      }

      let diffText = diffResult.stdout
      if (Buffer.byteLength(diffText, 'utf8') > MAX_DIFF_BYTES) {
        diffText = diffText.slice(0, MAX_DIFF_BYTES) + '\n... [diff truncated]'
      }

      if (diffText.trim() === '') {
        return { ok: false, code: 'INVALID', message: '没有已暂存的改动,无法生成提交信息' }
      }

      // 2. Resolve model route
      const llm = this.ctx.get('llm')
      if (!llm) {
        return { ok: false, code: 'INVALID', message: 'LLM 服务不可用' }
      }

      let provider, model
      const defaultModel = this.ctx.get('agentDefaultModel')
      if (defaultModel) {
        const sel = defaultModel.currentSelection()
        provider = sel.provider
        model = sel.model
      }
      if (!provider || !model) {
        return { ok: false, code: 'INVALID', message: '未配置默认模型,无法生成提交信息' }
      }

      // 3. Build prompt
      const system = [
        'You are a helpful assistant that generates concise, high-quality Git commit messages.',
        'Rules:',
        '- Use Conventional Commits format when possible (e.g. feat: ..., fix: ..., refactor: ...)',
        '- Write the subject line (first line) under 72 characters',
        '- Use the imperative mood ("add" not "added")',
        '- If a body is needed, add a blank line after the subject, then wrap at 72 characters',
        '- Use the same language as the code changes (usually English, but match Chinese comments if present)',
        '- Return ONLY the commit message, no explanations, no markdown fences, no prefix',
      ].join('\n')

      const userText = [
        'Based on the following staged diff, generate a single Git commit message.',
        '',
        '```diff',
        diffText,
        '```',
      ].join('\n')

      const messages = [createUserMessage({
        content: [{ type: 'text', text: userText }],
        source: { kind: 'plugin', plugin: 'dsh-git-gui' },
      })]

      // 4. Call LLM
      // 提交信息本身很短,但推理型模型会把大量输出额度消耗在思考上(实测可
      // 吃掉整个预算仍未输出正文)。先用常规预算试;finish=max-tokens 且无正文
      // 时用更大预算重试一次。非推理模型第一次就会直接出正文,不受影响。
      const BUDGETS = [2048, 8192]
      let finish = null
      let blocks = []
      let usage = null
      let text = ''
      for (const maxTokens of BUDGETS) {
        const assembler = new BlockAssembler()
        for await (const chunk of llm.stream({
          provider,
          model,
          messages,
          system,
          maxTokens,
          signal,
        })) {
          if (signal?.aborted) break
          assembler.push(chunk)
        }
        finish = assembler.finish
        usage = assembler.usage
        blocks = assembler.blocks()
        text = blocks
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim()
        if (finish.kind === 'error' || finish.kind === 'aborted' || text) break
      }

      if (finish.kind === 'error' || finish.kind === 'aborted') {
        return { ok: false, code: 'LLM_ERROR', message: finish.failure?.message ?? '模型调用失败' }
      }

      if (!text) {
        const usageText = usage
          ? `输入${usage.inputTokens ?? '?'}/输出${usage.outputTokens ?? '?'}tokens`
          : '无 usage'
        const kinds = blocks.map((b) => b.type).join(',') || '(无内容块)'
        const hint = finish.kind === 'max-tokens'
          ? ';模型把输出额度全部用在了推理上,已用更大额度重试仍无正文——请换非推理模型,或在供应商/模型配置侧关闭思考'
          : ''
        return {
          ok: false,
          code: 'LLM_ERROR',
          message: `模型未返回有效的提交信息(finish=${finish.kind},块类型:${kinds},${usageText}${hint})`,
        }
      }

      // 5. Clean up: strip markdown fences if the model wrapped them anyway
      const cleaned = text
        .replace(/^```(?:commit|git|plaintext)?\n?/gm, '')
        .replace(/\n?```$/gm, '')
        .trim()

      return { ok: true, message: cleaned }
    })
  }

  /** Create / switch branch. */
  async switchBranch(cwd, name, create, signal) {
    const checked = sanitizeBranch(name)
    if (!checked.ok) return { ok: false, code: 'INVALID', message: checked.message }
    return this.guard(async () => {
      const root = await this.requireRoot(cwd)
      const args = create === true ? ['switch', '-c', checked.name] : ['switch', checked.name]
      const result = await gitWrite(this.ctx, root, args, { signal, timeoutMs: 120_000 })
      return { ok: true, output: (result.stdout + result.stderr).trim() }
    })
  }

  /** Merge a ref into the current branch. */
  async merge(cwd, ref, signal) {
    const checked = sanitizeCommit(ref)
    if (!checked.ok) {
      const branchChecked = sanitizeBranch(ref)
      if (!branchChecked.ok) return { ok: false, code: 'INVALID', message: checked.message }
    }
    return this.guard(async () => {
      const root = await this.requireRoot(cwd)
      const result = await gitWrite(this.ctx, root, ['merge', '-m', `Merge '${ref}'`, ref], { signal, timeoutMs: 180_000 })
      return { ok: true, output: (result.stdout + result.stderr).trim() }
    })
  }

  /** pull with a selected strategy. */
  async pull(cwd, mode, signal) {
    if (mode !== 'ff-only' && mode !== 'merge' && mode !== 'rebase') {
      return { ok: false, code: 'INVALID', message: '非法 pull 模式' }
    }
    const flag = mode === 'ff-only' ? '--ff-only' : mode === 'rebase' ? '--rebase' : '--no-rebase'
    return this.guard(async () => {
      const root = await this.requireRoot(cwd)
      const result = await gitWrite(this.ctx, root, ['pull', flag], { signal, timeoutMs: 300_000, remote: true })
      return { ok: true, output: (result.stdout + result.stderr).trim() }
    })
  }

  /**
   * Push to the configured upstream; when the branch has no upstream yet
   * (fresh clone / first push), fall back to `git push -u <remote> <branch>`.
   */
  async push(cwd, signal) {
    return this.guard(async () => {
      const root = await this.requireRoot(cwd)
      let result
      try {
        result = await gitWrite(this.ctx, root, ['push'], { signal, timeoutMs: 300_000, remote: true })
      } catch (error) {
        if (!(error instanceof GitError) || error.code !== GIT_ERROR_CODES.NO_UPSTREAM) throw error
        const remote = await this.firstRemote(root, signal)
        const branch = await this.currentBranch(root, signal)
        if (remote === null || branch === null) throw error
        result = await gitWrite(this.ctx, root, ['push', '-u', remote, branch], { signal, timeoutMs: 300_000, remote: true })
      }
      return { ok: true, output: (result.stdout + result.stderr).trim() }
    })
  }

  /** fetch all remotes (prunes stale remote-tracking refs). */
  async fetch(cwd, signal) {
    return this.guard(async () => {
      const root = await this.requireRoot(cwd)
      const result = await gitWrite(this.ctx, root, ['fetch', '--all', '--prune'], { signal, timeoutMs: 300_000, remote: true })
      return { ok: true, output: (result.stdout + result.stderr).trim() }
    })
  }

  /** Remotes configured for the workspace. */
  async remoteList(cwd, signal) {
    return this.guard(async () => {
      const root = await this.requireRoot(cwd)
      try {
        const { stdout } = await gitRead(this.ctx, root, ['remote', '-v'], { signal })
        return { ok: true, remotes: parseRemotes(stdout) }
      } catch (error) {
        if (error instanceof GitError && error.code === GIT_ERROR_CODES.NOT_REPO) throw error
        return { ok: true, remotes: [] }
      }
    })
  }

  /** Add a remote (name + url). */
  async remoteAdd(cwd, name, url, signal) {
    if (typeof name !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(name)) {
      return { ok: false, code: 'INVALID', message: '远程名称只能包含字母、数字、. _ - (1-64 字符)' }
    }
    if (typeof url !== 'string' || url === '' || url.length > 500 || /[\s\x00-\x1f]/.test(url) || url.startsWith('-')) {
      return { ok: false, code: 'INVALID', message: '远程 URL 无效' }
    }
    return this.guard(async () => {
      const root = await this.requireRoot(cwd)
      const result = await gitWrite(this.ctx, root, ['remote', 'add', name, url], { signal })
      return { ok: true, output: (result.stdout + result.stderr).trim() }
    })
  }

  async firstRemote(root, signal) {
    try {
      const { stdout } = await gitRead(this.ctx, root, ['remote'], { signal })
      const name = stdout.split('\n').map((l) => l.trim()).find((l) => l !== '')
      return name ?? null
    } catch {
      return null
    }
  }

  async currentBranch(root, signal) {
    try {
      const { stdout } = await gitRead(this.ctx, root, ['branch', '--show-current'], { signal })
      const name = stdout.trim()
      return name === '' ? null : name
    } catch {
      return null
    }
  }

  /** stash: list / push / pop / apply / drop. */
  async stash(cwd, op, message, stashId, signal) {
    return this.guard(async () => {
      const root = await this.requireRoot(cwd)
      if (op === 'list') {
        try {
          const { stdout } = await gitRead(this.ctx, root, ['stash', 'list', '--pretty=format:%gd%x00%H%x00%s'], { signal })
          return { ok: true, stashes: parseStashList(stdout) }
        } catch (error) {
          if (error instanceof GitError && error.code === GIT_ERROR_CODES.NO_COMMITS) {
            return { ok: true, stashes: [] }
          }
          throw error
        }
      }
      let args
      if (op === 'push') {
        args = ['stash', 'push']
        if (typeof message === 'string' && message.trim() !== '') args.push('-m', message.trim().slice(0, 1000))
      } else if (op === 'pop' || op === 'apply' || op === 'drop') {
        const checked = sanitizeStashRef(stashId)
        if (!checked.ok) return { ok: false, code: 'INVALID', message: checked.message }
        args = ['stash', op, checked.ref]
      } else {
        return { ok: false, code: 'INVALID', message: '非法 stash 操作' }
      }
      const result = await gitWrite(this.ctx, root, args, { signal, timeoutMs: 120_000 })
      return { ok: true, output: (result.stdout + result.stderr).trim() }
    })
  }

  /** Revert a commit (non-interactive). */
  async revert(cwd, commit, signal) {
    const checked = sanitizeCommit(commit)
    if (!checked.ok) return { ok: false, code: 'INVALID', message: checked.message }
    return this.guard(async () => {
      const root = await this.requireRoot(cwd)
      const result = await gitWrite(this.ctx, root, ['revert', '--no-edit', checked.commit], { signal, timeoutMs: 180_000 })
      return { ok: true, output: (result.stdout + result.stderr).trim() }
    })
  }

  /** reset soft/mixed/hard, optional target (default HEAD). */
  async reset(cwd, mode, target, signal) {
    if (mode !== 'soft' && mode !== 'mixed' && mode !== 'hard') {
      return { ok: false, code: 'INVALID', message: '非法 reset 模式' }
    }
    if (typeof target !== 'string' || target === '') target = 'HEAD'
    const checked = sanitizeCommit(target, true)
    if (!checked.ok) return { ok: false, code: 'INVALID', message: checked.message }
    return this.guard(async () => {
      const root = await this.requireRoot(cwd)
      const result = await gitWrite(this.ctx, root, ['reset', `--${mode}`, checked.commit], { signal, timeoutMs: 120_000 })
      return { ok: true, output: (result.stdout + result.stderr).trim() }
    })
  }

  /**
   * Initialize a repository at the session workspace root (this is the only
   * mutation that runs at `cwd` instead of a discovered root — creating a
   * repo under a random nested directory would surprise the user).
   */
  async init(cwd, signal) {
    return this.guard(async () => {
      const result = await gitWrite(this.ctx, cwd, ['init'], { signal })
      // drop the cached "not a repo" discovery so the next check finds it
      this.rootCache.delete(path.resolve(cwd).toLowerCase())
      return { ok: true, output: (result.stdout + result.stderr).trim() }
    })
  }
}

// Register every public business method for Typert source-mode discovery.
markRemote(GitService.prototype, 'check')
markRemote(GitService.prototype, 'status')
markRemote(GitService.prototype, 'diff')
markRemote(GitService.prototype, 'log')
markRemote(GitService.prototype, 'branches')
markRemote(GitService.prototype, 'identity')
markRemote(GitService.prototype, 'activity')
markRemote(GitService.prototype, 'tree')
markRemote(GitService.prototype, 'cat')
markRemote(GitService.prototype, 'stage')
markRemote(GitService.prototype, 'unstage')
markRemote(GitService.prototype, 'discard')
markRemote(GitService.prototype, 'commit')
markRemote(GitService.prototype, 'generateCommitMessage')
markRemote(GitService.prototype, 'switchBranch')
markRemote(GitService.prototype, 'merge')
markRemote(GitService.prototype, 'pull')
markRemote(GitService.prototype, 'push')
markRemote(GitService.prototype, 'fetch')
markRemote(GitService.prototype, 'remoteList')
markRemote(GitService.prototype, 'remoteAdd')
markRemote(GitService.prototype, 'stash')
markRemote(GitService.prototype, 'revert')
markRemote(GitService.prototype, 'reset')
markRemote(GitService.prototype, 'init')
