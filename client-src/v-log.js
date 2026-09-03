/**
 * Commit log view with per-commit revert action.
 */
const { h, ICONS, React } = require('./dom')
const { useStore, setState } = require('./store')
const { t } = require('./i18n')
const { run, confirmThen, getApi, registerTabLoader } = require('./control')

function timeAgo(at) {
  if (!at) return ''
  const delta = Date.now() / 1000 - at
  if (delta < 60) return `${Math.max(1, Math.round(delta))}s`
  if (delta < 3600) return `${Math.round(delta / 60)}m`
  if (delta < 86400) return `${Math.round(delta / 3600)}h`
  if (delta < 86400 * 30) return `${Math.round(delta / 86400)}d`
  return new Date(at * 1000).toLocaleDateString()
}

function LogView() {
  const commits = useStore((s) => s.commits)
  const logError = useStore((s) => s.logError)
  const cwd = useStore((s) => s.cwd)
  const busy = useStore((s) => s.busy)

  React.useEffect(() => {
    registerTabLoader('log', async (w) => {
      const result = await getApi().log(w, 100, null)
      setState({ commits: result.commits, logError: null })
    })
    if (cwd !== null) {
      getApi().log(cwd, 100, null).then((r) => setState({ commits: r.commits, logError: null }))
        .catch((e) => setState({ commits: [], logError: String(e?.message ?? e) }))
    }
  }, [cwd])

  const revertCommit = (commit) => {
    confirmThen({
      body: t('confirm.revert', { commit: commit.hash.slice(0, 8) }),
      action: () => run(t('action.revert'), () => getApi().revert(cwd, commit.hash)),
    })
  }

  if (logError) return h('div', { className: 'gg-empty gg-empty-err' }, logError)
  if (commits.length === 0) return h('div', { className: 'gg-empty' }, t('commit.noCommits'))
  return h('div', { className: 'gg-log' },
    commits.map((c) => h('div', { className: 'gg-log-row', key: c.hash },
      h('div', { className: 'gg-log-main' },
        h('span', { className: 'gg-log-subject' }, c.subject),
        h('span', { className: 'gg-log-meta' },
          c.refs.map((r) => h('span', { className: 'gg-chip', key: r }, r)),
          h('span', { className: 'gg-log-hash' }, c.hash.slice(0, 8)),
          h('span', {}, c.author),
          h('span', { className: 'gg-log-time' }, timeAgo(c.time)),
        )),
      h('button', {
        type: 'button',
        className: 'gg-icon-btn gg-row-btn',
        disabled: busy,
        title: t('action.revert'),
        onClick: () => revertCommit(c),
      }, ICONS.undo),
    )))
}

module.exports = { LogView }
