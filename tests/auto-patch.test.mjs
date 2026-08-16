import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/auto-patch.mjs')

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
  assert.match(text, /name: '@dsh\/git-gui'/)
  const occurrences = (text.match(/@dsh\/git-gui/g) ?? []).length

  const second = run(profileDir)
  assert.equal(second.status, 0)
  text = fs.readFileSync(patchFile, 'utf8')
  assert.equal((text.match(/@dsh\/git-gui/g) ?? []).length, occurrences, 'must not append twice')

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
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@dsh/git-gui'] } },
  }), 'utf8')

  const result = run(profileDir)
  assert.equal(result.status, 0)
  assert.equal(fs.readFileSync(patchFile, 'utf8'), '[]\n', 'bundle install must not duplicate the row')
  assert.match(result.stdout, /bundles/)
  fs.rmSync(home, { recursive: true, force: true })
})

test('auto-patch warns (without touching files) when bundle AND row are both present', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-autopatch-'))
  const profileDir = path.join(home, 'profiles', 'web')
  fs.mkdirSync(profileDir, { recursive: true })
  const patchFile = path.join(profileDir, 'cordis.patch.yml')
  fs.writeFileSync(patchFile, "- insert:\n    - id: git-gui\n      name: '@dsh/git-gui'\n", 'utf8')
  fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({
    name: 'web-profile',
    dsh: { profile: { bundles: ['@dsh/git-gui'] } },
  }), 'utf8')

  const result = run(profileDir)
  assert.equal(result.status, 0)
  assert.match(result.stdout, /重复注册|删除 cordis\.patch\.yml/)
  assert.equal(fs.readFileSync(patchFile, 'utf8'), "- insert:\n    - id: git-gui\n      name: '@dsh/git-gui'\n")
  fs.rmSync(home, { recursive: true, force: true })
})
