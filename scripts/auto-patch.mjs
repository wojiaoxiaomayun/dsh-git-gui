#!/usr/bin/env node
/**
 * postinstall 钩子:自动把 @dsh/git-gui 的 Loader 行写入 profile 的
 * cordis.patch.yml —— 幂等(只追加、绝不改写已有内容)。
 *
 * 定位 profile 的顺序:
 *   1. 显式参数 `node scripts/auto-patch.mjs <profileDir>`(测试用);
 *   2. 从安装路径反推:`…/profiles/<name>/node_modules/@dsh/git-gui`;
 *   3. $DSH_HOME(或 ~/.dsh)+ $DSH_GIT_GUI_PROFILE(默认 web)——并校验包确实装在那里。
 *
 * 环境变量 DSH_GIT_GUI_SKIP=1 可跳过自动写入。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

if (process.env.DSH_GIT_GUI_SKIP === '1') process.exit(0)

const ROW = [
  '# dsh-git-gui 插件(@dsh/git-gui postinstall 自动追加)',
  '- insert:',
  "    - id: git-gui",
  "      name: '@dsh/git-gui'",
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
const installed = path.join(profileDir, 'node_modules', '@dsh', 'git-gui')
if (process.argv[2] === undefined && !fs.existsSync(installed)) {
  console.log(`[dsh-git-gui] 包未安装在 ${profileDir} 的 node_modules 中,跳过自动写入`)
  process.exit(0)
}

let text = fs.readFileSync(patchFile, 'utf8')
if (text.includes('@dsh/git-gui')) {
  console.log('[dsh-git-gui] cordis.patch.yml 已包含插件行,无需修改')
  process.exit(0)
}
text = text.replace(/\s*$/, '\n') + '\n' + ROW
fs.writeFileSync(patchFile, text, 'utf8')
console.log(`[dsh-git-gui] 已自动把插件行写入 ${patchFile} —— 重启 dsh web 后生效`)
