/**
 * Pure parsers for git plumbing output (zero dependencies).
 *
 * Conventions followed throughout:
 * - every git invocation uses NUL / custom separators (-z, --format with %x00),
 *   so paths with spaces, quotes, CJK and newlines parse unambiguously;
 * - `core.quotepath=false` keeps paths verbatim (UTF-8) on the wire;
 * - parsers never throw on malformed input: they degrade to empty/partial
 *   results so one weird repo cannot take the panel down.
 */

/**
 * Parse `git status --porcelain=v2 -z --branch` output.
 *
 * Records are NUL-separated. v2 record shapes:
 *   `1 XY sub mH mI mW hH hI path`
 *   `2 XY sub mH mI mW hH hI Xscore path\0origPath`
 *   `u XY sub m1 m2 m3 mW h1 h2 h3 path`
 *   `? path`
 *   `! path`            (ignored)
 * Branch headers: `# branch.oid <sha|(initial)>`, `# branch.head <name|(detached)>`,
 * `# branch.upstream <name>`, `# branch.ab +<a> -<b>`.
 *
 * @param {string} raw raw stdout of the status command
 * @returns {{ branch: { head?: string, oid?: string, upstream?: string, ahead?: number, behind?: number, detached: boolean, noCommits: boolean }, files: Array<{ x: string, y: string, path: string, origPath?: string, sub: string }> }}
 */
export function parseStatusPorcelainV2(raw) {
  const branch = { detached: false, noCommits: false }
  const files = []
  const tokens = raw.split('\0')
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === '') continue
    if (token.startsWith('#')) {
      // header shape: `# branch.oid <value>` — the key is the first two
      // space-separated segments (`# branch.oid` itself contains a space).
      const m = /^(#\s+\S+)\s?(.*)$/.exec(token)
      if (!m) continue
      const key = m[1]
      const value = m[2]
      if (key === '# branch.oid') {
        branch.oid = value
        branch.noCommits = value === '(initial)'
      } else if (key === '# branch.head') {
        if (value === '(detached)') {
          branch.detached = true
        } else {
          branch.head = value
        }
      } else if (key === '# branch.upstream') {
        branch.upstream = value
      } else if (key === '# branch.ab') {
        const ab = /^\+(\d+) -(\d+)$/.exec(value)
        if (ab) {
          branch.ahead = Number(ab[1])
          branch.behind = Number(ab[2])
        }
      }
      continue
    }
    if (token.startsWith('? ') || token.startsWith('! ')) {
      // untracked / ignored: `? <path>` in one NUL-terminated record
      files.push({ x: token[0], y: token[0], sub: '', path: token.slice(2) })
      continue
    }
    const fields = token.split(' ')
    const marker = fields[0]
    // paths may contain spaces: everything after the fixed-width header is the path
    if (marker === '1' && fields.length >= 9) {
      files.push({ x: fields[1][0], y: fields[1][1], sub: fields[2], path: fields.slice(8).join(' ') })
    } else if (marker === '2' && fields.length >= 10) {
      const path = fields.slice(9).join(' ')
      const origPath = tokens[++i]
      files.push({ x: fields[1][0], y: fields[1][1], sub: fields[2], path, origPath })
    } else if (marker === 'u' && fields.length >= 11) {
      files.push({ x: fields[1][0], y: fields[1][1], sub: fields[2], path: fields.slice(10).join(' ') })
    }
    // anything else: unknown record shape, skip defensively
  }
  return { branch, files }
}

/** Sort status files: staged/unstaged first by path, untracked last. */
export function sortStatusFiles(files) {
  const rank = (f) => {
    if (f.x === '?') return 3
    if (f.x === 'U' || f.y === 'U') return 2
    return f.x === '.' ? 1 : 0
  }
  return [...files].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path))
}

/**
 * Parse unified git diff output into structured files.
 *
 * @param {string} raw diff text
 * @param {object} [caps]
 * @param {number} [caps.maxLinesPerFile] safety cap for hunk lines
 * @returns {{ files: Array<{ oldPath?: string, newPath: string, mode?: string, binary: boolean, newFile: boolean, deleted: boolean, hunks: Array<{ oldStart: number, oldCount: number, newStart: number, newCount: number, lines: Array<{ type: 'ctx'|'add'|'del', text: string, oldLine?: number, newLine?: number, newline: boolean }> }> }>, truncated: boolean }}
 */
export function parseUnifiedDiff(raw, caps = {}) {
  const maxLinesPerFile = caps.maxLinesPerFile ?? 12000
  const lines = raw.split('\n')
  const files = []
  let cur = null
  let truncated = false
  let hunk = null
  let oldLine = 0
  let newLine = 0
  let pendingNoNewline = null

  const finishHunk = () => { hunk = null }
  const finishFile = () => {
    if (cur && pendingNoNewline && cur.hunks.length > 0) {
      const last = cur.hunks[cur.hunks.length - 1]
      if (last.lines.length > 0) last.lines[last.lines.length - 1].newline = false
    }
    pendingNoNewline = null
    cur = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('diff --git ')) {
      finishFile()
      cur = { newPath: '', oldPath: undefined, mode: undefined, binary: false, newFile: false, deleted: false, hunks: [] }
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line)
      if (m) {
        cur.oldPath = m[1]
        cur.newPath = m[2]
      } else {
        cur.newPath = line.slice('diff --git '.length)
      }
      files.push(cur)
      continue
    }
    if (cur === null) {
      if (line.startsWith('Binary files ')) {
        // binary diff without a diff --git header (rare); attach to last file if any
        const last = files[files.length - 1]
        if (last) last.binary = true
      }
      continue
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch') || line.startsWith('cannot apply binary patch')) {
      cur.binary = true
      continue
    }
    if (line.startsWith('new file mode ')) {
      cur.newFile = true
      cur.mode = line.slice('new file mode '.length)
      continue
    }
    if (line.startsWith('deleted file mode ')) {
      cur.deleted = true
      cur.mode = line.slice('deleted file mode '.length)
      continue
    }
    if (line.startsWith('old mode ') || line.startsWith('new mode ')) {
      continue
    }
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      continue
    }
    if (line.startsWith('@@')) {
      finishHunk()
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
      if (m) {
        hunk = {
          oldStart: Number(m[1]),
          oldCount: m[2] === undefined ? 1 : Number(m[2]),
          newStart: Number(m[3]),
          newCount: m[4] === undefined ? 1 : Number(m[4]),
          lines: [],
        }
        cur.hunks.push(hunk)
        oldLine = hunk.oldStart
        newLine = hunk.newStart
        if (cur.hunks.length > 400) { truncated = true; break }
      }
      continue
    }
    if (line === '\\ No newline at end of file') {
      pendingNoNewline = true
      if (hunk && hunk.lines.length > 0) {
        hunk.lines[hunk.lines.length - 1].newline = false
        pendingNoNewline = null
      }
      continue
    }
    if (hunk === null) continue
    if (cur.binary) continue
    const first = line[0]
    if (first === ' ') {
      hunk.lines.push({ type: 'ctx', text: line.slice(1), oldLine: oldLine++, newLine: newLine++, newline: true })
    } else if (first === '+') {
      hunk.lines.push({ type: 'add', text: line.slice(1), oldLine: undefined, newLine: newLine++, newline: true })
    } else if (first === '-') {
      hunk.lines.push({ type: 'del', text: line.slice(1), oldLine: oldLine++, newLine: undefined, newline: true })
    }
    if (hunk.lines.length > maxLinesPerFile) {
      hunk.lines.push({ type: 'ctx', text: '… (hunk truncated by the Git panel)', newline: true })
      truncated = true
      finishHunk()
    }
  }
  finishFile()
  return { files, truncated }
}

/**
 * Parse `git log --pretty=format:%H%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%D%x1e`.
 * @param {string} raw
 * @returns {Array<{ hash: string, parents: string[], author: string, email: string, time: number, subject: string, refs: string[] }>}
 */
export function parseLog(raw) {
  if (raw.trim() === '') return []
  const commits = []
  for (const record of raw.split('\x1e')) {
    const fields = record.split('\0')
    if (fields.length < 7) continue
    const [hash, parents, author, email, time, subject, refsRaw] = fields
    if (!hash) continue
    commits.push({
      hash,
      parents: parents === '' ? [] : parents.split(' '),
      author,
      email,
      time: Number(time) || 0,
      subject: subject || '',
      refs: (refsRaw || '')
        .replace(/^\(|\)$/g, '')
        .split(', ')
        .map((r) => r.trim())
        .filter((r) => r !== ''),
    })
  }
  return commits
}

/**
 * Parse `git for-each-ref` output with `%00` separators:
 * `%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(upstream:track)%00%(HEAD)%00%(subject)`.
 * @param {string} raw
 * @returns {Array<{ name: string, short: string, upstream?: string, track?: string, current: boolean, subject?: string }>}
 */
export function parseRefs(raw) {
  const refs = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    const f = line.split('\0')
    if (f.length < 5) continue
    const name = f[0]
    if (name === '' || name === 'origin/HEAD' || name.endsWith('/HEAD')) continue
    refs.push({
      name,
      short: f[1],
      upstream: f[2] === '' ? undefined : f[2],
      track: f[3] === '' ? undefined : f[3],
      current: f[4] === '*',
      subject: f[5],
    })
  }
  return refs
}

/**
 * Parse `git stash list` with `--pretty=format:%gd%00%H%00%s` (one stash per line).
 * @param {string} raw
 * @returns {Array<{ ref: string, hash: string, subject: string }>}
 */
export function parseStashList(raw) {
  if (raw.trim() === '') return []
  const list = []
  for (const line of raw.split('\n')) {
    const f = line.split('\0')
    if (f.length < 3) continue
    list.push({ ref: f[0], hash: f[1], subject: f[2] })
  }
  return list
}

/**
 * Parse `git remote -v` output into a unique remote list.
 * @param {string} raw
 * @returns {Array<{ name: string, fetch?: string, push?: string }>}
 */
export function parseRemotes(raw) {
  const map = new Map()
  for (const line of raw.split('\n')) {
    const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim())
    if (!m) continue
    if (!map.has(m[1])) map.set(m[1], { name: m[1] })
    const entry = map.get(m[1])
    entry[m[3]] = m[2]
  }
  return [...map.values()]
}
