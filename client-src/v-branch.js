/**
 * Branches view: local/remote refs, switch/create, merge, pull/push/fetch.
 */
const { h, cx, ICONS, React } = require('./dom')
const { useStore, setState } = require('./store')
const { t } = require('./i18n')
const { run, confirmThen, getApi, registerTabLoader } = require('./control')

function BranchView() {
  const refs = useStore((s) => s.refs)
  const remotes = useStore((s) => s.remotes)
  const refsError = useStore((s) => s.refsError)
  const cwd = useStore((s) => s.cwd)
  const busy = useStore((s) => s.busy)
  const branch = useStore((s) => s.status?.branch)
  const [newName, setNewName] = React.useState('')

  React.useEffect(() => {
    registerTabLoader('branches', async (w) => {
      const result = await getApi().branches(w)
      setState({ refs: result.refs, remotes: result.remotes, refsError: null })
    })
    if (cwd !== null) {
      getApi().branches(cwd).then((r) => setState({ refs: r.refs, remotes: r.remotes, refsError: null }))
        .catch((e) => setState({ refs: [], remotes: [], refsError: e.message }))
    }
  }, [cwd])

  const local = refs.filter((r) => !r.name.includes('/') && !r.name.startsWith('remotes/'))
  const remote = refs.filter((r) => r.name.includes('/'))

  const doSwitch = (name) => {
    confirmThen({
      body: t('confirm.switch', { name }),
      action: () => run(t('action.switch'), () => getApi().switchBranch(cwd, name, false)),
    })
  }
  const doMerge = (name) => {
    confirmThen({
      body: t('confirm.merge', { ref: name }),
      action: () => run(t('action.merge'), () => getApi().merge(cwd, name)),
    })
  }
  const doCreate = () => {
    const name = newName.trim()
    if (name === '') return
    run(t('action.newBranch'), () => getApi().switchBranch(cwd, name, true)).then((ok) => {
      if (ok) setNewName('')
    })
  }
  const doPull = (mode) => run(`${t('action.pull')} (${mode})`, () => getApi().pull(cwd, mode))
  const doPush = () => run(t('action.push'), () => getApi().push(cwd))
  const doFetch = () => run(t('action.fetch'), () => getApi().fetch(cwd))

  const row = (r, kind) => h('div', {
    className: cx('gg-ref-row', r.current && 'gg-ref-current'),
    key: r.name,
    title: r.name,
  },
    h('button', {
      type: 'button',
      className: 'gg-ref-name',
      disabled: busy || r.current,
      onClick: () => (kind === 'local' ? doSwitch(r.name) : undefined),
    },
      ICONS.branch,
      h('span', {}, r.name),
      r.current && h('span', { className: 'gg-chip' }, t('branch.current')),
      r.upstream && h('span', { className: 'gg-ref-upstream' }, `→ ${r.upstream}${r.track ? ` [${r.track}]` : ''}`)),
    !r.current && kind === 'local' && h('button', {
      type: 'button',
      className: 'gg-mini-btn',
      disabled: busy,
      onClick: () => doMerge(r.name),
    }, t('action.merge')))

  return h('div', { className: 'gg-branches' },
    h('div', { className: 'gg-branch-actions' },
      h('button', { type: 'button', className: 'gg-btn', disabled: busy, onClick: () => doPull('ff-only') }, 'Pull (ff)'),
      h('button', { type: 'button', className: 'gg-btn', disabled: busy, onClick: () => doPull('merge') }, 'Pull (merge)'),
      h('button', { type: 'button', className: 'gg-btn', disabled: busy, onClick: () => doPull('rebase') }, 'Pull (rebase)'),
      h('button', { type: 'button', className: 'gg-btn', disabled: busy, onClick: doPush }, t('action.push')),
      h('button', { type: 'button', className: 'gg-btn', disabled: busy, onClick: doFetch }, t('action.fetch'))),
    refsError && h('div', { className: 'gg-empty gg-empty-err' }, refsError),
    branch?.detached && h('div', { className: 'gg-banner' }, t('commit.detached')),
    h('div', { className: 'gg-branch-new' },
      h('input', {
        className: 'gg-input',
        value: newName,
        placeholder: t('branch.create.placeholder'),
        onChange: (e) => setNewName(e.target.value),
        onKeyDown: (e) => { if (e.key === 'Enter') doCreate() },
      }),
      h('button', { type: 'button', className: 'gg-btn gg-btn-primary', disabled: busy || newName.trim() === '', onClick: doCreate }, t('action.newBranch'))),
    h('div', { className: 'gg-ref-group' },
      h('div', { className: 'gg-group-name' }, t('branch.local')),
      local.map((r) => row(r, 'local'))),
    remote.length > 0 && h('div', { className: 'gg-ref-group' },
      h('div', { className: 'gg-group-name' }, t('branch.remote')),
      remote.map((r) => row(r, 'remote'))),
    remotes.length > 0 && h('div', { className: 'gg-ref-group' },
      h('div', { className: 'gg-group-name' }, t('misc.remote')),
      remotes.map((r) => h('div', { className: 'gg-remote-row', key: r.name },
        h('span', {}, r.name), h('span', { className: 'gg-remote-url' }, r.fetch ?? r.push ?? '')))),
  )
}

module.exports = { BranchView }
