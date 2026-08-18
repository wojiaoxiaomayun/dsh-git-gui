/**
 * The floating Git panel, registered into `shell.overlay` (list / root scope).
 */
const { h, cx, ICONS, React } = require('./dom')
const { useStore, setState, getState } = require('./store')
const { t } = require('./i18n')
const { applySession, refreshStatus, refreshRemotes, settleConfirm, run, getApi, refreshCheck } = require('./control')
const { StatusView } = require('./v-status')
const { FilesView } = require('./v-files')
const { LogView } = require('./v-log')
// ── Stage 2 功能(代码保留,暂不暴露给用户)────────────────────────────────────
// 分支 / 储藏 / AI 修改 三部分已实现且有测试,但尚未达到发布标准,先对用户隐藏。
// 启用方式:把对应条目加回下方 TABS(import 已保留,view 与 host 端点无需改动)。
const { BranchView } = require('./v-branch')       // 分支管理 (git/branches, git/switchBranch, git/merge, git/pull, git/push, git/fetch)
const { StashView } = require('./v-stash')         // 储藏 (git/stash)
const { TimelineView } = require('./v-timeline')   // AI 修改时间线 (git/activity)

// 当前发布(Stage 1)的标签页:
const TABS = [
  ['status', 'tab.status'],
  ['files', 'tab.files'],
  ['log', 'tab.log'],
  // Stage 2 启用时取消注释:
  // ['branches', 'tab.branches'],
  // ['stash', 'tab.stash'],
  // ['timeline', 'tab.timeline'],
]

function ConfirmModal() {
  const confirm = useStore((s) => s.confirm)
  if (confirm === null) return null
  const danger = confirm.danger === true
  return h('div', { className: 'gg-modal-backdrop', onClick: () => settleConfirm(false) },
    h('div', {
      className: cx('gg-modal', danger && 'gg-modal-danger'),
      onClick: (e) => e.stopPropagation(),
      role: 'dialog',
      'aria-modal': 'true',
    },
      h('div', { className: 'gg-modal-title' },
        h('span', { className: 'gg-modal-icon' }, ICONS.alert),
        t(danger ? 'confirm.dangerTitle' : 'confirm.title')),
      h('div', { className: 'gg-modal-body' }, confirm.body),
      h('div', { className: 'gg-modal-actions' },
        h('button', { type: 'button', className: 'gg-btn', onClick: () => settleConfirm(false) }, t('confirm.cancel')),
        h('button', {
          type: 'button',
          className: cx('gg-btn', danger ? 'gg-btn-danger' : 'gg-btn-primary'),
          autoFocus: true,
          onClick: () => settleConfirm(true),
        }, t('confirm.ok')),
      ),
    ),
  )
}

function Toast() {
  const toast = useStore((s) => s.toast)
  React.useEffect(() => {
    if (toast === null) return undefined
    const id = setTimeout(() => {
      if (getState().toast === toast) setState({ toast: null })
    }, 6000)
    return () => clearTimeout(id)
  }, [toast])
  if (toast === null) return null
  return h('div', { className: cx('gg-toast', toast.kind === 'error' ? 'gg-toast-err' : 'gg-toast-warn') },
    toast.text)
}

function OutputBox() {
  const output = useStore((s) => s.output)
  const [open, setOpen] = React.useState(false)
  if (output === null) return null
  return h('div', { className: 'gg-output' },
    h('button', { type: 'button', className: 'gg-output-head', onClick: () => setOpen(!open) },
      h('span', { className: 'gg-output-title' }, `${t('output.title')}: ${output.title}`),
      h('span', { className: 'gg-output-toggle' }, open ? ICONS.down : ICONS.up)),
    open && h('pre', { className: 'gg-output-body' }, output.text === '' ? t('output.empty') : output.text),
  )
}

function RemoteModal() {
  const openModal = useStore((s) => s.remoteModal)
  const cwd = useStore((s) => s.cwd)
  const busy = useStore((s) => s.busy)
  const [name, setName] = React.useState('origin')
  const [url, setUrl] = React.useState('')
  if (!openModal) return null
  const doAdd = async () => {
    const ok = await run(t('remote.add'), () => getApi().remoteAdd(cwd, name.trim() || 'origin', url.trim()))
    if (ok) {
      setState({ remoteModal: false })
      refreshRemotes(cwd)
    }
  }
  return h('div', { className: 'gg-modal-backdrop', onClick: () => setState({ remoteModal: false }) },
    h('div', { className: 'gg-modal', onClick: (e) => e.stopPropagation(), role: 'dialog', 'aria-modal': 'true' },
      h('div', { className: 'gg-modal-title' }, t('remote.addTitle')),
      h('label', { className: 'gg-field' },
        h('span', { className: 'gg-field-label' }, t('remote.name')),
        h('input', {
          className: 'gg-input', value: name,
          onChange: (e) => setName(e.target.value),
        })),
      h('label', { className: 'gg-field' },
        h('span', { className: 'gg-field-label' }, 'URL'),
        h('input', {
          className: 'gg-input', value: url, autoFocus: true,
          placeholder: t('remote.url.placeholder'),
          onChange: (e) => setUrl(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Enter') doAdd() },
        })),
      h('div', { className: 'gg-modal-body' }, t('remote.sshNote')),
      h('div', { className: 'gg-modal-actions' },
        h('button', { type: 'button', className: 'gg-btn', onClick: () => setState({ remoteModal: false }) }, t('confirm.cancel')),
        h('button', {
          type: 'button',
          className: 'gg-btn gg-btn-primary',
          disabled: busy || url.trim() === '',
          onClick: doAdd,
        }, t('remote.add'))),
    ),
  )
}

function WorkspaceBar() {
  const check = useStore((s) => s.check)
  const status = useStore((s) => s.status)
  const busy = useStore((s) => s.busy)
  const busyLabel = useStore((s) => s.busyLabel)
  const cwd = useStore((s) => s.cwd)
  const remotes = useStore((s) => s.remotes)
  const branch = status?.branch
  const root = check?.root
  const name = typeof root === 'string' && root !== ''
    ? root.split(/[\\/]/).filter(Boolean).pop()
    : t('status.checking')

  const requireRemote = (action) => {
    if ((remotes ?? []).length === 0) {
      setState({ remoteModal: true, toast: { kind: 'warn', text: t('remote.emptyHint') } })
      return
    }
    action()
  }

  const doPull = () => requireRemote(() => run(t('action.pull'), () => getApi().pull(cwd, 'ff-only')))
  const doPush = () => requireRemote(() => run(t('action.push'), () => getApi().push(cwd)))
  const doFetch = () => requireRemote(() => run(t('action.fetch'), () => getApi().fetch(cwd)))

  return h('div', { className: 'gg-wsbar' },
    h('span', { className: 'gg-ws-name', title: root ?? undefined },
      h('span', { className: 'gg-ws-icon' }, ICONS.folder),
      name),
    branch?.head
      ? h('span', { className: 'gg-ws-branch' }, ICONS.branch, branch.head)
      : branch?.detached
        ? h('span', { className: 'gg-ws-branch gg-ws-detached' }, t('commit.detached'))
        : null,
    (branch?.ahead || branch?.behind)
      ? h('span', { className: 'gg-ws-ab' }, t('commit.aheadBehind', { a: branch.ahead ?? 0, b: branch.behind ?? 0 }))
      : null,
    h('span', { className: 'gg-ws-spacer' }),
    busy && h('span', { className: 'gg-ws-busy' }, busyLabel || t('commit.busy')),
    h('button', {
      type: 'button', className: 'gg-mini-btn', disabled: busy, title: 'git pull --ff-only',
      onClick: doPull,
    }, ICONS.down, 'Pull'),
    h('button', {
      type: 'button', className: 'gg-mini-btn', disabled: busy, title: 'git push',
      onClick: doPush,
    }, ICONS.up, 'Push'),
    h('button', {
      type: 'button', className: 'gg-mini-btn', disabled: busy, title: 'git fetch --all --prune',
      onClick: doFetch,
    }, ICONS.refresh, 'Fetch'),
    h('button', {
      type: 'button', className: cx('gg-icon-btn', (remotes ?? []).length === 0 && 'gg-icon-warn'),
      title: (remotes ?? []).length === 0 ? t('remote.emptyHint') : t('misc.remote'),
      onClick: () => setState({ remoteModal: true }),
    }, ICONS.globe),
    h('button', { type: 'button', className: 'gg-icon-btn', title: t('action.refresh'), onClick: () => refreshStatus() }, ICONS.refresh),
  )
}

function GitPanel(props) {
  const sessions = props.useSessions((s) => s)
  React.useEffect(() => {
    applySession(sessions)
  }, [sessions])
  const open = useStore((s) => s.open)
  const cwd = useStore((s) => s.cwd)
  const running = useStore((s) => s.sessionRunning)
  const check = useStore((s) => s.check)
  const busy = useStore((s) => s.busy)
  const [width, setWidth] = React.useState(460)
  const [tab, setTabLocal] = React.useState('status')
  const dragRef = React.useRef(null)

  React.useEffect(() => {
    setState({ tab })
  }, [tab])

  const onTab = (next) => {
    setTabLocal(next)
    setState({ tab: next })
  }

  const onDragStart = (e) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    dragRef.current = { startX, startW }
    const move = (ev) => {
      if (!dragRef.current) return
      const dx = startX - ev.clientX
      setWidth(Math.max(340, Math.min(800, startW + dx)))
    }
    const up = () => {
      dragRef.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  if (!open) return null

  let body = null
  if (cwd === null) {
    body = h('div', { className: 'gg-empty' }, t('status.noSession'))
  } else if (check === null) {
    body = h('div', { className: 'gg-empty' }, t('status.checking'))
  } else if (check.repo === false) {
    body = h('div', { className: 'gg-empty' },
      check.nested > 0
        ? h('div', { className: 'gg-empty-title' }, `检测到 ${check.nested} 个嵌套 Git 仓库(位于工作区子目录),暂不支持多仓库,请将会话工作区指向其中一个仓库目录`)
        : h('div', { className: 'gg-empty-title' }, check.gitVersion === '' ? t('status.noGit') : t('status.notRepo')),
      check.nested > 0 ? null : h('button', {
        type: 'button',
        className: 'gg-btn gg-btn-primary',
        disabled: busy,
        onClick: () => initRepo(cwd),
      }, t('action.init')))
  } else {
    body = h('div', { className: 'gg-tabs' },
      h('div', { className: 'gg-tabbar', role: 'tablist' },
        TABS.map(([key, label]) => h('button', {
          type: 'button',
          role: 'tab',
          key,
          className: cx('gg-tab', tab === key && 'gg-tab-active'),
          onClick: () => onTab(key),
        }, t(label)))),
      h('div', { className: 'gg-tabbody' },
        tab === 'status' && h(StatusView, {}),
        tab === 'files' && h(FilesView, {}),
        tab === 'log' && h(LogView, {}),
        tab === 'branches' && h(BranchView, {}),
        tab === 'stash' && h(StashView, {}),
        tab === 'timeline' && h(TimelineView, {}),
      ),
    )
  }

  return h('div', { className: 'gg-panel', style: { width: `${width}px` } },
    h('div', { className: 'gg-resize', onPointerDown: onDragStart }),
    h('div', { className: 'gg-panel-head' },
      h('span', { className: 'gg-panel-title' }, t('panel.title')),
      h('button', { type: 'button', className: 'gg-icon-btn', title: t('panel.close'), onClick: () => setState({ open: false }) }, ICONS.close)),
    running && h('div', { className: 'gg-banner' }, ICONS.robot, t('timeline.running')),
    h(WorkspaceBar, {}),
    h(OutputBox, {}),
    h('div', { className: 'gg-panel-body' }, body),
    h(RemoteModal, {}),
    h(ConfirmModal, {}),
    h(Toast, {}),
  )
}

async function initRepo(cwd) {
  const ok = await run(t('action.init'), async () => getApi().init(cwd))
  if (ok) await refreshCheck()
}

module.exports = { GitPanel }
