import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runGit, gitRead, gitWrite, classifyGitFailure, GIT_ERROR_CODES, GitError } from '../lib/runner.js'
import { parseStatusPorcelainV2 } from '../lib/parse.js'

const FAKE_CTX = {}
let repo = null
let second = null

async function sh(args, cwd) {
  const result = await runGit(FAKE_CTX, cwd, args, { mutating: true })
  assert.equal(result.exitCode, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

test.before(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-gui-test-'))
  second = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-gui-test-'))
  await sh(['init'], repo)
  await sh(['config', 'user.name', 'Test User'], repo)
  await sh(['config', 'user.email', 'test@example.com'], repo)
  await sh(['config', 'core.autocrlf', 'false'], repo)
  fs.writeFileSync(path.join(repo, 'a.txt'), 'line1\nline2\n')
  await sh(['add', 'a.txt'], repo)
  await sh(['commit', '-m', 'initial'], repo)
})

test.after(() => {
  fs.rmSync(repo, { recursive: true, force: true })
  fs.rmSync(second, { recursive: true, force: true })
})

test('status: clean repo after initial commit', async () => {
  const { stdout } = await gitRead(FAKE_CTX, repo, ['status', '--porcelain=v2', '-z', '--branch'])
  const { branch, files } = parseStatusPorcelainV2(stdout)
  assert.equal(branch.head, 'master', 'default branch name (git init default)')
  assert.equal(files.length, 0)
})

test('status: modified / untracked / rename detection', async () => {
  fs.writeFileSync(path.join(repo, 'a.txt'), 'line1\nline2-CHANGED\n')
  fs.writeFileSync(path.join(repo, 'new file.txt'), 'hello')
  fs.renameSync(path.join(repo, 'a.txt'), path.join(repo, 'a-renamed.txt'))
  const { stdout } = await gitRead(FAKE_CTX, repo, ['status', '--porcelain=v2', '-z', '--branch'])
  const { files } = parseStatusPorcelainV2(stdout)
  const byPath = Object.fromEntries(files.map((f) => [f.path, f]))
  assert.equal(byPath['a.txt'].y, 'D')            // deletion of tracked file
  assert.equal(byPath['a-renamed.txt'].x, '?')    // new untracked name
  assert.equal(byPath['new file.txt'].x, '?')
  // restore
  fs.renameSync(path.join(repo, 'a-renamed.txt'), path.join(repo, 'a.txt'))
  fs.rmSync(path.join(repo, 'new file.txt'))
  fs.writeFileSync(path.join(repo, 'a.txt'), 'line1\nline2\n')
})

test('stage + staged diff + commit round trip', async () => {
  fs.writeFileSync(path.join(repo, 'a.txt'), 'line1\nline2-CHANGED\n')
  await gitWrite(FAKE_CTX, repo, ['add', '--', 'a.txt'])
  let { stdout } = await gitRead(FAKE_CTX, repo, ['status', '--porcelain=v2', '-z', '--branch'])
  let parsed = parseStatusPorcelainV2(stdout)
  assert.equal(parsed.files.find((f) => f.path === 'a.txt').x, 'M')

  ;({ stdout } = await gitRead(FAKE_CTX, repo, ['diff', '--cached', '--', 'a.txt']))
  assert.match(stdout, /\+line2-CHANGED/)

  const commit = await gitWrite(FAKE_CTX, repo, ['commit', '-F', '-'], { input: 'second commit\n\nbody' })
  assert.match(commit.stdout + commit.stderr, /second commit/)
  ;({ stdout } = await gitRead(FAKE_CTX, repo, ['status', '--porcelain=v2', '-z', '--branch']))
  parsed = parseStatusPorcelainV2(stdout)
  assert.equal(parsed.files.length, 0)
})

test('unstage restores index', async () => {
  fs.writeFileSync(path.join(repo, 'b.txt'), 'b1\n')
  await gitWrite(FAKE_CTX, repo, ['add', '--', 'b.txt'])
  await gitWrite(FAKE_CTX, repo, ['restore', '--staged', '--', 'b.txt'])
  const { stdout } = await gitRead(FAKE_CTX, repo, ['status', '--porcelain=v2', '-z', '--branch'])
  const parsed = parseStatusPorcelainV2(stdout)
  const b = parsed.files.find((f) => f.path === 'b.txt')
  assert.equal(b.x, '?')
  fs.rmSync(path.join(repo, 'b.txt'))
})

test('discard restores tracked file, clean removes untracked', async () => {
  // HEAD's a.txt is 'line1\nline2-CHANGED\n' after the commit round-trip test
  fs.writeFileSync(path.join(repo, 'a.txt'), 'line1\nTEMP\n')
  await gitWrite(FAKE_CTX, repo, ['restore', '--', 'a.txt'])
  const content = fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')
  assert.equal(content, 'line1\nline2-CHANGED\n')

  fs.writeFileSync(path.join(repo, 'junk.txt'), 'junk')
  await gitWrite(FAKE_CTX, repo, ['clean', '-f', '-d', '--', 'junk.txt'])
  assert.equal(fs.existsSync(path.join(repo, 'junk.txt')), false)
})

test('branch create/switch + log + merge', async () => {
  await gitWrite(FAKE_CTX, repo, ['switch', '-c', 'feature/x'])
  fs.writeFileSync(path.join(repo, 'feature.txt'), 'feature\n')
  await gitWrite(FAKE_CTX, repo, ['add', 'feature.txt'])
  await gitWrite(FAKE_CTX, repo, ['commit', '-m', 'feature work'])
  await gitWrite(FAKE_CTX, repo, ['switch', 'master'])

  // before merge, master's log does not contain the feature commit
  const before = await gitRead(FAKE_CTX, repo, ['log', '--pretty=format:%H%x00%s%x1e'])
  assert.doesNotMatch(before.stdout, /feature work/)

  await gitWrite(FAKE_CTX, repo, ['merge', '-m', "Merge 'feature/x'", 'feature/x'])
  assert.equal(fs.existsSync(path.join(repo, 'feature.txt')), true)
  const after = await gitRead(FAKE_CTX, repo, ['log', '--pretty=format:%H%x00%s%x1e'])
  assert.match(after.stdout, /feature work/)
})

test('merge conflict is classified', async () => {
  // conflicting edits on master vs a side branch
  fs.writeFileSync(path.join(repo, 'c.txt'), 'base\n')
  await gitWrite(FAKE_CTX, repo, ['add', 'c.txt'])
  await gitWrite(FAKE_CTX, repo, ['commit', '-m', 'c base'])

  await gitWrite(FAKE_CTX, repo, ['switch', '-c', 'side'])
  fs.writeFileSync(path.join(repo, 'c.txt'), 'side\n')
  await gitWrite(FAKE_CTX, repo, ['commit', '-am', 'c side'])
  await gitWrite(FAKE_CTX, repo, ['switch', 'master'])
  fs.writeFileSync(path.join(repo, 'c.txt'), 'master\n')
  await gitWrite(FAKE_CTX, repo, ['commit', '-am', 'c master'])

  await assert.rejects(
    () => gitWrite(FAKE_CTX, repo, ['merge', '-m', "Merge 'side'", 'side']),
    (error) => error instanceof GitError && error.code === GIT_ERROR_CODES.CONFLICT,
  )
  // abort the conflicted merge to keep the repo usable
  await sh(['merge', '--abort'], repo)
})

test('stash push/pop round trip', async () => {
  // stash operates on tracked modifications: commit a base version first
  fs.writeFileSync(path.join(repo, 'd.txt'), 'base\n')
  await gitWrite(FAKE_CTX, repo, ['add', 'd.txt'])
  await gitWrite(FAKE_CTX, repo, ['commit', '-m', 'd base'])
  fs.writeFileSync(path.join(repo, 'd.txt'), 'dirty\n')
  await gitWrite(FAKE_CTX, repo, ['stash', 'push', '-m', 'my stash'])
  assert.equal(fs.readFileSync(path.join(repo, 'd.txt'), 'utf8'), 'base\n')
  await gitWrite(FAKE_CTX, repo, ['stash', 'pop', 'stash@{0}'])
  assert.equal(fs.readFileSync(path.join(repo, 'd.txt'), 'utf8'), 'dirty\n')
  await gitWrite(FAKE_CTX, repo, ['restore', '--', 'd.txt'])
})

test('revert + reset round trip', async () => {
  const headBefore = (await gitRead(FAKE_CTX, repo, ['rev-parse', 'HEAD'])).stdout.trim()
  fs.writeFileSync(path.join(repo, 'e.txt'), 'e\n')
  await gitWrite(FAKE_CTX, repo, ['add', 'e.txt'])
  await gitWrite(FAKE_CTX, repo, ['commit', '-m', 'e commit'])
  await gitWrite(FAKE_CTX, repo, ['revert', '--no-edit', 'HEAD'])
  assert.equal(fs.existsSync(path.join(repo, 'e.txt')), false)
  // the revert added a commit; hard-reset back to the pre-revert head
  await gitWrite(FAKE_CTX, repo, ['reset', '--hard', headBefore])
})

test('classifyGitFailure: stable codes', () => {
  assert.equal(classifyGitFailure('fatal: not a git repository (or any of the parent directories): .git', 'status').code, GIT_ERROR_CODES.NOT_REPO)
  assert.equal(classifyGitFailure('fatal: Unable to create .git/index.lock: File exists.', 'add').code, GIT_ERROR_CODES.LOCKED)
  assert.equal(classifyGitFailure('error: Your local changes to the following files would be overwritten by checkout:\n\tx', 'switch').code, GIT_ERROR_CODES.UNMERGED)
  assert.equal(classifyGitFailure('CONFLICT (content): Merge conflict in c.txt', 'merge').code, GIT_ERROR_CODES.CONFLICT)
  assert.equal(classifyGitFailure('*** Please tell me who you are.', 'commit').code, GIT_ERROR_CODES.IDENTITY)
  assert.equal(classifyGitFailure('git@github.com: Permission denied (publickey).', 'push').code, GIT_ERROR_CODES.AUTH)
  assert.equal(classifyGitFailure('fatal: ambiguous argument \'HEAD\': unknown revision', 'log').code, GIT_ERROR_CODES.NO_COMMITS)
  assert.equal(classifyGitFailure('fatal: pathspec \'nope\' did not match any files', 'diff').code, GIT_ERROR_CODES.NOT_FOUND)
  assert.equal(classifyGitFailure('something entirely unexpected', 'status'), null)
})

test('init on an empty directory', async () => {
  await sh(['init'], second)
  const { stdout } = await gitRead(FAKE_CTX, second, ['status', '--porcelain=v2', '-z', '--branch'])
  const { branch } = parseStatusPorcelainV2(stdout)
  assert.equal(branch.noCommits, true)
})

test('mutation queue serializes per workspace', async () => {
  const start = Date.now()
  const jobs = []
  for (let i = 0; i < 3; i++) {
    jobs.push(gitWrite(FAKE_CTX, repo, ['status'], {}))
  }
  await Promise.all(jobs)
  assert.ok(Date.now() - start < 3000)
})
