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
const { HeaderButton, HeroFlexEntry } = require('./v-header')
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
    const disposeHeader = ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
      { name: 'conversation.session.header.utilities', id: 'dsh-git-gui', order: 20 },
      (props) => HeaderButton(props),
    ))
    const disposeOverlay = ctx.slots.inject('shell.overlay', () => {
      const disposePanel = ctx.slots.register(
        { name: 'shell.overlay', id: 'dsh-git-gui' },
        (props) => GitPanel(props),
      )
      return disposePanel
    })
    // Hero / blank-session entry: rendered through the `hero.flex` slot that
    // the dsh-hero-flex plugin declares while occupying the header's corner
    // seat. `slots.inject` waits for the declaration, so without dsh-hero-flex
    // installed this entry never mounts and the hero shows nothing — no corner
    // fight, no fallback.
    const disposeHero = ctx.slots.inject('hero.flex', () => ctx.slots.register(
      { name: 'hero.flex', id: 'dsh-git-gui', order: 20, label: 'Git（hero）' },
      (props) => HeroFlexEntry(props),
    ))
    return () => {
      disposeHeader()
      disposeOverlay()
      disposeHero()
    }
  })
}

module.exports = { apply, inject }
// test-only store access (used by tests/client.test.mjs smoke tests)
module.exports.__test = {
  setState: require('./store').setState,
  getState: require('./store').getState,
  get control() { return require('./control') },
}
