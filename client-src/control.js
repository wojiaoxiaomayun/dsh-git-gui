/**
 * Panel controller: workspace/session sync, polling, and operation runner.
 * Shared by the sidebar entry button and the overlay panel.
 */
const { setState, getState, resetWorkspace } = require('./store')

let api = null
let pollTimer = null
let pollActive = false
let tabLoaders = {}   // tab -> loader fn
let lastBadgeAt = 0

function startController(gitApi) {
  api = gitApi
  if (pollTimer !== null) return
  pollTimer = setInterval(() => {
    try {
      tick()
    } catch { /* poller must never throw */ }
  }, 1000)
  if (pollTimer.unref) pollTimer.unref()
}

function getApi() {
  return api
}

/**
 * Apply a sessions snapshot (already selected via the useSessions hook in a
 * component) to the store: session id, workspace cwd, and running flag.
 * Called from effects only (never during render).
 */
function applySession(sessions) {
  const currentId = sessions.current
  const summary = currentId !== undefined ? sessions.byId[currentId] : undefined
  const cwd = typeof summary?.cwd === 'string' && summary.cwd !== '' ? summary.cwd : null
  const running = summary?.running === true
  const s = getState()
  if (s.sessionRunning !== running) setState({ sessionRunning: running })
  if (s.sessionId !== currentId || (cwd !== null && s.cwd !== cwd)) {
    if (cwd !== null && s.cwd !== cwd) {
      resetWorkspace(cwd, currentId ?? null)
      refreshCheck()
      refreshStatus()
      refreshRemotes()
      refreshTabData()
    } else if (cwd === null && s.cwd !== null) {
      resetWorkspace(null, currentId ?? null)
    } else if (currentId !== undefined && s.sessionId !== currentId) {
      setState({ sessionId: currentId })
    }
  }
}

/** Load the configured remotes for the current workspace. */
async function refreshRemotes() {
  const s = getState()
  if (!api || s.cwd === null) return
  try {
    const result = await api.remoteList(s.cwd)
    setState({ remotes: result.remotes ?? [] })
  } catch {
    setState({ remotes: [] })
  }
}

function tick() {
  const s = getState()
  if (s.cwd === null || s.check?.repo !== true) return
  if (s.busy) return
  if (s.open) {
    refreshStatus()
  } else if (Date.now() - lastBadgeAt >= 5000) {
    lastBadgeAt = Date.now()
    refreshStatus()
  }
}

async function refreshCheck() {
  const s = getState()
  if (!api || s.cwd === null) return
  try {
    const result = await api.check(s.cwd)
    setState({ check: result, version: result.gitVersion ?? s.version })
    if (result.repo) refreshStatus()
  } catch (error) {
    setState({ check: { repo: false, gitVersion: '', error: error.message } })
  }
}

async function refreshStatus() {
  const s = getState()
  if (!api || s.cwd === null || s.check?.repo !== true) return
  if (s.busy) return
  try {
    const result = await api.status(s.cwd)
    setState({ status: result, statusError: null, statusAt: Date.now() })
  } catch (error) {
    setState({ statusError: String(error?.message ?? error) })
  }
}

async function refreshDiff() {
  const s = getState()
  const selected = s.selected
  if (!api || s.cwd === null || selected === null) return
  const key = { ...selected }
  setState({ diff: { ...key, loading: true, error: null, data: null } })
  try {
    const result = selected.cat === true
      ? await api.cat(s.cwd, selected.path)
      : await api.diff(s.cwd, selected.path, selected.staged, null, selected.untracked)
    const current = getState()
    const cur = current.selected
    if (cur === null || cur.path !== selected.path || cur.staged !== selected.staged || cur.untracked !== selected.untracked) return
    setState({ diff: { ...key, loading: false, error: null, data: result } })
  } catch (error) {
    const current = getState()
    const cur = current.selected
    if (cur === null || cur.path !== selected.path) return
    setState({ diff: { ...key, loading: false, error: String(error?.message ?? error), data: null } })
  }
}

function registerTabLoader(tab, loader) {
  tabLoaders[tab] = loader
}

async function refreshTabData() {
  const s = getState()
  const loader = tabLoaders[s.tab]
  if (loader && s.cwd !== null && s.check?.repo === true) {
    try {
      await loader(s.cwd)
    } catch (error) {
      setState({ toast: { kind: 'error', text: String(error?.message ?? error) } })
    }
  }
}

/** Run one user operation: busy state, error toast, refresh afterwards. */
async function run(label, fn, refresh = true) {
  const s = getState()
  if (s.busy) {
    setState({ toast: { kind: 'warn', text: require('./i18n').t('toast.busy') } })
    return false
  }
  setState({ busy: true, busyLabel: label })
  try {
    const result = await fn()
    if (result && result.output !== undefined && result.output !== '') {
      setState({ output: { title: label, text: result.output } })
    }
    if (refresh) {
      await Promise.allSettled([refreshStatus(), refreshDiff(), refreshTabData()])
    }
    return true
  } catch (error) {
    setState({
      toast: { kind: 'error', text: String(error?.message ?? error) },
      output: { title: label, text: String(error?.detail ?? error?.message ?? error) },
    })
    if (refresh) await refreshStatus().catch(() => {})
    return false
  } finally {
    setState({ busy: false, busyLabel: '' })
  }
}

/** Ask a confirmation, then run the operation when confirmed. */
function confirmThen({ title, body, danger, action }) {
  setState({ confirm: { title, body, danger, action } })
}

/** Settle the open confirm dialog: run the stored action when ok=true. */
function settleConfirm(ok) {
  const s = getState()
  const confirm = s.confirm
  setState({ confirm: null })
  if (ok && confirm) {
    const action = confirm.action
    setTimeout(() => { action() }, 0)
  }
}

module.exports = {
  startController,
  getApi,
  applySession,
  refreshCheck,
  refreshStatus,
  refreshDiff,
  refreshRemotes,
  refreshTabData,
  registerTabLoader,
  run,
  confirmThen,
  settleConfirm,
}
