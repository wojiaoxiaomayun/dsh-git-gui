import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods, isTypertRemoteSegment } from '@deepseek-ai/dsh-typert-protocol'
import plugin from '../lib/index.js'
import { runGit } from '../lib/runner.js'

const EXPECTED_ENDPOINTS = [
  'check', 'status', 'diff', 'log', 'branches', 'identity', 'activity',
  'tree', 'cat',
  'stage', 'unstage', 'discard', 'commit', 'generateCommitMessage', 'switchBranch', 'merge', 'pull',
  'push', 'fetch', 'remoteList', 'remoteAdd', 'stash', 'revert', 'reset', 'init',
]

let ctx
let repo

async function sh(args, cwd) {
  const result = await runGit({}, cwd, args, { mutating: true })
  assert.equal(result.exitCode, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
}

test.before(async () => {
  ctx = new Context()
  await ctx.plugin(plugin)
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-gui-service-'))
  await sh(['init'], repo)
  await sh(['config', 'user.name', 'Svc User'], repo)
  await sh(['config', 'user.email', 'svc@example.com'], repo)
  await sh(['config', 'core.autocrlf', 'false'], repo)
})

test.after(async () => {
  await ctx.fiber.dispose()
  fs.rmSync(repo, { recursive: true, force: true })
})

test('service registers with the git namespace and complete endpoint set', () => {
  const service = ctx.get('gitService')
  assert.equal(service.typertRemote.namespace, 'git')
  assert.equal(service.typertRemote.serviceKey, 'gitService')
  assert.ok(isTypertRemoteSegment('git'))
  const methods = remoteMethods(service).map((m) => m.method).sort()
  assert.deepEqual(methods, [...EXPECTED_ENDPOINTS].sort())
  // every marker is a direct invocation
  for (const marker of remoteMethods(service)) assert.equal(marker.invocation.kind, 'direct')
})

test('SRC gateway discovery would claim git/<method> endpoints', () => {
  const claims = new Set()
  for (const [serviceKey, definition] of Object.entries(ctx.reflect.props)) {
    if (definition.type !== 'service') continue
    const receiver = ctx.get(serviceKey)
    if (!receiver || typeof receiver !== 'object') continue
    const binding = receiver.typertRemote
    if (!binding || typeof binding.namespace !== 'string') continue
    for (const candidate of remoteMethods(receiver)) {
      claims.add(`${binding.namespace}/${candidate.exportName ?? candidate.method}`)
    }
  }
  for (const endpoint of EXPECTED_ENDPOINTS) {
    assert.ok(claims.has(`git/${endpoint}`), `missing claim git/${endpoint}`)
  }
})

test('check() detects repo and returns version', async () => {
  const service = ctx.get('gitService')
  const result = await service.check(repo)
  assert.equal(result.ok, true)
  assert.equal(result.repo, true)
  assert.match(result.gitVersion, /^git version/)
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-gui-notrepo-'))
  const notRepo = await service.check(outside)
  assert.equal(notRepo.ok, true)
  assert.equal(notRepo.repo, false)
  fs.rmSync(outside, { recursive: true, force: true })
})

test('full lifecycle: write → status → stage → diff → commit → log', async () => {
  const service = ctx.get('gitService')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\nworld\n')
  const st0 = await service.status(repo)
  assert.equal(st0.ok, true)
  assert.equal(st0.branch.noCommits, true)
  assert.equal(st0.files.find((f) => f.path === 'a.txt').x, '?')

  const untrackedDiff = await service.diff(repo, 'a.txt', false, null, true)
  assert.equal(untrackedDiff.ok, true)
  assert.equal(untrackedDiff.diff.files[0].hunks[0].lines[0].text, 'hello')

  const stage = await service.stage(repo, ['a.txt'])
  assert.equal(stage.ok, true)
  const st1 = await service.status(repo)
  assert.equal(st1.files.find((f) => f.path === 'a.txt').x, 'A')

  const cached = await service.diff(repo, 'a.txt', true, null, false)
  assert.equal(cached.ok, true)
  assert.ok(cached.diff.files[0].hunks.length > 0)

  const commit = await service.commit(repo, 'first commit')
  assert.equal(commit.ok, true)
  assert.match(commit.hash, /^[0-9a-f]{40}$/)

  const log = await service.log(repo, 10, null)
  assert.equal(log.ok, true)
  assert.equal(log.commits.length, 1)
  assert.equal(log.commits[0].subject, 'first commit')
})

test('identity + branches + switchBranch + merge', async () => {
  const service = ctx.get('gitService')
  const id = await service.identity(repo)
  assert.equal(id.ok, true)
  assert.equal(id.name, 'Svc User')
  assert.equal(id.hasIdentity, true)

  const branches0 = await service.branches(repo)
  assert.equal(branches0.ok, true)
  assert.ok(branches0.refs.some((r) => r.current))

  const sw = await service.switchBranch(repo, 'feature', true)
  assert.equal(sw.ok, true)
  fs.writeFileSync(path.join(repo, 'f.txt'), 'f\n')
  assert.equal((await service.stage(repo, ['f.txt'])).ok, true)
  assert.equal((await service.commit(repo, 'feature work')).ok, true)

  const back = await service.switchBranch(repo, 'master', false)
  assert.equal(back.ok, true)
  const merge = await service.merge(repo, 'feature')
  assert.equal(merge.ok, true)
  assert.equal(fs.existsSync(path.join(repo, 'f.txt')), true)
})

test('discard / unstage / stash / reset / revert paths', async () => {
  const service = ctx.get('gitService')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\nworld\nCHANGED\n')
  assert.equal((await service.discard(repo, ['a.txt'], false)).ok, true)
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'hello\nworld\n')

  fs.writeFileSync(path.join(repo, 'junk.txt'), 'x')
  assert.equal((await service.discard(repo, ['junk.txt'], true)).ok, true)
  assert.equal(fs.existsSync(path.join(repo, 'junk.txt')), false)

  fs.writeFileSync(path.join(repo, 'a.txt'), 'stashed\n')
  const push = await service.stash(repo, 'push', 'tmp', null)
  assert.equal(push.ok, true)
  const list = await service.stash(repo, 'list', null, null)
  assert.equal(list.stashes.length, 1)
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'hello\nworld\n')
  const pop = await service.stash(repo, 'pop', null, 'stash@{0}')
  assert.equal(pop.ok, true)
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'stashed\n')
  assert.equal((await service.discard(repo, ['a.txt'], false)).ok, true)

  const head = (await runGit({}, repo, ['rev-parse', 'HEAD'], { mutating: false })).stdout.trim()
  const reset = await service.reset(repo, 'mixed', 'HEAD~1')
  assert.equal(reset.ok, true)
  const hard = await service.reset(repo, 'hard', head)
  assert.equal(hard.ok, true)
})

test('invalid inputs are rejected with structured errors', async () => {
  const service = ctx.get('gitService')
  const badPath = await service.stage(repo, ['../evil', '-x'])
  assert.equal(badPath.ok, false)
  assert.equal(badPath.code, 'INVALID')

  const badBranch = await service.switchBranch(repo, 'foo bar..', false)
  assert.equal(badBranch.ok, false)

  const badCommit = await service.reset(repo, 'hard', '$(rm -rf)', false)
  assert.equal(badCommit.ok, false)

  const emptyCommit = await service.commit(repo, '   ')
  assert.equal(emptyCommit.ok, false)

  const notRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-empty-'))
  const notRepo = await service.status(notRepoDir)
  assert.equal(notRepo.ok, false)
  assert.equal(notRepo.code, 'NOT_REPO')
  fs.rmSync(notRepoDir, { recursive: true, force: true })
})

test('tree: clean/modified/untracked classification + gitignore exclusion + cat', async () => {
  const service = ctx.get('gitService')
  fs.writeFileSync(path.join(repo, 'ignored.tmp'), 'x')
  fs.writeFileSync(path.join(repo, '.gitignore'), 'ignored.tmp\n')
  assert.equal((await service.stage(repo, ['.gitignore'])).ok, true)
  assert.equal((await service.commit(repo, 'add gitignore')).ok, true)
  fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\nworld\nEDITED\n')
  fs.writeFileSync(path.join(repo, 'brand-new.txt'), 'new')

  const tree = await service.tree(repo)
  assert.equal(tree.ok, true)
  const byPath = Object.fromEntries(tree.files.map((f) => [f.path, f.state]))
  assert.equal(byPath['a.txt'], 'modified')
  assert.equal(byPath['brand-new.txt'], 'untracked')
  assert.equal(byPath['.gitignore'], 'clean')
  assert.equal(byPath['f.txt'], 'clean')
  assert.equal(byPath['ignored.tmp'], undefined)  // .gitignore excluded it

  const cat = await service.cat(repo, '.gitignore')
  assert.equal(cat.ok, true)
  assert.match(cat.content, /ignored\.tmp/)
  const catMissing = await service.cat(repo, 'nope.txt')
  assert.equal(catMissing.ok, false)

  // restore
  fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\nworld\n')
  fs.rmSync(path.join(repo, 'brand-new.txt'))
  fs.rmSync(path.join(repo, 'ignored.tmp'))
})

test('remote: list/add + push -u fallback + pull + fetch (local bare remote)', async () => {
  const service = ctx.get('gitService')

  const r0 = await service.remoteList(repo)
  assert.equal(r0.ok, true)
  assert.deepEqual(r0.remotes, [])

  // invalid inputs
  const badName = await service.remoteAdd(repo, 'bad name', 'git@x:y.git')
  assert.equal(badName.ok, false)
  const badUrl = await service.remoteAdd(repo, 'origin2', '')
  assert.equal(badUrl.ok, false)

  // local bare "remote"
  const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-remote-'))
  await sh(['init', '--bare'], remoteDir)
  const add = await service.remoteAdd(repo, 'origin', remoteDir)
  assert.equal(add.ok, true)
  const dup = await service.remoteAdd(repo, 'origin', remoteDir)
  assert.equal(dup.ok, false)
  assert.equal(dup.code, 'REMOTE_EXISTS')

  const r1 = await service.remoteList(repo)
  assert.equal(r1.remotes.length, 1)
  assert.equal(r1.remotes[0].name, 'origin')

  // push with no upstream → -u fallback establishes tracking
  const push = await service.push(repo)
  assert.equal(push.ok, true)
  assert.match(push.output, /master/)

  // a second working copy commits and pushes
  const cloneParent = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-clone-'))
  const clone = path.join(cloneParent, 'work')
  await sh(['clone', remoteDir, 'work'], cloneParent)
  await sh(['config', 'user.name', 'Clone'], clone)
  await sh(['config', 'user.email', 'clone@example.com'], clone)
  fs.writeFileSync(path.join(clone, 'remote.txt'), 'from remote\n')
  await sh(['add', 'remote.txt'], clone)
  await sh(['commit', '-m', 'remote commit'], clone)
  await sh(['push'], clone)

  // fetch sees the new remote ref; pull fast-forwards the local branch
  const fetch = await service.fetch(repo)
  assert.equal(fetch.ok, true)
  const pull = await service.pull(repo, 'ff-only')
  assert.equal(pull.ok, true)
  assert.equal(fs.existsSync(path.join(repo, 'remote.txt')), true)

  fs.rmSync(remoteDir, { recursive: true, force: true })
  fs.rmSync(cloneParent, { recursive: true, force: true })
})

test('nested repo discovery: repo lives in a subdirectory of the session cwd', async () => {
  const service = ctx.get('gitService')
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-nested-'))
  const nested = path.join(parent, 'my-project')
  fs.mkdirSync(nested)
  await sh(['init'], nested)
  await sh(['config', 'user.name', 'Nested'], nested)
  await sh(['config', 'user.email', 'nested@example.com'], nested)
  fs.writeFileSync(path.join(nested, 'n.txt'), 'nested\n')
  await sh(['add', 'n.txt'], nested)
  await sh(['commit', '-m', 'nested init'], nested)
  // a file at the session-cwd level must stay invisible to the nested repo
  fs.writeFileSync(path.join(parent, 'outside.txt'), 'x')

  const check = await service.check(parent)
  assert.equal(check.ok, true)
  assert.equal(check.repo, true)
  // git reports the root with forward slashes; normalize before comparing
  assert.equal(path.resolve(check.root).toLowerCase(), nested.toLowerCase())
  assert.equal(check.nested, 1)

  const status = await service.status(parent)
  assert.equal(status.ok, true)
  assert.equal(status.files.length, 0)

  const tree = await service.tree(parent)
  assert.ok(tree.files.some((f) => f.path === 'n.txt'))
  assert.ok(!tree.files.some((f) => f.path === 'outside.txt'))

  const cat = await service.cat(parent, 'n.txt')
  assert.equal(cat.ok, true)
  assert.match(cat.content, /nested/)

  // mutations resolve through the nested root
  fs.writeFileSync(path.join(nested, 'n2.txt'), 'two\n')
  assert.equal((await service.stage(parent, ['n2.txt'])).ok, true)
  assert.equal((await service.commit(parent, 'nested two')).ok, true)

  fs.rmSync(parent, { recursive: true, force: true })
})

test('multiple nested repos: reported without picking a winner', async () => {
  const service = ctx.get('gitService')
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-multi-'))
  for (const name of ['a', 'b']) {
    const sub = path.join(parent, name)
    fs.mkdirSync(sub)
    await sh(['init'], sub)
  }
  const check = await service.check(parent)
  assert.equal(check.ok, true)
  assert.equal(check.repo, false)
  assert.equal(check.nested, 2)
  const status = await service.status(parent)
  assert.equal(status.ok, false)
  assert.equal(status.code, 'NOT_REPO')
  fs.rmSync(parent, { recursive: true, force: true })
})

test('dispose removes the service', async () => {
  const ctx2 = new Context()
  await ctx2.plugin(plugin)
  assert.equal(typeof ctx2.get('gitService'), 'object')
  await ctx2.fiber.dispose()
  // cordis v4: disposed services resolve to undefined (strict get does not throw)
  assert.equal(ctx2.get('gitService', false), undefined)
})
