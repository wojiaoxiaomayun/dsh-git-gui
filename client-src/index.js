/**
 * Browser half of dsh-git-gui — the plugin body exported to the web shell.
 *
 * The micro-bundler wraps the whole client-src tree into the
 * `window.__ModuleLoader__.load({ id, factory })` CJS shape; the shell
 * materializes this module and treats its exports as a cordis object plugin.
 * `./pkg-id` is a synthetic module the bundler generates from package.json.
 */

const { startController } = require('./control')
const { makeGitApi } = require('./api')
const { FooterButton } = require('./v-footer')
const { GitPanel } = require('./v-panel')
const { css } = require('./styles')
const PKG_ID = require('./pkg-id')

const inject = ['connection', 'slots']

function apply(ctx) {
  // plugin-owned stylesheet; the module loader inventories this tag id so the
  // HMR driver can remove it together with the plugin.
  if (typeof document !== 'undefined') {
    const tagId = `${PKG_ID}/styles.css`
    if (document.querySelector(`style[data-plugin-css="${tagId}"]`) === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = PKG_ID
      tag.dataset.pluginCss = tagId
      tag.textContent = css
      document.head.appendChild(tag)
    }
  }

  const api = makeGitApi(ctx.connection)
  startController(api)

  ctx.effect(() => {
    const disposeFooter = ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
      { name: 'sidebar.footer.action', id: 'dsh-git-gui', order: 20 },
      (props) => FooterButton(props),
    ))
    const disposePanel = ctx.slots.inject('shell.overlay', () => ctx.slots.register(
      { name: 'shell.overlay', id: 'dsh-git-gui' },
      (props) => GitPanel(props),
    ))
    return () => {
      disposeFooter()
      disposePanel()
    }
  })
}

module.exports = { apply, inject }
// test-only store access (used by tests/client.test.mjs smoke tests)
module.exports.__test = { setState: require('./store').setState, getState: require('./store').getState }
