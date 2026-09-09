/**
 * Conversation header entry: a single compact Git button with a
 * changed-files badge (角标), registered into
 * `conversation.session.header.utilities` (session scope, top-right).
 * A hero twin is rendered by the plugin itself through the generic
 * `shell.overlay` layer, pinned to the same spot while the conversation
 * column is in its hero phase (no session / blank-session hero), where the
 * session header utilities are absent or deliberately hidden.
 */
const { h, cx, ICONS, React } = require('./dom')
const { useStore, setState } = require('./store')
const { t } = require('./i18n')
const { applySession } = require('./control')

function changedCount(status) {
  if (!status || !status.files) return 0
  return status.files.length
}

/**
 * The compact Git icon button + badge. Pure presentational: reads only the
 * plugin's own store (stable hooks), so it can be mounted both in the
 * session header utilities and in the hero overlay twin without depending on
 * framework-scoped session hooks (whose availability can change across
 * renders in the hero, which would trip React's rules-of-hooks check).
 */
function GitButton() {
  const open = useStore((s) => s.open)
  const count = useStore((s) => changedCount(s.status))
  const statusError = useStore((s) => s.statusError)
  const check = useStore((s) => s.check)

  const title = t('panel.title')
  const onClick = () => setState({ open: !open })

  const badge = count > 0
    ? h('span', { className: 'gg-badge', title: `${count}` }, count > 99 ? '99+' : String(count))
    : null
  const dot = !badge && statusError && check?.repo === true
    ? h('span', { className: 'gg-badge gg-badge-err', title: statusError }, '!')
    : null

  return h('button', {
    type: 'button',
    className: cx('gg-header-btn', open && 'gg-active'),
    title,
    onClick,
    'aria-label': title,
  },
    h('span', { className: 'gg-header-icon' }, ICONS.git),
    badge,
    dot,
  )
}

/**
 * Session header entry: binds the active session's workspace to the plugin
 * store via the session-scoped `useSessions` hook, then renders GitButton.
 * `useSessions` is required here (session-scoped slot always provides it).
 */
function HeaderButton(props) {
  const sessions = props.useSessions((s) => s)
  React.useEffect(() => {
    if (sessions) applySession(sessions)
  }, [sessions])
  return h(GitButton)
}

/**
 * Hero / blank-session floating Git entry: the same compact button, mounted
 * through the generic `shell.overlay` layer and pinned to the conversation
 * column's top-right corner — the spot where the header utilities sit once a
 * conversation has records. Renders nothing while the column is not in its
 * `hero` phase (so it never overlaps the in-chat header button or the
 * floating panel). It deliberately does NOT subscribe to the framework
 * sessions hook — in the hero there may be no session at all, and a hook
 * whose presence flips between renders would trip React's rules-of-hooks
 * invariant (#310). The plugin store already holds the last-known workspace,
 * which is what the button's badge reflects.
 */
function HeroGitButton() {
  const [pos, setPos] = React.useState(null)
  const selfRef = React.useRef(null)

  React.useEffect(() => {
    const update = () => {
      const column = document.querySelector('[data-phase]')
      if (column === null || column.getAttribute('data-phase') !== 'hero') {
        setPos(null)
        return
      }
      const rect = column.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) {
        setPos(null)
        return
      }
      // Mirror the session header utilities placement: the header pads
      // 12px top / 28px right and centers the 28px-tall group in its 32px
      // title row (→ 14px top), so the floating icon sits exactly where the
      // in-chat icon does.
      const top = rect.top + 14
      // If other plugins also pin a hero FAB to this corner (e.g. the
      // file-editor's filex-hero-fab), stack ours to the LEFT of them so the
      // two entries sit side by side instead of overlapping. Only elements
      // already in the DOM count; our own fab (data-gg-hero-fab) is skipped.
      let extra = 0
      const fabNodes = document.querySelectorAll('[class*="hero-fab"]')
      for (const node of fabNodes) {
        if (node === selfRef.current) continue
        if (node.getAttribute('data-gg-hero-fab') !== null) continue
        const w = node.offsetWidth
        if (w > 0) extra += w + 8
      }
      const right = window.innerWidth - rect.right + 28 + extra
      setPos((current) => current !== null && current.top === top && current.right === right ? current : { top, right })
    }
    const timer = window.setInterval(update, 400)
    window.addEventListener('resize', update)
    update()
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('resize', update)
    }
  }, [])

  if (pos === null) return null
  return h('div', {
    ref: selfRef,
    'data-gg-hero-fab': '',
    className: 'gg-hero-fab',
    style: { top: `${pos.top}px`, right: `${pos.right}px` },
  }, h(GitButton))
}

module.exports = { HeaderButton, HeroGitButton, GitButton }
