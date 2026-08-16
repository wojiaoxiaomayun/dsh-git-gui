/**
 * Workspace file tree view: every tracked/untracked (non-ignored) file with
 * a git-state color — default (theme text) = unmodified, blue = modified
 * uncommitted, red = untracked. Clicking opens the diff / content preview.
 */
const { h, cx, ICONS, React } = require('./dom')
const { useStore, setState } = require('./store')
const { t } = require('./i18n')
const { getApi, registerTabLoader, refreshDiff } = require('./control')

const MAX_RENDER_ROWS = 800

function buildTree(files, filter) {
  const root = { dirs: new Map(), files: [] }
  const needle = (filter ?? '').trim().toLowerCase()
  for (const file of files) {
    if (needle !== '' && !file.path.toLowerCase().includes(needle)) continue
    const segments = file.path.split('/')
    const name = segments.pop()
    let node = root
    for (const segment of segments) {
      if (!node.dirs.has(segment)) node.dirs.set(segment, { dirs: new Map(), files: [] })
      node = node.dirs.get(segment)
    }
    node.files.push({ name, path: file.path, state: file.state })
  }
  return root
}

function Row({ node, depth, collapsed, onToggle, onOpen, path, rendered }) {
  if (rendered.count >= MAX_RENDER_ROWS) return null
  const rows = []
  const dirs = [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  for (const [name, child] of dirs) {
    const childPath = path === '' ? name : `${path}/${name}`
    const isCollapsed = collapsed.has(childPath)
    rows.push(h('div', { className: 'gg-tree-row gg-tree-dir', key: `d:${childPath}`, style: { paddingLeft: `${8 + depth * 14}px` } },
      h('button', {
        type: 'button',
        className: 'gg-tree-toggle',
        onClick: () => onToggle(childPath, isCollapsed),
        title: isCollapsed ? '展开' : '折叠',
      }, h('span', { className: cx('gg-tree-chevron', isCollapsed && 'gg-tree-chevron-closed') }, ICONS.chevron)),
      ICONS.folder,
      h('span', { className: 'gg-tree-name' }, name)))
    if (!isCollapsed) {
      rows.push(h(Row, { node: child, depth: depth + 1, collapsed, onToggle, onOpen, path: childPath, rendered, key: `r:${childPath}` }))
    }
  }
  for (const file of [...node.files].sort((a, b) => a.name.localeCompare(b.name))) {
    if (rendered.count >= MAX_RENDER_ROWS) break
    rendered.count++
    rows.push(h('div', {
      className: cx('gg-tree-row gg-tree-file',
        file.state === 'modified' && 'gg-tree-modified',
        file.state === 'untracked' && 'gg-tree-untracked'),
      key: `f:${file.path}`,
      style: { paddingLeft: `${8 + depth * 14 + 18}px` },
      title: file.path,
      onClick: () => onOpen(file),
    },
      ICONS.file,
      h('span', { className: 'gg-tree-name' }, file.name)))
  }
  return rows
}

function Legend() {
  return h('div', { className: 'gg-files-legend' },
    h('span', { className: 'gg-legend-item' }, h('span', { className: 'gg-swatch gg-swatch-mod' }), t('files.legendModified')),
    h('span', { className: 'gg-legend-item' }, h('span', { className: 'gg-swatch gg-swatch-unt' }), t('files.legendUntracked')),
    h('span', { className: 'gg-legend-item' }, h('span', { className: 'gg-swatch gg-swatch-clean' }), t('files.legendClean')),
  )
}

function FilesView() {
  const tree = useStore((s) => s.tree)
  const treeError = useStore((s) => s.treeError)
  const cwd = useStore((s) => s.cwd)
  const [filter, setFilter] = React.useState('')
  const [collapsed, setCollapsed] = React.useState(() => new Set())
  const [version, setVersion] = React.useState(0)

  React.useEffect(() => {
    registerTabLoader('files', async (w) => {
      const result = await getApi().tree(w)
      setState({ tree: result, treeError: null })
    })
    if (cwd !== null) {
      getApi().tree(cwd).then((r) => setState({ tree: r, treeError: null }))
        .catch((e) => setState({ tree: null, treeError: String(e?.message ?? e) }))
    }
  }, [cwd])

  const toggle = (path, isCollapsed) => {
    const next = new Set(collapsed)
    if (isCollapsed) next.delete(path)
    else next.add(path)
    setCollapsed(next)
    setVersion((v) => v + 1)
  }

  const open = (file) => {
    const sel = {
      path: file.path,
      staged: false,
      untracked: file.state === 'untracked',
      cat: file.state === 'clean',
    }
    setState({ selected: sel, diff: { ...sel, loading: true, error: null, data: null }, tab: 'status' })
    refreshDiff()
  }

  if (treeError) return h('div', { className: 'gg-empty gg-empty-err' }, treeError)
  if (tree === null) return h('div', { className: 'gg-empty' }, t('status.loading'))
  const files = tree.files ?? []
  if (files.length === 0) return h('div', { className: 'gg-empty' }, t('files.empty'))

  const root = buildTree(files, filter)
  const rendered = { count: 0 }
  return h('div', { className: 'gg-files-view' },
    h('div', { className: 'gg-files-toolbar' },
      h('input', {
        className: 'gg-input',
        value: filter,
        placeholder: t('files.search'),
        onChange: (e) => setFilter(e.target.value),
      }),
      h(Legend, {})),
    h('div', { className: 'gg-files-tree', key: version },
      h(Row, { node: root, depth: 0, collapsed, onToggle: toggle, onOpen: open, path: '', rendered })),
    tree.truncated && h('div', { className: 'gg-files-note' }, t('files.tooMany', { n: files.length })),
  )
}

module.exports = { FilesView }
