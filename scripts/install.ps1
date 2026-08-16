# dsh-git-gui 一键安装脚本
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File scripts/install.ps1
#   powershell -File scripts/install.ps1 -Spec "@amorligno/dsh-git-gui"   # 从 npm registry 安装(需已发布)
#   powershell -File scripts/install.ps1 -Spec "github:lovetree128/dsh-git-gui"   # 从 GitHub 安装(默认)
#   powershell -File scripts/install.ps1 -UseDshPlugin               # 走官方 dsh plugin 命令(内部用 pnpm)
#
# 脚本做三件事:安装 npm 包到 web profile → 确保 cordis.patch.yml 里有插件行 →
# 清理旧的 junction 手工安装。最后需要你重启 dsh web 使插件生效。

param(
  [string]$Spec = "github:lovetree128/dsh-git-gui",
  [string]$Profile = "web",
  [switch]$UseDshPlugin
)

$ErrorActionPreference = "Stop"

# 包名从 package.json 动态读取,与 npm 发布名保持一致
$pkgManifest = Get-Content (Join-Path $PSScriptRoot "..\package.json") -Raw | ConvertFrom-Json
$pkgName = $pkgManifest.name

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME ".dsh" }
$profileDir = Join-Path $dshHome "profiles\$Profile"
if (-not (Test-Path $profileDir)) {
  throw "找不到 profile 目录: $profileDir"
}

Write-Host "== 1/3 安装包: $Spec → $profileDir"
if ($UseDshPlugin) {
  if (-not (Get-Command dsh -ErrorAction SilentlyContinue)) {
    throw "找不到 dsh 命令。dsh plugin 内部使用 pnpm,请先: npm install -g pnpm(并把 dsh 加入 PATH)"
  }
  & dsh plugin --profile $Profile add $Spec
  if ($LASTEXITCODE -ne 0) { throw "dsh plugin add 失败" }
} else {
  npm install --prefix $profileDir $Spec
  if ($LASTEXITCODE -ne 0) { throw "npm install 失败(可尝试 -UseDshPlugin,或检查网络/git 环境)" }
}

Write-Host "== 2/3 检查 cordis.patch.yml 插件行(auto-patch)"
$autoPatch = Join-Path $PSScriptRoot "auto-patch.mjs"
if (-not (Test-Path $autoPatch)) {
  throw "缺少 $autoPatch"
}
node $autoPatch $profileDir
if ($LASTEXITCODE -ne 0) { throw "auto-patch 执行失败" }

# 经 dsh plugin 安装时,bundle 补丁层自动注册插件;此时应清掉 cordis.patch.yml 里的旧行,避免双注册
if ($UseDshPlugin) {
  $manifestFile = Join-Path $profileDir "package.json"
  if (Test-Path $manifestFile) {
    $manifest = Get-Content $manifestFile -Raw | ConvertFrom-Json
    $bundles = @($manifest.dsh.profile.bundles)
    if ($bundles -contains $pkgName) {
      $patchText = Get-Content (Join-Path $profileDir "cordis.patch.yml") -Raw
      $rowPattern = "(?m)^- insert:\s*\r?\n\s*- id: git-gui\s*\r?\n\s*name: '$([regex]::Escape($pkgName))'\s*\r?\n?"
      $cleaned = [regex]::Replace($patchText, $rowPattern, "")
      if ($cleaned -ne $patchText) {
        Set-Content -Path (Join-Path $profileDir "cordis.patch.yml") -Value $cleaned -Encoding UTF8
        Write-Host "  已从 cordis.patch.yml 移除 git-gui 行(bundle 补丁层已接管注册)"
      }
    }
  }
}

Write-Host "== 3/3 清理旧的 junction 手工安装"
$junction = Join-Path $profileDir "node_modules\@dsh\git-gui"
if (Test-Path $junction) {
  $item = Get-Item $junction -Force
  if ($item.LinkType -eq "Junction") {
    Remove-Item $junction -Force
    Write-Host "  已移除旧的 junction"
  }
}

Write-Host ""
Write-Host "✅ 安装完成。请重启 dsh web(host 行在启动时扫描),"
Write-Host "   之后侧栏底部会出现 Git 按钮;面板自动跟随当前会话的工作区。"
Write-Host ""
Write-Host "卸载: npm uninstall --prefix `"$profileDir`" $pkgName 并删除 cordis.patch.yml 中的 git-gui 行"
