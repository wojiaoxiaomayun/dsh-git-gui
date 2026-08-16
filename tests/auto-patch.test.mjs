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
