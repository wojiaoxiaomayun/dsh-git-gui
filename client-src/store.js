/**
 * Tiny observable store for the Git panel (useSyncExternalStore-based).
 */
const React = require('react')

const initial = {
  open: false,
  tab: 'status',
  busy: false,
  busyLabel: '',
  cwd: null,          // absolute workspace root of the current session
  sessionId: null,
  sessionRunning: false,
  check: null,        // {repo, root, gitVersion}
  status: null,       // {branch, files}
  statusError: null,
  statusAt: 0,
  selected: null,     // {path, staged, untracked, cat}
  diff: null,         // {path, staged, untracked, cat, loading, error, data}
  commits: [],
  logError: null,
  refs: [],
  remotes: [],
  refsError: null,
  stashes: [],
  stashError: null,
  activity: [],
  identity: null,
  tree: null,          // {files:[{path,state}], truncated, total}
  treeError: null,
  remotes: [],         // [{name, fetch?, push?}]
  remoteModal: false,  // "添加远程仓库" 弹窗
  commitMsg: '',
  output: null,       // {title, text}
  confirm: null,      // {title, body, danger, action, args}
  toast: null,        // {kind, text}
  version: null,
}

let state = initial
const listeners = new Set()

function getState() {
  return state
}

function setState(patch) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

function resetWorkspace(cwd, sessionId) {
  state = {
    ...initial,
    cwd,
    sessionId,
    sessionRunning: state.sessionRunning,
    open: state.open,
    tab: state.tab,
    commitMsg: state.commitMsg,
    version: state.version,
  }
  for (const listener of listeners) listener()
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function useStore(selector) {
  const ref = React.useRef(undefined)
  const getSnapshot = React.useCallback(() => {
    const next = selector(state)
    if (next !== ref.current) ref.current = next
    return ref.current
  }, [selector])
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Convenience hook: open flag. */
function useOpen() {
  return useStore((s) => s.open)
}

module.exports = { getState, setState, resetWorkspace, subscribe, useStore, useOpen }
