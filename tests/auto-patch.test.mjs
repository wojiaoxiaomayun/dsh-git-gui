import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const script = path.join(root, 'scripts', 'auto-patch.mjs')
const PKG_NAME = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name
const PKG_ESCAPED = PKG_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function run(profileDir, env = {}) {
  return spawnSync(process.execPath, [script, profileDir], { env: { ...process.env, ...env }, encoding: 'utf8' })
}

test('auto-patch appends the loader row once (idempotent)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-autopatch-'))
  const profileDir = path.join(home, 'profiles', 'web')
  fs.mkdirSync(profileDir, { recursive: true })
  const patchFile = path.join(profileDir, 'cordis.patch.yml')
  fs.writeFileSync(patchFile, '# header\n[]\n', 'utf8')

  const first = run(profileDir)
  assert.equal(first.status, 0)
  let text = fs.readFileSync(patchFile, 'utf8')
  assert.match(text, /id: git-gui/)
  assert.match(text, new RegExp(`name: '${PKG_ESCAPED}'`))
  const occurrences = (text.match(new RegExp(PKG_ESCAPED, 'g')) ?? []).length

  const second = run(profileDir)
  assert.equal(second.status, 0)
  text = fs.readFileSync(patchFile, 'utf8')
  assert.equal((text.match(new RegExp(PKG_ESCAPED, 'g')) ?? []).length, occurrences, 'must not append twice')

  fs.rmSync(home, { recursive: true, force: true })
})

test('auto-patch skips when the profile has no cordis.patch.yml', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-autopatch-'))
  const profileDir = path.join(home, 'profiles', 'web')
  fs.mkdirSync(profileDir, { recursive: true })
  const result = run(profileDir)
  assert.equal(result.status, 0)
  fs.rmSync(home, { recursive: true, force: true })
})

test('auto-patch honors DSH_GIT_GUI_SKIP', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-autopatch-'))
  const profileDir = path.join(home, 'profiles', 'web')
  fs.mkdirSync(profileDir, { recursive: true })
  const patchFile = path.join(profileDir, 'cordis.patch.yml')
  fs.writeFileSync(patchFile, '[]\n', 'utf8')
  const result = run(profileDir, { DSH_GIT_GUI_SKIP: '1' })
  assert.equal(result.status, 0)
  assert.equal(fs.readFileSync(patchFile, 'utf8'), '[]\n')
  fs.rmSync(home, { recursive: true, force: true })
})

test('auto-patch skips writing the row when dsh.profile.bundles already registers the package', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-autopatch-'))
  const profileDir = path.join(home, 'profiles', 'web')
  fs.mkdirSync(profileDir, { recursive: true })
  const patchFile = path.join(profileDir, 'cordis.patch.yml')
  fs.writeFileSync(patchFile, '[]\n', 'utf8')
  fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({
    name: 'web-profile',
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', PKG_NAME] } },
  }), 'utf8')

  const result = run(profileDir)
  assert.equal(result.status, 0)
  assert.equal(fs.readFileSync(patchFile, 'utf8'), '[]\n', 'bundle install must not duplicate the row')
  assert.match(result.stdout, /bundles/)
  fs.rmSync(home, { recursive: true, force: true })
})

test('auto-patch skips writing under a pnpm-managed profile (dsh plugin flow)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-autopatch-'))
  const profileDir = path.join(home, 'profiles', 'web')
  const pkgDir = path.join(profileDir, 'node_modules', ...PKG_NAME.split('/'))
  fs.mkdirSync(pkgDir, { recursive: true })
  fs.mkdirSync(path.join(profileDir, 'node_modules', '.pnpm'), { recursive: true })
  const patchFile = path.join(profileDir, 'cordis.patch.yml')
  fs.writeFileSync(patchFile, '[]\n', 'utf8')

  // 无显式参数:从安装路径(cwd)反推 profile
  const result = spawnSync(process.execPath, [script], { cwd: pkgDir, env: { ...process.env }, encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.equal(fs.readFileSync(patchFile, 'utf8'), '[]\n', 'pnpm-managed installs must not write the row (bundle reconcile registers it)')
  assert.match(result.stdout, /pnpm/)
  fs.rmSync(home, { recursive: true, force: true })
})

test('auto-patch warns (without touching files) when bundle AND row are both present', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-autopatch-'))
  const profileDir = path.join(home, 'profiles', 'web')
  fs.mkdirSync(profileDir, { recursive: true })
  const patchFile = path.join(profileDir, 'cordis.patch.yml')
  fs.writeFileSync(patchFile, `- insert:\n    - id: git-gui\n      name: '${PKG_NAME}'\n`, 'utf8')
  fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({
    name: 'web-profile',
    dsh: { profile: { bundles: [PKG_NAME] } },
  }), 'utf8')

  const result = run(profileDir)
  assert.equal(result.status, 0)
  assert.match(result.stdout, /重复注册|删除 cordis\.patch\.yml/)
  assert.equal(fs.readFileSync(patchFile, 'utf8'), `- insert:\n    - id: git-gui\n      name: '${PKG_NAME}'\n`)
  fs.rmSync(home, { recursive: true, force: true })
})
