/**
 * Status view: staged/unstaged/untracked/conflict groups, commit box, diff pane.
 */
const { h, cx, ICONS, React } = require('./dom')
const { useStore, setState, getState } = require('./store')
const { t } = require('./i18n')
const { run, confirmThen, getApi, refreshDiff } = require('./control')

const LETTER_CLASS = {
  M: 'gg-l-m', A: 'gg-l-a', D: 'gg-l-d', R: 'gg-l-r', C: 'gg-l-c', U: 'gg-l-u', '?': 'gg-l-q', T: 'gg-l-t',
}

function groupFiles(status) {
  const staged = []
  const unstaged = []
  const untracked = []
  const conflicts = []
  for (const f of status?.files ?? []) {
    const conflict = f.x === 'U' || f.y === 'U'
    if (conflict) conflicts.push(f)
    if (f.x === '?') untracked.push(f)
    else {
      if (f.x !== ' ' && f.x !== '.' && !conflict) staged.push(f)
      if (f.y !== ' ' && f.y !== '.' && f.x !== '?' && !conflict) unstaged.push(f)
    }
  }
  return { staged, unstaged, untracked, conflicts }
}

function FileRow({ file, kind, onOpen, onToggle, onDiscard }) {
  const display = kind === 'staged' ? file.x : kind === 'untracked' ? '?' : file.y
  const renamed = display === 'R' || file.origPath !== undefined
  const name = file.path.split('/').pop()
  const dir = file.path.includes('/') ? file.path.slice(0, file.path.length - name.length) : ''
  const sub = file.sub.startsWith('S') ? ' (submodule)' : ''

  return h('div', {
    className: cx('gg-file', kind === 'conflict' && 'gg-file-conflict'),
    onClick: () => onOpen(),
    title: file.path + sub,
  },
    h('button', {
      type: 'button',
      className: cx('gg-letter', LETTER_CLASS[display]),
      title: t('action.stage'),
      onClick: (e) => { e.stopPropagation(); onToggle() },
    }, display),
    h('span', { className: 'gg-file-main' },
      h('span', { className: 'gg-file-dir' }, dir),
      h('span', { className: 'gg-file-name' }, name + sub),
      renamed && h('span', { className: 'gg-file-renamed' }, `← ${file.origPath}`)),
    onDiscard && h('button', {
      type: 'button',
      className: 'gg-icon-btn gg-row-btn',
      title: t('action.discard'),
      onClick: (e) => { e.stopPropagation(); onDiscard() },
    }, ICONS.undo),
  )
}

function Group({ label, files, kind, onOpen, onToggle, onDiscard, extra }) {
  if (files.length === 0 && extra === undefined) return null
  return h('div', { className: 'gg-group' },
    h('div', { className: 'gg-group-head' },
      h('span', { className: 'gg-group-name' }, t(label)),
      h('span', { className: 'gg-group-count' }, files.length),
      extra),
    h('div', { className: 'gg-group-body' },
      files.map((f) => h(FileRow, {
        key: `${kind}:${f.path}`,
        file: f,
        kind,
        onOpen: () => onOpen(f, kind),
        onToggle: () => onToggle(f, kind),
        onDiscard: onDiscard ? () => onDiscard(f, kind) : undefined,
      }))))
}

function CommitBox() {
  const msg = useStore((s) => s.commitMsg)
  const identity = useStore((s) => s.identity)
  const status = useStore((s) => s.status)
  const busy = useStore((s) => s.busy)
  const cwd = useStore((s) => s.cwd)
  const groups = groupFiles(status)
  const stagedCount = groups.staged.length

  const [aiBusy, setAiBusy] = React.useState(false)

  const doCommit = async () => {
    if (msg.trim() === '') return
    const ok = await run(t('action.commit'), () => getApi().commit(cwd, msg.trim()))
    if (ok) setState({ commitMsg: '' })
  }
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      doCommit()
    }
  }
  const stageAll = async () => {
    const paths = [...groups.unstaged, ...groups.untracked].map((f) => f.path)
    if (paths.length === 0) return
    await run(t('action.stageAll'), () => getApi().stage(cwd, paths))
  }

  const aiGenerate = async () => {
    if (busy || aiBusy) return
    setAiBusy(true)
    try {
      const result = await getApi().generateCommitMessage(cwd)
      if (result && result.ok && result.message) {
        setState({ commitMsg: result.message })
      }
    } catch (error) {
      setState({ toast: { kind: 'error', text: String(error?.message ?? error) } })
    } finally {
      setAiBusy(false)
    }
  }

  return h('div', { className: 'gg-commit' },
    h('textarea', {
      className: 'gg-commit-input',
      value: msg,
      placeholder: t('commit.placeholder'),
      rows: 3,
      onChange: (e) => setState({ commitMsg: e.target.value }),
      onKeyDown,
    }),
    h('div', { className: 'gg-commit-foot' },
      identity
        ? h('span', { className: 'gg-identity', title: t('commit.identity') },
          `${t('commit.identity')} ${identity.name ?? '?'} <${identity.email ?? '?'}>`)
        : h('span', { className: 'gg-identity gg-identity-missing' }, t('commit.identityMissing')),
      h('span', { className: 'gg-spacer' }),
      h('button', {
        type: 'button',
        className: 'gg-mini-btn',
        disabled: busy || aiBusy || stagedCount === 0,
        title: t('action.aiCommitTooltip'),
        onClick: aiGenerate,
      }, aiBusy ? '…' : t('action.aiCommit')),
      h('button', { type: 'button', className: 'gg-btn', disabled: busy || aiBusy, onClick: stageAll }, t('action.stageAll')),
      h('button', {
        type: 'button',
        className: 'gg-btn gg-btn-primary',
        disabled: busy || stagedCount === 0 || msg.trim() === '',
        onClick: doCommit,
        title: stagedCount === 0 ? t('commit.hint') : undefined,
      }, `${t('action.commit')}${stagedCount > 0 ? ` (${stagedCount})` : ''}`),
    ),
  )
}

function DiffPane() {
  const selected = useStore((s) => s.selected)
  const diff = useStore((s) => s.diff)
  if (selected === null) {
    return h('div', { className: 'gg-diff' }, h('div', { className: 'gg-empty' }, t('diff.empty')))
  }
  if (diff === null || diff.loading) {
    return h('div', { className: 'gg-diff' }, h('div', { className: 'gg-empty' }, t('status.loading')))
  }
  if (diff.error !== null) {
    return h('div', { className: 'gg-diff' }, h('div', { className: 'gg-empty gg-empty-err' }, diff.error))
  }
  // file-content mode (clean files opened from the tree view)
  if (selected.cat === true) {
    const data = diff.data ?? {}
    const lines = (data.content ?? '').split('\n')
    const hasTrailing = lines.length > 1 && lines[lines.length - 1] === ''
    if (hasTrailing) lines.pop()
    return h('div', { className: 'gg-diff' },
      h('div', { className: 'gg-diff-head' },
        h('span', { className: 'gg-diff-path' }, selected.path),
        h('span', { className: 'gg-chip' }, t('cat.title'))),
      h('div', { className: 'gg-diff-scroll' },
        data.binary
          ? h('div', { className: 'gg-empty' }, t('diff.binary'))
          : data.tooLarge
            ? h('div', { className: 'gg-empty' }, t('diff.tooLarge', { size: data.size }))
            : h('div', { className: 'gg-hunks' },
              lines.map((text, i) => h('div', { className: 'gg-line gg-line-ctx', key: i },
                h('span', { className: 'gg-line-no' }, ''),
                h('span', { className: 'gg-line-no' }, i + 1),
                h('span', { className: 'gg-line-mark' }, ' '),
                h('span', { className: 'gg-line-text' }, text || ' '))))),
    )
  }
  const file = diff.data?.diff?.files?.[0]
  if (!file) {
    return h('div', { className: 'gg-diff' }, h('div', { className: 'gg-empty' }, t('diff.empty')))
  }
  return h('div', { className: 'gg-diff' },
    h('div', { className: 'gg-diff-head' },
      h('span', { className: 'gg-diff-path' }, file.newPath),
      selected.staged && h('span', { className: 'gg-chip' }, t('group.staged')),
      selected.untracked && h('span', { className: 'gg-chip' }, t('diff.newFile')),
      (file.oldPath && file.oldPath !== file.newPath) && h('span', { className: 'gg-diff-rename' }, `${file.oldPath} → ${file.newPath}`),
    ),
    h('div', { className: 'gg-diff-scroll' },
      file.binary
        ? h('div', { className: 'gg-empty' }, t('diff.binary'))
        : file.tooLarge
          ? h('div', { className: 'gg-empty' }, t('diff.tooLarge', { size: file.size }))
          : file.hunks.length === 0
            ? h('div', { className: 'gg-empty' }, t('group.clean'))
            : h('div', { className: 'gg-hunks' },
              file.hunks.map((hunk, i) => h('div', { className: 'gg-hunk', key: i },
                h('div', { className: 'gg-hunk-head' }, `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`),
                hunk.lines.map((line, j) => h('div', {
                  className: cx('gg-line', line.type === 'add' ? 'gg-line-add' : line.type === 'del' ? 'gg-line-del' : 'gg-line-ctx'),
                  key: j,
                },
                  h('span', { className: 'gg-line-no' }, line.oldLine ?? ''),
                  h('span', { className: 'gg-line-no' }, line.newLine ?? ''),
                  h('span', { className: 'gg-line-mark' }, line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '),
                  h('span', { className: 'gg-line-text' }, line.text || ' '),
                  line.newline === false && h('span', { className: 'gg-line-nonl' }, '⏎'),
                ))))),
    ),
  )
}

function StatusView() {
  const status = useStore((s) => s.status)
  const statusError = useStore((s) => s.statusError)
  const cwd = useStore((s) => s.cwd)
  const busy = useStore((s) => s.busy)
  const groups = groupFiles(status)

  React.useEffect(() => {
    // load identity once per workspace
    if (cwd !== null) {
      getApi().identity(cwd).then((r) => setState({ identity: r })).catch(() => {})
    }
  }, [cwd])

  const openDiff = (file, kind) => {
    const sel = { path: file.path, staged: kind === 'staged', untracked: kind === 'untracked', cat: false }
    setState({ selected: sel, diff: { ...sel, loading: true, error: null, data: null } })
    refreshDiff()
  }

  const toggle = (file, kind) => {
    const fn = kind === 'staged'
      ? () => getApi().unstage(cwd, [file.path])
      : () => getApi().stage(cwd, [file.path])
    run(kind === 'staged' ? t('action.unstage') : t('action.stage'), fn).then(() => {
      const sel = getState().selected
      if (sel && sel.path === file.path) refreshDiff()
    })
  }

  const discard = (file, kind) => {
    confirmThen({
      danger: true,
      body: kind === 'untracked'
        ? t('confirm.cleanFile', { name: file.path })
        : t('confirm.discardFile', { name: file.path }),
      action: () => run(t('action.discard'), () => getApi().discard(cwd, [file.path], kind === 'untracked')).then(() => {
        const sel = getState().selected
        if (sel && sel.path === file.path) setState({ selected: null, diff: null })
      }),
    })
  }

  const unstageAll = () => {
    const paths = groups.staged.map((f) => f.path)
    if (paths.length === 0) return
    run(t('action.unstageAll'), () => getApi().unstage(cwd, paths))
  }

  const total = (status?.files ?? []).length
  return h('div', { className: 'gg-status' },
    h(CommitBox, {}),
    statusError
      ? h('div', { className: 'gg-empty gg-empty-err' }, `${t('status.error')}: ${statusError}`)
      : total === 0
        ? h('div', { className: 'gg-empty' }, t('group.clean'))
        : h('div', { className: 'gg-status-main' },
          h('div', { className: 'gg-files' },
            h(Group, {
              label: 'group.conflicts', files: groups.conflicts, kind: 'conflict',
              onOpen: openDiff, onToggle: (f) => { openDiff(f, 'conflict') },
            }),
            h(Group, {
              label: 'group.staged', files: groups.staged, kind: 'staged',
              onOpen: openDiff, onToggle: toggle,
              extra: groups.staged.length > 0 && h('button', { type: 'button', className: 'gg-mini-btn', disabled: busy, onClick: unstageAll }, t('action.unstageAll')),
            }),
            h(Group, {
              label: 'group.changes', files: groups.unstaged, kind: 'unstaged',
              onOpen: openDiff, onToggle: toggle, onDiscard: discard,
            }),
            h(Group, {
              label: 'group.untracked', files: groups.untracked, kind: 'untracked',
              onOpen: openDiff, onToggle: toggle, onDiscard: discard,
            })),
          h(DiffPane, {}),
        ),
  )
}

module.exports = { StatusView }
