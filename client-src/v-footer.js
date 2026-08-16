/**
 * Sidebar footer entry: a Git button with a changed-files badge.
 * Registered into `sidebar.footer.action` (list / root scope).
 */
const { h, cx, ICONS, React } = require('./dom')
const { useStore, setState } = require('./store')
const { t } = require('./i18n')
const { applySession } = require('./control')

function changedCount(status) {
  if (!status || !status.files) return 0
  return status.files.length
}

function FooterButton(props) {
  const sessions = props.useSessions((s) => s)
  React.useEffect(() => {
    applySession(sessions)
  }, [sessions])
  const open = useStore((s) => s.open)
  const count = useStore((s) => changedCount(s.status))
  const statusError = useStore((s) => s.statusError)
  const check = useStore((s) => s.check)
  const wide = props.wide === true

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
    className: cx('gg-footer-btn', open && 'gg-active'),
    title,
    onClick,
    'aria-label': title,
  },
    h('span', { className: 'gg-footer-icon' }, ICONS.git),
    wide && h('span', { className: 'gg-footer-label' }, 'Git'),
    (badge || dot) && h('span', { className: 'gg-footer-marks' }, badge, dot),
  )
}

module.exports = { FooterButton }
