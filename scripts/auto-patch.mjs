#!/usr/bin/env node
/**
 * 独立配置工具(由 scripts/install.ps1 调用):把本包的 Loader 行写入 profile 的
 * cordis.patch.yml —— 幂等(只追加、绝不改写已有内容)。
 *
 * 本包是 bundle 型插件,官方安装路径(dsh plugin add)由对账自动注册、无需本工具;
 * 它只服务"npm --prefix 直接安装"这一兜底路径。
 *
 * 定位 profile 的顺序:
 *   1. 显式参数 `node scripts/auto-patch.mjs <profileDir>`;
 *   2. 从安装路径反推:`…/profiles/<name>/node_modules/<scope>/<pkg>`;
 *   3. $DSH_HOME(或 ~/.dsh)+ $DSH_GIT_GUI_PROFILE(默认 web)——并校验包确实装在那里。
 *
 * 环境变量 DSH_GIT_GUI_SKIP=1 可跳过自动写入。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

if (process.env.DSH_GIT_GUI_SKIP === '1') process.exit(0)

const PKG_NAME = JSON.parse(
  fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
).name
const ROW = [
  `# dsh-git-gui 插件(${PKG_NAME} postinstall 自动追加)`,
  '- insert:',
  '    - id: git-gui',
  `      name: '${PKG_NAME}'`,
  '',
].join('\n')

function resolveProfileDir() {
  const explicit = process.argv[2]
  if (explicit) return path.resolve(explicit)
  const normalized = process.cwd().replace(/\\/g, '/')
  const m = /\/profiles\/([^/]+)\/node_modules\//.exec(normalized)
  if (m) {
    const idx = normalized.indexOf('/profiles/')
    return path.join(normalized.slice(0, idx), 'profiles', m[1])
  }
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const profile = process.env.DSH_GIT_GUI_PROFILE || 'web'
  return path.join(home, 'profiles', profile)
}

const profileDir = resolveProfileDir()
const patchFile = path.join(profileDir, 'cordis.patch.yml')

if (!fs.existsSync(patchFile)) {
  console.log(`[dsh-git-gui] 未找到 ${patchFile},跳过自动写入(安装后请手动添加插件行,见 cordis.patch.example.yml)`)
  process.exit(0)
}

// 兜底路径下,确认包真的装在这个 profile 里,避免把无效行写进配置导致 dsh 启动失败
const installed = path.join(profileDir, 'node_modules', ...PKG_NAME.split('/'))
if (process.argv[2] === undefined && !fs.existsSync(installed)) {
  console.log(`[dsh-git-gui] 包未安装在 ${profileDir} 的 node_modules 中,跳过自动写入`)
  process.exit(0)
}

// 经 `dsh plugin add`(pnpm)安装时,本包会被对账进 dsh.profile.bundles,bundle
// 补丁层在启动时自动生效 —— 无需再往 cordis.patch.yml 写行。pnpm 管理的
// profile 必有 node_modules/.pnpm 目录,据此区分"dsh plugin 安装"与
// "npm --prefix 直接安装"(后者没有 .pnpm,才需要本脚本兜底写行)。
function bundlesIncludePackage() {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'))
    const bundles = manifest?.dsh?.profile?.bundles
    return Array.isArray(bundles) && bundles.includes(PKG_NAME)
  } catch {
    return false
  }
}
function pnpmManaged() {
  return fs.existsSync(path.join(profileDir, 'node_modules', '.pnpm'))
}

let text = fs.readFileSync(patchFile, 'utf8')
const rowPresent = text.includes(PKG_NAME)
if (pnpmManaged() && !process.argv[2]) {
  // dsh plugin 流程:写行反而造成双注册(对账在其后才把本包加入 bundles)
  if (rowPresent) {
    console.log('[dsh-git-gui] 检测到 pnpm 管理的 profile:本包由 dsh.profile.bundles 注册(bundle 补丁层),cordis.patch.yml 中的行应删除以免重复注册')
  } else {
    console.log('[dsh-git-gui] pnpm 管理的 profile:本包将由 dsh plugin 对账进 bundles 自动注册,跳过写行')
  }
  process.exit(0)
}
if (bundlesIncludePackage()) {
  if (rowPresent) {
    console.log('[dsh-git-gui] 检测到 dsh.profile.bundles 与 cordis.patch.yml 同时注册本包,为避免重复注册,请手动删除 cordis.patch.yml 中的 git-gui 行')
  } else {
    console.log('[dsh-git-gui] profile 的 dsh.profile.bundles 已包含本包(bundle 补丁层自动生效),跳过写行')
  }
  process.exit(0)
}
if (rowPresent) {
  console.log('[dsh-git-gui] cordis.patch.yml 已包含插件行,无需修改')
  process.exit(0)
}
text = text.replace(/\s*$/, '\n') + '\n' + ROW
fs.writeFileSync(patchFile, text, 'utf8')
console.log(`[dsh-git-gui] 已自动把插件行写入 ${patchFile} —— 重启 dsh web 后生效`)
