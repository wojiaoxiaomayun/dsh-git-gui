/**
 * @dsh/git-gui — Host plugin entry.
 *
 * A zero-dependency dual-face package:
 * - this file is the Node (host) half, loaded as an ordinary cordis plugin
 *   row from the profile's `cordis.patch.yml`;
 * - `lib/client.js` is the browser half, built by `scripts/build-client.mjs`
 *   into the `window.__ModuleLoader__.load` CJS shape the web module system
 *   serves under `/plugins/@dsh/git-gui/client.js`.
 *
 * The host half provides one Typert service (`gitService`, wire namespace
 * `git`) whose `@Remote` methods become `git/*` endpoints for the browser,
 * plus an ActivityTracker that attributes agent file mutations to
 * (session, turn, tool) for the "AI 修改时间线" view.
 */

import { GitService } from './service.js'
import { ActivityTracker } from './activity.js'

/** @type {import('@deepseek-ai/cordis').Plugin.Function} */
export default function gitGuiPlugin(ctx) {
  const tracker = new ActivityTracker(ctx)
  new GitService(ctx, tracker)
}
