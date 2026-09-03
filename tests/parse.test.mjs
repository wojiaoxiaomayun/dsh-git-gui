import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseStatusPorcelainV2,
  sortStatusFiles,
  parseUnifiedDiff,
  parseLog,
  parseRefs,
  parseStashList,
  parseRemotes,
} from '../lib/parse.js'

test('parseStatusPorcelainV2: full record set', () => {
  const raw = [
    '# branch.oid 0123456789abcdef0123456789abcdef01234567',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -1',
    '1 M. N... 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 src/a.txt',
    '2 R. N... 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 R100 src/new name.txt\0src/old.txt',
    '1 .M N... 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 src/b.txt',
    'u UU N... 100644 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 3333333333333333333333333333333333333333 src/conflict.txt',
    '? new file.txt',
    '! ignored.bin',
    '1 A. N... 100644 100644 100644 0000000000000000000000000000000000000000 4444444444444444444444444444444444444444 src/added.txt',
  ].join('\0') + '\0'

  const { branch, files } = parseStatusPorcelainV2(raw)
  assert.equal(branch.head, 'main')
  assert.equal(branch.upstream, 'origin/main')
  assert.equal(branch.ahead, 2)
  assert.equal(branch.behind, 1)
  assert.equal(branch.detached, false)
  assert.equal(branch.noCommits, false)

  const byPath = Object.fromEntries(files.map((f) => [f.path, f]))
  assert.deepEqual(byPath['src/a.txt'], { x: 'M', y: '.', sub: 'N...', path: 'src/a.txt' })
  assert.deepEqual(byPath['src/new name.txt'], { x: 'R', y: '.', sub: 'N...', path: 'src/new name.txt', origPath: 'src/old.txt' })
  assert.equal(byPath['src/b.txt'].y, 'M')
  assert.equal(byPath['src/conflict.txt'].x, 'U')
  assert.equal(byPath['src/conflict.txt'].y, 'U')
  assert.deepEqual(byPath['new file.txt'], { x: '?', y: '?', sub: '', path: 'new file.txt' })
  assert.deepEqual(byPath['ignored.bin'], { x: '!', y: '!', sub: '', path: 'ignored.bin' })
  assert.equal(byPath['src/added.txt'].x, 'A')
  assert.equal(files.length, 7)
})

test('parseStatusPorcelainV2: detached head + initial commit', () => {
  const raw = '# branch.oid (initial)\0# branch.head (detached)\0'
  const { branch } = parseStatusPorcelainV2(raw)
  assert.equal(branch.detached, true)
  assert.equal(branch.noCommits, true)
})

test('sortStatusFiles: staged first, untracked last', () => {
  const files = [
    { x: '?', y: '?', sub: '', path: 'z.txt' },
    { x: 'M', y: '.', sub: 'N...', path: 'a.txt' },
    { x: '.', y: 'M', sub: 'N...', path: 'b.txt' },
    { x: 'U', y: 'U', sub: 'N...', path: 'c.txt' },
  ]
  const sorted = sortStatusFiles(files)
  assert.equal(sorted[0].path, 'a.txt')
  assert.equal(sorted[1].path, 'b.txt')
  assert.equal(sorted[2].path, 'c.txt')
  assert.equal(sorted[3].path, 'z.txt')
})

test('parseUnifiedDiff: headers, hunks, line numbers, no-newline marker', () => {
  const raw = [
    'diff --git a/foo.txt b/foo.txt',
    'index 1111111..2222222 100644',
    '--- a/foo.txt',
    '+++ b/foo.txt',
    '@@ -1,3 +1,4 @@',
    ' context',
    '-old',
    '+new',
    '+extra',
    '\\ No newline at end of file',
    '@@ -10,2 +11,2 @@',
    ' x',
    '-y',
  ].join('\n')

  const { files, truncated } = parseUnifiedDiff(raw)
  assert.equal(truncated, false)
  assert.equal(files.length, 1)
  const file = files[0]
  assert.equal(file.newPath, 'foo.txt')
  assert.equal(file.oldPath, 'foo.txt')
  assert.equal(file.binary, false)
  assert.equal(file.hunks.length, 2)

  const h0 = file.hunks[0]
  assert.equal(h0.oldStart, 1)
  assert.equal(h0.newCount, 4)
  assert.deepEqual(h0.lines.map((l) => l.type), ['ctx', 'del', 'add', 'add'])
  assert.equal(h0.lines[0].oldLine, 1)
  assert.equal(h0.lines[1].oldLine, 2)
  assert.equal(h0.lines[2].newLine, 2)
  assert.equal(h0.lines[2].newline, true)
  assert.equal(h0.lines[3].newline, false) // `\ No newline` attaches to the previous line

  const h1 = file.hunks[1]
  assert.equal(h1.oldStart, 10)
  assert.deepEqual(h1.lines.map((l) => l.text), ['x', 'y'])
})

test('parseUnifiedDiff: binary file', () => {
  const raw = 'diff --git a/img.png b/img.png\nindex 111..222 100644\nBinary files a/img.png and b/img.png differ\n'
  const { files } = parseUnifiedDiff(raw)
  assert.equal(files[0].binary, true)
})

test('parseUnifiedDiff: new file mode + deleted file mode', () => {
  const raw = [
    'diff --git a/n.txt b/n.txt',
    'new file mode 100644',
    'index 0000000..2222222',
    '--- /dev/null',
    '+++ b/n.txt',
    '@@ -0,0 +1,1 @@',
    '+hello',
    'diff --git a/d.txt b/d.txt',
    'deleted file mode 100644',
    '--- a/d.txt',
    '+++ /dev/null',
    '@@ -1,1 +0,0 @@',
    '-bye',
  ].join('\n')
  const { files } = parseUnifiedDiff(raw)
  assert.equal(files.length, 2)
  assert.equal(files[0].newFile, true)
  assert.equal(files[1].deleted, true)
})

test('parseLog: records with parents, refs, authors', () => {
  const raw = [
    'abcdef0123456789abcdef0123456789abcdef01\0\0Alice\0a@x.io\u00001700000000\0first commit\0',
    'abcdef0123456789abcdef0123456789abcdef02\0abcdef0123456789abcdef0123456789abcdef01\0Bob\0b@x.io\u0000170000060\0second\0HEAD -> main, tag: v1',
    '',
  ].join('\x1e')
  const commits = parseLog(raw)
  assert.equal(commits.length, 2)
  assert.deepEqual(commits[0].parents, [])
  assert.equal(commits[0].author, 'Alice')
  assert.equal(commits[0].time, 1700000000)
  assert.deepEqual(commits[1].parents, ['abcdef0123456789abcdef0123456789abcdef01'])
  assert.deepEqual(commits[1].refs, ['HEAD -> main', 'tag: v1'])
})

test('parseRefs: current branch, upstream, track', () => {
  const raw = [
    'main\0a1b2c3d\0origin/main\0\0*\0',
    'feature/x\0d4e5f6a\0origin/feature/x\0[ahead 2, behind 1]\0 \0',
    'origin/main\0a1b2c3d\0\0\0 \0',
    'origin/HEAD\0a1b2c3d\0\0\0 \0',
  ].join('\n')
  const refs = parseRefs(raw)
  assert.equal(refs.length, 3) // origin/HEAD filtered
  assert.equal(refs[0].current, true)
  assert.equal(refs[1].track, '[ahead 2, behind 1]')
  assert.equal(refs[2].name, 'origin/main')
})

test('parseStashList + parseRemotes', () => {
  assert.deepEqual(parseStashList('stash@{0}\0abc123\0WIP on main: xyz\nstash@{1}\0def456\0older\n'), [
    { ref: 'stash@{0}', hash: 'abc123', subject: 'WIP on main: xyz' },
    { ref: 'stash@{1}', hash: 'def456', subject: 'older' },
  ])
  assert.deepEqual(parseRemotes('origin\thttps://x/y.git (fetch)\norigin\thttps://x/y.git (push)\nup\tgit@z:w.git (fetch)\n'), [
    { name: 'origin', fetch: 'https://x/y.git', push: 'https://x/y.git' },
    { name: 'up', fetch: 'git@z:w.git' },
  ])
})

test('parseUnifiedDiff: hunk line cap truncates', () => {
  const lines = ['diff --git a/b.txt b/b.txt', '@@ -1,1 +1,1 @@']
  for (let i = 0; i < 13000; i++) lines.push(` ${i}`)
  const { files, truncated } = parseUnifiedDiff(lines.join('\n'), { maxLinesPerFile: 12000 })
  assert.equal(truncated, true)
  const hunks = files[0].hunks
  assert.equal(hunks.length, 1)
})
