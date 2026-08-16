/**
 * Stash view: list, push, pop, apply, drop.
 */
const { h, cx, React } = require('./dom')
const { useStore, setState } = require('./store')
const { t } = require('./i18n')
const { run, confirmThen, getApi, registerTabLoader } = require('./control')

function StashView() {
  const stashes = useStore((s) => s.stashes)
  const cwd = useStore((s) => s.cwd)
  const busy = useStore((s) => s.busy)
  const [msg, setMsg] = React.useState('')

  React.useEffect(() => {
    registerTabLoader('stash', async (w) => {
      const result = await getApi().stash(w, 'list', null, null)
      setState({ stashes: result.stashes })
    })
    if (cwd !== null) {
      getApi().stash(cwd, 'list', null, null).then((r) => setState({ stashes: r.stashes })).catch(() => {})
    }
  }, [cwd])

  const doPush = () => run(t('action.stashPush'), () => getApi().stash(cwd, 'push', msg.trim() || null, null))
  const doPop = (ref) => confirmThen({
    body: t('confirm.popStash', { ref }),
    action: () => run(t('action.pop'), () => getApi().stash(cwd, 'pop', null, ref)),
  })
  const doApply = (ref) => run(t('action.apply'), () => getApi().stash(cwd, 'apply', null, ref))
  const doDrop = (ref) => confirmThen({
    danger: true,
    body: t('confirm.dropStash', { ref }),
    action: () => run(t('action.drop'), () => getApi().stash(cwd, 'drop', null, ref)),
  })

  return h('div', { className: 'gg-stash' },
    h('div', { className: 'gg-stash-new' },
      h('input', {
        className: 'gg-input',
        value: msg,
        placeholder: t('stash.placeholder'),
        onChange: (e) => setMsg(e.target.value),
        onKeyDown: (e) => { if (e.key === 'Enter') doPush() },
      }),
      h('button', { type: 'button', className: 'gg-btn gg-btn-primary', disabled: busy, onClick: doPush }, t('action.stashPush'))),
    stashes.length === 0
      ? h('div', { className: 'gg-empty' }, t('stash.empty'))
      : h('div', { className: 'gg-stash-list' },
        h('div', { className: 'gg-group-name' }, t('stash.list')),
        stashes.map((s) => h('div', { className: 'gg-stash-row', key: s.ref },
          h('span', { className: 'gg-stash-ref' }, s.ref),
          h('span', { className: 'gg-stash-subject' }, s.subject),
          h('span', { className: 'gg-spacer' }),
          h('button', { type: 'button', className: 'gg-mini-btn', disabled: busy, onClick: () => doApply(s.ref) }, t('action.apply')),
          h('button', { type: 'button', className: 'gg-mini-btn', disabled: busy, onClick: () => doPop(s.ref) }, t('action.pop')),
          h('button', { type: 'button', className: 'gg-mini-btn gg-mini-danger', disabled: busy, onClick: () => doDrop(s.ref) }, t('action.drop')),
        ))))
}

module.exports = { StashView }
