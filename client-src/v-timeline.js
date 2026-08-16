/**
 * AI edit timeline: mutations attributed to (session, turn, tool, path).
 * Clicking a row opens the current diff of that path.
 */
const { h, cx, React } = require('./dom')
const { useStore, setState, getState } = require('./store')
const { t } = require('./i18n')
const { getApi, registerTabLoader, refreshDiff } = require('./control')

function TimelineView() {
  const activity = useStore((s) => s.activity)
  const cwd = useStore((s) => s.cwd)

  React.useEffect(() => {
    registerTabLoader('timeline', async (w) => {
      const result = await getApi().activity(w, 100)
      setState({ activity: result.entries })
    })
    if (cwd !== null) {
      getApi().activity(cwd, 100).then((r) => setState({ activity: r.entries })).catch(() => {})
    }
  }, [cwd])

  const openPath = (entry) => {
    // make the path relative to the effective repo root (nested repos are
    // supported: check.root may be deeper than the session cwd)
    let path = entry.path
    const root = getState().check?.root
    if (root && path.toLowerCase().startsWith(root.toLowerCase())) {
      path = path.slice(root.length).replace(/^[\\/]+/, '')
    }
    // untracked files have no worktree diff: open the untracked content preview
    const status = getState().status
    const statusFile = status?.files?.find((f) => f.path === path)
    const untracked = statusFile !== undefined && statusFile.x === '?'
    const sel = { path, staged: false, untracked, cat: false }
    setState({ selected: sel, diff: { ...sel, loading: true, error: null, data: null }, tab: 'status' })
    refreshDiff()
  }

  if (activity.length === 0) {
    return h('div', { className: 'gg-empty' }, t('timeline.empty'))
  }
  return h('div', { className: 'gg-timeline' },
    h('div', { className: 'gg-group-name' }, t('timeline.title')),
    activity.map((e, i) => h('button', {
      type: 'button',
      className: 'gg-tl-row',
      key: i,
      onClick: () => openPath(e),
      title: e.path,
    },
      h('span', { className: 'gg-tl-tool' }, e.tool),
      h('span', { className: 'gg-tl-path' }, e.path),
      h('span', { className: 'gg-spacer' }),
      h('span', { className: 'gg-tl-meta' },
        t('timeline.turn', { turn: e.turn }),
        ' · ',
        e.sessionId.slice(0, 8),
        ' · ',
        new Date(e.at).toLocaleTimeString())),
    ))
}

module.exports = { TimelineView }
