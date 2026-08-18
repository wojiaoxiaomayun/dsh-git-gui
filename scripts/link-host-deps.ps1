# dsh-git-gui 开发辅助脚本：把仓库 node_modules 里宿主端关键 @deepseek-ai 包
# 重新"链接"(junction) 到 DSH 运行时的副本，使 link: 安装模式下插件与宿主网关
# 共用同一份模块实例（否则 SRC 模式 Remote 标记表分裂，git/* 端点认不出，
# 面板会一直卡在"正在检测仓库…"）。
#
# 何时需要：插件以 link:F:/AgentWork/dsh-git-gui 方式装进 profile 做开发时，
# 每次在仓库里执行过 npm install / pnpm install（会重建 node_modules、覆盖
# junction）之后，重跑一次本脚本即可。
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File scripts/link-host-deps.ps1
#
# 可选: $env:DSH_HOME 指向非默认的 DSH home（默认 ~/.dsh）。

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$fallback = Join-Path $dshHome 'profiles\node_modules\@deepseek-ai'
$repoDs = Join-Path $repo 'node_modules\@deepseek-ai'

if (-not (Test-Path $fallback)) {
  Write-Host "未找到 DSH 运行时副本目录: $fallback"
  Write-Host '请确认 DSH Desktop 已至少启动过一次（会生成 profiles/node_modules 扁平回退目录）。'
  exit 1
}
if (-not (Test-Path $repoDs)) {
  Write-Host "仓库 node_modules 不存在: $repoDs"
  Write-Host '请先在仓库里执行 npm install 或 pnpm install，再运行本脚本。'
  exit 1
}

$count = 0
foreach ($pkg in @('cordis', 'dsh-llm', 'dsh-typert-protocol')) {
  $target = Join-Path $fallback $pkg
  $link = Join-Path $repoDs $pkg
  if (-not (Test-Path $target)) {
    Write-Host "跳过 $pkg（宿主无此包）"
    continue
  }
  if (Test-Path $link) { Remove-Item $link -Recurse -Force }
  New-Item -ItemType Junction -Path $link -Target $target | Out-Null
  Write-Host "已链接 $pkg -> $target"
  $count++
}

if ($count -eq 0) {
  Write-Host '没有创建任何链接，请检查 DSH_HOME / 仓库路径。'
  exit 1
}
Write-Host ''
Write-Host '完成。请完全退出并重启 DSH Desktop（宿主进程需要重新加载插件），'
Write-Host '之后 Git 面板应能正常显示仓库状态，不再卡在"正在检测仓库…"。'
