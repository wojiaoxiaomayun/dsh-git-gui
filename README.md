# `dsh-git-gui`

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./docs/README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img alt="Version 0.1.2" src="https://img.shields.io/badge/version-0.1.2-blue">
  <img alt="DeepSeek Harness rc.6" src="https://img.shields.io/badge/dsh-0.1.0--rc.6-skyblue">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-green">
</p>

A **Git graphical interface plugin** for the DeepSeek Harness Web UI: view, stage, commit, and revert project changes directly in the browser, while seeing every modification the Agent (harness) makes to workspace files in real time.

> **Current version: v0.1.2** — Visual operations for viewing changes, committing/reverting, remote synchronization, and more are now available. Branch management, stash, and the AI modification timeline are planned to be completed and released in v0.2.0. See the [Roadmap](#roadmap) below for details.

## Features

- **Changes View**: Changes are grouped into "Staged / Modified / Untracked / Merge Conflicts". Click to view line-level diffs, stage/unstage changes with one click, and discard changes or delete untracked files with confirmation dialogs.
- **File Tree View**: Browse all files in the workspace (automatically respecting `.gitignore`). File names are color-coded by status — unmodified files use the default text color (black in light mode / white in dark mode), modified but uncommitted files are **blue**, and untracked files are **red**. Supports directory collapsing and name filtering. Click an unmodified file to preview its contents directly.
- **Log View**: View commit history (hash / reference badges / author / relative time), with support for reverting individual commits using `revert`.
- **Nested Repository Detection**: When the session workspace itself is not a Git repository, the plugin automatically searches subdirectories for a single nested repository and uses it as the operation root (for example, when the repository is located in the `dsh-git-gui/` subdirectory of the workspace). If multiple nested repositories are found, the plugin explicitly prompts the user instead of guessing which one to use.

## Installation

### GitHub Source

```powershell
dsh plugin --profile web add github:wojiaoxiaomayun/dsh-git-gui
```

### npm Source

```powershell
dsh plugin --profile web add @dsh-xhl/dsh-git-gui
```

After installation, restart `dsh web` and refresh the browser page.

## Update

```powershell
dsh plugin --profile web update @dsh-xhl/dsh-git-gui
```

## Uninstall

```powershell
dsh plugin --profile web remove @dsh-xhl/dsh-git-gui
```

## Troubleshooting

**The Git panel is stuck on "Detecting repository…"?**

This is a known issue when the plugin is installed as a `link:` symlink (e.g. `dsh plugin --profile <name> add <local path>`): the host half resolves `@deepseek-ai/*` from the plugin repo's own `node_modules` instead of the DSH runtime's copies, so the `git/*` endpoint registration is invisible to the gateway.

Use the official install methods instead (a real install automatically links the host's packages):

```powershell
dsh plugin --profile web add github:wojiaoxiaomayun/dsh-git-gui
# or
dsh plugin --profile web add @dsh-xhl/dsh-git-gui
```

To mimic a real install locally, pack a tarball and install that (**do not** add a local directory):

```powershell
npm pack
dsh plugin --profile web add .\dsh-xhl-dsh-git-gui-0.1.3.tgz
```

If you do want a `link:` dev loop, run `scripts/link-host-deps.ps1` after every `npm install` / `pnpm install`, then fully restart DSH.

**The panel is stuck on "Detecting repository…" right after upgrading DSH itself?**

The host half needs `@deepseek-ai/cordis`, `@deepseek-ai/dsh-llm` and `@deepseek-ai/dsh-typert-protocol`, resolved through the shared module fallback at `$DSH_HOME/profiles/node_modules`. A DSH upgrade can leave stale pnpm links in that directory (symlinks pointing into a deleted `.pnpm` store), so the plugin host half fails to import and the `git/*` endpoints never register — the browser panel then stays on "正在检测仓库…" forever.

Verify from a directory that does **not** shadow the profile (e.g. `%TEMP%`):

```powershell
node --input-type=module -e "await import('file:///' + (process.env.USERPROFILE + '/.dsh/profiles/web/node_modules/@dsh-xhl/dsh-git-gui/lib/service.js').replaceAll('\\\\', '/')); console.log('host half loads')"
```

If it throws `ERR_MODULE_NOT_FOUND` for one of the `@deepseek-ai/*` packages, heal the broken fallback links (point them at the installed DSH copy, as DSH's own boot repair does):

```powershell
$shared = "$env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai"
$img = "$env:USERPROFILE\AppData\Local\Volta\tools\image\packages\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai"
foreach ($n in 'cordis','dsh-llm','dsh-typert-protocol') {
  Remove-Item "$shared\$n" -Force -ErrorAction SilentlyContinue
  cmd /c "mklink /J `"$shared\$n`" `"$img\$n`""
}
```

Then fully restart `dsh web` (the running process caches the failed module load) and refresh the browser page. The plugin also hardens the browser half against DSH session-list API changes (`sessions.current` was removed; the active session is now derived from the session-scoped `sessionId` / the `ids` + `retainedBy.mainView` list fields), so a stale or renamed session field no longer leaves the panel stuck either.

## Where to start

After installing the plugin, open the DeepSeek Harness Web UI and click the Git button (with a changed-files count badge) in the top-right corner of the conversation header to open the floating panel. On the hero / new-chat page (before a conversation exists) the same button is shown pinned to the same top-right spot.

## Structure

```text
Host (Node):  GitService (@Remote, namespace `git`, Typert SRC mode → git/* endpoints)
               ├─ runner.js   spawn git (no shell) + per-workspace queue + output limit + error classification
               ├─ parse.js    porcelain v2 / unified diff / log / refs / stash parsing
               └─ activity.js session/event → (session, turn, tool, file) timeline (Stage 2)

Client (Browser): conversation.session.header.utilities entry button (uncommitted-count badge) + shell.overlay floating panel + hero-page floating button
               ├─ control.js  session cwd synchronization + polling + operation runner + confirmation dialogs
               ├─ v-*.js      view components (React.createElement, no JSX)
               └─ styles.js   theme tokens (--dsw-alias-*) and styles, adaptive to light/dark mode
```

## Roadmap

| Stage | Content | Status |
|--------------|---|---|
| v0.1.1 | Changes / file tree / log + commit, stage, discard, revert, **Pull/Push/Fetch + Add Remote**, dark mode, nested repository detection | ✅ Current version |
| v0.2.0 (unreleased) | **Branch management** (local/remote lists, switch/create, merge, ahead/behind) | 🔧 In progress |
| v0.2.0 (unreleased) | **Stash** (push/pop/apply/drop) | 🔧 In progress |
| v0.2.0 (unreleased) | **AI modification timeline** (session × turn × tool → file attribution view) | 🔧 In progress |
| Future ideas | Reset entry point, file history (`git log -- <path>`), settings card (polling interval / Git path / identity fallback), interactive rebase (PTY) | 💡 To be designed |

## Limitations

- When panel operations and Agent edits occur concurrently, Git's own state is treated as authoritative. A warning bar is displayed while the session is running, and operations such as discarding changes require confirmation.
- Untracked file content previews are limited to 512 KiB; diff output is limited to 4 MiB (truncation is marked); the file tree supports a maximum of 3,000 files.
- Credentials rely on existing Git credential helpers (WinCred / SSH agent). Interactive password input is disabled (`GIT_TERMINAL_PROMPT=0`) to ensure operations do not hang.
- On Windows, if the repository's `.git` directory was created by a process running with administrator privileges, tools running with normal privileges, such as PyCharm, need to execute `git config --global --add safe.directory '<path>'` (Git 2.35+ hijacking protection).
- The plugin has not yet been tested on macOS or Linux. Please report any issues you encounter.