# `dsh-git-gui`

<p align="center">
  <a href="../README.md">English</a>·
  <a href="./docs/README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img alt="Version 0.1.1" src="https://img.shields.io/badge/version-0.1.1-blue">
  <img alt="DeepSeek Harness rc.6" src="https://img.shields.io/badge/dsh-0.1.0--rc.6-skyblue">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-green">
</p>

DeepSeek Harness Web UI 的 **Git 图形界面插件**:在浏览器里直接查看、暂存、提交与撤销项目改动,并实时看到 Agent(harness)对工作区文件的每一次修改。

> **当前版本:v0.1.1** —— 查看改动 + 提交/撤销 + 远程同步等功能的可视化操作已上线。分支管理、储藏(stash)、AI 修改时间线三部分计划在 v0.2.0 完善后开放。详见下方[路线图](#路线图)。

## 功能

- **变更视图**:按「已暂存 / 变更 / 未跟踪 / 合并冲突」分组,点击查看行级 diff,一键暂存/取消暂存,丢弃改动与删除未跟踪文件均有确认弹窗;
- **文件树视图**:浏览工作区全部文件(自动遵循 `.gitignore`),文件名按状态着色——未修改为默认文字色(浅色模式黑 / 深色模式白)、已修改未提交为**蓝色**、未跟踪为**红色**;支持目录折叠与名称筛选;点击未修改文件可直接预览内容;
- **日志视图**:提交历史(哈希 / 引用徽标 / 作者 / 相对时间),支持逐提交 `revert` 撤销;
- **嵌套仓库发现**:会话工作区本身不是 git 仓库时,自动在子目录中查找唯一的嵌套仓库并以其为操作根(例如仓库位于工作区的 `dsh-git-gui/` 子目录);多个嵌套仓库时明确提示而不猜选;

## 安装
### GitHub源
```powershell
dsh plugin --profile web add github:lovetree128/dsh-git-gui
```
### npm源
```powershell
dsh plugin --profile web add @amorligno/dsh-git-gui
```
安装后请重启`dsh web`并刷新浏览器页面
## 更新
```powershell
dsh plugin --profile web update @amorligno/dsh-git-gui
```
## 卸载
```powershell
dsh plugin --profile web remove @amorligno/dsh-git-gui
```
## 常见问题

**Git 面板一直显示"正在检测仓库…"？**

这是以 `link:` 符号链接方式安装（例如 `dsh plugin --profile <name> add 本地路径`）时的已知问题：符号链接使宿主端解析到插件仓库自己的 `node_modules` 副本，与 DSH 运行时的包不是同一份模块实例，导致 `git/*` 端点注册对网关不可见。

请使用官方安装方式（真实安装会自动链接宿主包，不存在此问题）：

```powershell
dsh plugin --profile web add github:lovetree128/dsh-git-gui
# 或
dsh plugin --profile web add @amorligno/dsh-git-gui
```

本地测试要模拟真实安装时，请打包成 tgz 再安装（**不要**直接 add 本地目录）：

```powershell
npm pack
dsh plugin --profile web add .\amorligno-dsh-git-gui-0.1.2.tgz
```

如果确实要用本地目录做 link 开发，仓库提供 `scripts/link-host-deps.ps1`：每次 `npm install`/`pnpm install` 后运行一次，再把 DSH 完全重启。

## 使用

插件安装后打开DeepSeek Harness Web UI， 点击左下角新增按钮呼出侧边栏，然后享受版本控制吧。

## 架构

```
Host (Node):  GitService (@Remote, namespace `git`, Typert SRC 模式 → git/* 端点)
              ├─ runner.js   spawn git(无 shell)+ 每工作区队列 + 输出上限 + 错误分类
              ├─ parse.js    porcelain v2 / unified diff / log / refs / stash 解析
              └─ activity.js session/event → (会话, 轮次, 工具, 文件) 时间线(Stage 2 开放)
Client (浏览器): sidebar.footer.action 入口按钮(未提交数徽标) + shell.overlay 浮动面板
              ├─ control.js  会话 cwd 同步 + 轮询 + 操作 runner + 确认弹窗
              ├─ v-*.js      视图组件(React.createElement,无 JSX)
              └─ styles.js   主题 token(--dsw-alias-*)样式,深浅模式自适应
```

## 路线图

| 阶段           | 内容 | 状态 |
|--------------|---|---|
| v0.1.1       | 变更 / 文件树 / 日志 + 提交、暂存、丢弃、revert、**Pull/Push/Fetch + 添加远程**、深色模式、嵌套仓库发现 | ✅ 当前版本 |
| v0.2.0 (未发布) | **分支管理**(本地/远程列表、切换/新建、merge、ahead/behind) | 🔧 完善中 |
| v0.2.0 (未发布)  | **储藏 stash**(push/pop/apply/drop) | 🔧 完善中 |
| v0.2.0 (未发布)  | **AI 修改时间线**(会话×轮次×工具 → 文件的归因视图) | 🔧 完善中 |
| 未来设想         | reset 入口、文件历史(`git log -- <path>`)、设置卡片(轮询间隔/git 路径/身份兜底)、交互式 rebase(PTY) | 💡 待设计 |

## 边界与限制

- 面板操作与 Agent 编辑并发时以 git 自身状态为准;会话运行中面板显示警示条,丢弃等操作需确认;
- 未跟踪文件内容预览上限 512 KiB;diff 输出上限 4 MiB(截断带标记);文件树最多 3000 个文件;
- 凭据依赖已有的 git 凭据助手(WinCred / SSH agent),交互式口令输入被禁用(`GIT_TERMINAL_PROMPT=0`)以保证操作不会挂起;
- Windows 下若仓库 `.git` 由管理员权限进程创建,PyCharm 等普通权限工具需执行 `git config --global --add safe.directory '<路径>'`(git 2.35+ 的防劫持保护)。
- 插件功能在Mac OS以及Linux上尚未测试，若有漏洞敬请上报