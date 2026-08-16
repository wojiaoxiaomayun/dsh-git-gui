/**
 * Regression: every endpoint result must pass the Typert gateway's strict
 * JSON boundary (`assertJsonValue`). SRC mode rejects undefined, non-finite
 * numbers, functions, and cyclic values — a single `undefined` field used to
 * fail the whole endpoint (e.g. `git/branches`).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import plugin from '../lib/index.js'
import { runGit } from '../lib/runner.js'

// Exact replica of the gateway's boundary check (dsh-api-gateway lib/index.js).
function assertJsonValue(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return
    throw new TypeError('non-finite number is not JSON-safe')
  }
  if (typeof value !== 'object') throw new TypeError(`${typeof value} is not JSON-safe`)
  if (ancestors.has(value)) throw new TypeError('cyclic value is not JSON-safe')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getOwnPropertySymbols(value).length > 0 || Object.keys(value).length !== value.length) throw new TypeError('sparse or decorated array is not JSON-safe')
      for (let i = 0; i < value.length; i++) assertJsonValue(value[i], ancestors)
      return
    }
    for (const key of Object.keys(value)) assertJsonValue(value[key], ancestors)
  } finally {
    ancestors.delete(value)
  }
}

let ctx
let repo

test.before(async () => {
  ctx = new Context()
  await ctx.plugin(plugin)
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-boundary-'))
  const sh = async (args) => {
    const r = await runGit({}, repo, args, { mutating: true })
    assert.equal(r.exitCode, 0, `git ${args.join(' ')}: ${r.stderr}`)
  }
  await sh(['init'])
  await sh(['config', 'user.name', 'Boundary Tester'])
  await sh(['config', 'user.email', 'boundary@example.com'])
  await sh(['config', 'core.autocrlf', 'false'])
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n')
  await sh(['add', 'a.txt'])
  await sh(['commit', '-m', 'base'])
  await sh(['branch', '--set-upstream-to=master', 'master'])
})

test.after(async () => {
  await ctx.fiber.dispose()
  fs.rmSync(repo, { recursive: true, force: true })
})

function checkResult(label, result) {
  assertJsonValue(result, new Set())
  const round = JSON.parse(JSON.stringify(result))
  assert.deepEqual(round, result, `${label}: JSON round-trip must be lossless`)
  return result
}

test('read endpoints pass boundary validation (incl. undefined-shaped fields)', async () => {
  const service = ctx.get('gitService')

  // modify + untracked + staged states so status/diff carry rich shapes
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo-CHANGED\nthree\n')
  fs.writeFileSync(path.join(repo, '新文件.md'), '# new')
  await service.stage(repo, ['新文件.md'])

  checkResult('check', await service.check(repo))
  checkResult('status', await service.status(repo))
  checkResult('branches', await service.branches(repo))       // upstream/track fields
  checkResult('identity', await service.identity(repo))
  checkResult('activity', await service.activity(repo, 10))
  checkResult('log', await service.log(repo, 10, null))

  checkResult('diff unstaged (oldLine/newLine undefined shapes)', await service.diff(repo, 'a.txt', false, null, false))
  checkResult('diff staged', await service.diff(repo, '新文件.md', true, null, false))
  checkResult('diff untracked preview', await service.diff(repo, '新文件.md', false, null, true))
  checkResult('diff vs commit', await service.diff(repo, 'a.txt', false, 'HEAD', false))

  checkResult('stash list', await service.stash(repo, 'list', null, null))
  checkResult('tree', await service.tree(repo))
  checkResult('cat tracked file', await service.cat(repo, 'a.txt'))
  checkResult('cat missing file', await service.cat(repo, 'does-not-exist.txt'))
  checkResult('remoteList', await service.remoteList(repo))
  checkResult('remoteAdd invalid', await service.remoteAdd(repo, 'bad name', 'x'))
})

test('write endpoints pass boundary validation', async () => {
  const service = ctx.get('gitService')

  checkResult('stage', await service.stage(repo, ['a.txt', '新文件.md']))
  checkResult('commit', await service.commit(repo, 'boundary commit'))   // hash field present
  checkResult('branches after commit', await service.branches(repo))
  checkResult('unstage', await service.unstage(repo, ['a.txt']))
  checkResult('discard tracked', await service.discard(repo, ['a.txt'], false))
  checkResult('discard untracked', await service.discard(repo, ['新文件.md'], true))
  checkResult('switchBranch create', await service.switchBranch(repo, 'boundary-branch', true))
  checkResult('switchBranch back', await service.switchBranch(repo, 'master', false))
  checkResult('merge', await service.merge(repo, 'boundary-branch'))
  checkResult('stash push', await service.stash(repo, 'push', 'boundary', null))
  checkResult('stash pop', await service.stash(repo, 'pop', null, 'stash@{0}'))
  checkResult('reset mixed', await service.reset(repo, 'mixed', 'HEAD'))
  checkResult('fetch (no remote, structured failure)', await service.fetch(repo))
})

test('error results pass boundary validation too', async () => {
  const service = ctx.get('gitService')
  checkResult('not a repo', await service.status(path.dirname(repo)))
  checkResult('invalid paths', await service.stage(repo, ['-x']))
  checkResult('invalid branch', await service.switchBranch(repo, 'bad..name', false))
  checkResult('invalid commit', await service.reset(repo, 'hard', '$(boom)'))
  checkResult('empty message', await service.commit(repo, '   '))
})
