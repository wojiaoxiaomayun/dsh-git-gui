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
dsh plugin --profile web add github:lovetree128/dsh-git-gui
```

### npm Source

```powershell
dsh plugin --profile web add @amorligno/dsh-git-gui
```

After installation, restart `dsh web` and refresh the browser page.

## Update

```powershell
dsh plugin --profile web update @amorligno/dsh-git-gui
```

## Uninstall

```powershell
dsh plugin --profile web remove @amorligno/dsh-git-gui
```

## Where to start

After installing the plugin, open the DeepSeek Harness Web UI and click the added button in the bottom-left corner to open the sidebar. Then just enjoy the version control.

## Structure

```text
Host (Node):  GitService (@Remote, namespace `git`, Typert SRC mode → git/* endpoints)
               ├─ runner.js   spawn git (no shell) + per-workspace queue + output limit + error classification
               ├─ parse.js    porcelain v2 / unified diff / log / refs / stash parsing
               └─ activity.js session/event → (session, turn, tool, file) timeline (Stage 2)

Client (Browser): sidebar.footer.action entry button (uncommitted-count badge) + shell.overlay floating panel
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