# `dsh-git-gui`

DeepSeek Harness Web 的 **Git 图形界面插件**:在浏览器里直接查看、暂存、提交与撤销项目改动,并实时看到 Agent(harness)对工作区文件的每一次修改。

双面包(dual-face)零依赖插件:Host 半面是原生 ESM cordis 插件,Client 半面由 `scripts/build-client.mjs` 微型打包器产出,无 npm 依赖、无构建工具链。

> **当前版本:Stage 1** —— 聚焦"查看改动 + 提交/撤销 + 远程同步"核心闭环,已通过 43 项自动化测试。
> 分支管理、储藏(stash)、AI 修改时间线三部分**代码已实现并保留**(client 视图 + host 端点 + 测试),但尚未达到发布标准,当前对用户隐藏,计划在 Stage 2 完善后开放。详见下方[路线图](#路线图)。

## 功能

- **变更视图**:按「已暂存 / 变更 / 未跟踪 / 合并冲突」分组,点击查看行级 diff,一键暂存/取消暂存,丢弃改动与删除未跟踪文件均有确认弹窗;
- **文件树视图**:浏览工作区全部文件(自动遵循 `.gitignore`),文件名按状态着色——未修改为默认文字色(浅色模式黑 / 深色模式白)、已修改未提交为**蓝色**、未跟踪为**红色**;支持目录折叠与名称筛选;点击未修改文件可直接预览内容;
- **日志视图**:提交历史(哈希 / 引用徽标 / 作者 / 相对时间),支持逐提交 `revert` 撤销;
- **提交**:提交信息框(Ctrl/Cmd+Enter 提交)、身份展示(user.name/email 缺失时醒目提示)、一键「全部暂存」;
- **远程同步**:工作区栏一键 **Pull(ff-only)/ Push / Fetch**,ahead/behind 徽标;首次 Push 自动 `-u` 建立分支跟踪;未配置远程时点击即引导「添加远程仓库」(名称 + URL);SSH 非交互(新主机密钥自动接受、口令由 ssh-agent 提供),网络/认证失败给出结构化中文错误;
- **实时刷新**:面板打开时约每 2 秒轮询 `git status`,Agent 的 write/edit/bash 改动 2 秒内出现在面板与侧栏徽标中(未提交文件数);
- **嵌套仓库发现**:会话工作区本身不是 git 仓库时,自动在子目录中查找唯一的嵌套仓库并以其为操作根(例如仓库位于工作区的 `dsh-git-gui/` 子目录);多个嵌套仓库时明确提示而不猜选;

## 安装

1. 把本包链接进 web profile(pnpm `link:` 的离线等价物,Windows 用目录 junction):

   ```powershell
   New-Item -ItemType Junction `
     -Path "$env:DSH_HOME\profiles\web\node_modules\@dsh\git-gui" `
     -Target "<本仓库路径>"
   ```

2. 在 `$env:DSH_HOME\profiles\web\cordis.patch.yml` 追加插件行(模板见 `cordis.patch.example.yml`):

   ```yaml
   - insert:
       - id: git-gui
         name: '@dsh/git-gui'
   ```

3. 重启 `dsh web` 使 host 行与客户端图生效。侧栏底部出现 **Git** 按钮,点击打开浮动面板。

## 开发

```powershell
node scripts/build-client.mjs            # 构建 client bundle
node scripts/build-client.mjs --watch    # 监听 client-src 自动重建,刷新页面生效
node --test tests/                       # 全部测试(43 项:解析器 / runner / 服务 / 边界 / 客户端冒烟)
```

- 改 `client-src/` 后重建并刷新浏览器即可;改 `lib/`(host)需重启 `dsh web`;
- 测试需要仓库内 `node_modules` 指向本机 dsh 安装的 junction(离线);
- 提交前建议先 `git add -A && git commit`,把稳定版本固化到历史。

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

- **RPC**:无需 Typert 代码生成。网关 SRC 模式扫描服务上的 `@Remote` 标记生成 `git/<method>` 端点;client 用 `ctx.connection.rpc.call('/api', 'git/<m>', {args})` 调用。本包为纯 JS,`@Remote` 通过标准装饰器上下文手工施加(见 `lib/service.js`);所有返回值经 `scrubJson` 严格 JSON 净化,通过网关边界校验。
- **无依赖**:不声明任何 dependencies / peerDependencies;运行时 `@deepseek-ai/*` 经 dsh 启动时创建的 `$DSH_HOME/profiles/node_modules` 符号链接 fallback 解析。
- **client bundle**:`scripts/build-client.mjs`(纯 Node,约百行)把 `client-src/` 的 CJS 模块拼成 `lib/client.js`,外壳为 `window.__ModuleLoader__.load({id, factory})`;相对 require 走内部注册表,`react` 等裸名交给运行时模块表。

## 路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| v0.01 | 变更 / 文件树 / 日志 + 提交、暂存、丢弃、revert、**Pull/Push/Fetch + 添加远程**、深色模式、嵌套仓库发现 | ✅ 当前版本 |
| v0.02 (未发布) | **分支管理**(本地/远程列表、切换/新建、merge、ahead/behind) | 🔧 完善中 |
| v0.02 (未发布) | **储藏 stash**(push/pop/apply/drop) | 🔧 完善中 |
| v0.02 (未发布) | **AI 修改时间线**(会话×轮次×工具 → 文件的归因视图) | 🔧 完善中 |
| 未来设想 | reset 入口、文件历史(`git log -- <path>`)、设置卡片(轮询间隔/git 路径/身份兜底)、交互式 rebase(PTY) | 💡 待设计 |

## 边界与限制

- 面板操作与 Agent 编辑并发时以 git 自身状态为准;会话运行中面板显示警示条,丢弃等操作需确认;
- 未跟踪文件内容预览上限 512 KiB;diff 输出上限 4 MiB(截断带标记);文件树最多 3000 个文件;
- 凭据依赖已有的 git 凭据助手(WinCred / SSH agent),交互式口令输入被禁用(`GIT_TERMINAL_PROMPT=0`)以保证操作不会挂起;
- 空仓库(尚无提交)时日志为空、暂存 diff 与空树对比,均有对应空态提示;
- Windows 下若仓库 `.git` 由管理员权限进程创建,PyCharm 等普通权限工具需执行 `git config --global --add safe.directory '<路径>'`(git 2.35+ 的防劫持保护)。
