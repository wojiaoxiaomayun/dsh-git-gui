/**
 * Conversation header entry: a single compact Git button with a
 * changed-files badge (角标), registered into
 * `conversation.session.header.utilities` (session scope, top-right).
 * The hero / blank-session twin renders through the `hero.flex` slot that
 * the dsh-hero-flex plugin declares while occupying the header's corner
 * seat — when dsh-hero-flex is not installed, `slots.inject` never fires
 * and the hero entry does not render at all.
 */
const { h, cx, ICONS, React } = require('./dom')
const { useStore, setState } = require('./store')
const { t } = require('./i18n')
const { applySession, bumpAutoFetch } = require('./control')

function changedCount(status) {
  if (!status || !status.files) return 0
  return status.files.length
}

/**
 * The compact Git icon button + badge. Pure presentational: reads only the
 * plugin's own store (stable hooks), so it can be mounted both in the
 * session header utilities and in the hero flex without depending on
 * framework-scoped session hooks (whose availability can change across
 * renders, which would trip React's rules-of-hooks check).
 */
function GitButton() {
  const open = useStore((s) => s.open)
  const count = useStore((s) => changedCount(s.status))
  const statusError = useStore((s) => s.statusError)
  const check = useStore((s) => s.check)

  const title = t('panel.title')
  const onClick = () => {
    const next = !open
    setState({ open: next })
    if (next) bumpAutoFetch() // refresh ahead/behind counts as soon as the panel opens
  }

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
    if (sessions) applySession(sessions, props.sessionId)
  }, [sessions, props.sessionId])
  return h(GitButton)
}

/**
 * Hero / blank-session entry: the same compact Git button, rendered through
 * the `hero.flex` slot declared by the dsh-hero-flex plugin (hero /
 * blank-session header, next to the re-painted right-sidebar expand button).
 * `slots.inject('hero.flex', …)` waits for that declaration, so without
 * dsh-hero-flex installed this entry never mounts and the hero shows
 * nothing. Session-scoped: the entry receives the standard session kit
 * (`sessionId`, `useSessions`, …) and binds the active session the same way
 * the in-chat header entry does. dsh-hero-flex hides the additive flex
 * entries in recorded sessions (keeping only the expand button), so this
 * twin never overlaps the in-chat header button.
 */
function HeroFlexEntry(props) {
  const sessions = props.useSessions((s) => s)
  React.useEffect(() => {
    if (sessions) applySession(sessions, props.sessionId)
  }, [sessions, props.sessionId])
  return h('span', { className: 'gg-hero-flex' }, h(GitButton))
}

module.exports = { HeaderButton, HeroFlexEntry, GitButton }
