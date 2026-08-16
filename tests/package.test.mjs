import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('bundle contract: manifest declares dsh.bundle patch + exports + files', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml', 'dsh plugin 对账依赖此声明')
  assert.equal(manifest.dsh?.client?.platform, 'web', 'client 声明需与 bundle 并存')
  assert.equal(manifest.exports?.['./cordis.patch.yml'], './cordis.patch.yml')
  assert.ok(manifest.files.includes('cordis.patch.yml'))
  assert.ok(manifest.files.includes('lib/client.js'))
})

test('bundle patch registers the plugin under id git-gui', () => {
  const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /- insert:/)
  assert.match(patch, /- id: git-gui/)
  assert.match(patch, /name: '@dsh\/git-gui'/)
})

test('bundle patch parses as valid YAML', async () => {
  // js-yaml rides along in the dsh tree via the junction'd node_modules;
  // skip the deep check when it is unavailable (offline envs).
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  let yaml
  try {
    yaml = require('js-yaml')
  } catch {
    return
  }
  const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
  const parsed = yaml.load(patch)
  assert.ok(Array.isArray(parsed))
  assert.equal(parsed[0].insert[0].id, 'git-gui')
})
