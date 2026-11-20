import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const scripts = path.dirname(fileURLToPath(import.meta.url))
// Release notes as a tag would carry them: newest first, with one entry older than the 1.4.1 floor.
const entry = (version, date, lang, items = 1) => ({ version, date, name: lang === 'zh' ? `${version} 中文标题` : `${version} English title`,
  items: Array.from({ length: items }, (_, i) => ({ t: lang === 'zh' ? `条目 ${i}` : `Item ${i}`, d: lang === 'zh' ? `说明 ${version} <版本>` : `Detail ${version} with <version> & more` })) })
const notes = (versions, lang) => versions.map(([v, d, n]) => entry(v, d, lang, n))
const RELEASES = [['1.4.30', '2026-11-21', 2], ['1.4.29', '2026-11-19', 1], ['1.4.1', '2026-11-09', 3], ['1.3.9', '2026-11-08', 1]]
function fixture(t, { latest = '1.4.29', status = 200, changelog = RELEASES, changelogStatus = 200 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sintbot-site-sync-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'scripts')); fs.mkdirSync(path.join(root, 'bin'))
  for (const name of ['sync-version.mjs', 'visible.mjs', 'changelog.mjs', 'build-guide-seo.mjs']) fs.copyFileSync(path.join(scripts, name), path.join(root, 'scripts', name))
  fs.writeFileSync(path.join(root, 'scripts/build-zh.mjs'), 'import fs from "node:fs";fs.writeFileSync(new URL("../built",import.meta.url),"yes")')
  const initial = { 'app.js': 'const VERSION = "1.4.29";\n', 'install.sh': '# reviewed 37-line installer\n', 'sitemap.xml': '<urlset><url><loc>https://sintbot.com/</loc><lastmod>2026-11-08</lastmod></url></urlset>', 'index.html': '<h1>SintBot</h1>' }
  for (const [name, text] of Object.entries(initial)) fs.writeFileSync(path.join(root, name), text)
  const bodies = { en: JSON.stringify(notes(changelog, 'en')), zh: JSON.stringify(notes(changelog, 'zh')) }
  fs.writeFileSync(path.join(root, 'bin/curl'), `#!${process.execPath}
const fs=require('fs');const u=process.argv.at(-1);fs.appendFileSync(process.env.REQUEST_LOG,u+'\\n');
const bodies=${JSON.stringify(bodies)};
process.stdout.write(u.includes('registry.npmjs.org')?JSON.stringify({version:${JSON.stringify(latest)}})+'\\n200'
  :u.endsWith('/CHANGELOG.en.json')?bodies.en+'\\n'+${changelogStatus}:u.endsWith('/CHANGELOG.json')?bodies.zh+'\\n'+${changelogStatus}
  :${JSON.stringify('# new tagged installer\n\n' + status)})`, { mode: 0o755 })
  const read = name => fs.readFileSync(path.join(root, name), 'utf8')
  const env = { ...process.env, PATH: path.join(root, 'bin') + path.delimiter + process.env.PATH, GITHUB_OUTPUT: path.join(root, 'output'), REQUEST_LOG: path.join(root, 'requests') }
  const run = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts/sync-version.mjs'), ...args], { encoding: 'utf8', env })
  const notesCli = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts/changelog.mjs'), ...args], { encoding: 'utf8', env })
  return { root, initial, read, run, notesCli }
}
test('same-version --write preserves reviewed installer and all generated files, without requesting tag', t => {
  const f = fixture(t), r = f.run('--write')
  assert.equal(r.status, 0, r.stderr)
  for (const [name, bytes] of Object.entries(f.initial)) assert.equal(f.read(name), bytes)
  assert.equal(f.read('requests').trim(), 'https://registry.npmjs.org/sintbot/latest')
  assert.equal(f.read('output'), 'changed=0\nversion=1.4.29\n')
  assert.equal(fs.existsSync(path.join(f.root, 'built')), false)
})
test('version advance fetches correct tag and regenerates site', t => {
  const f = fixture(t, { latest: '1.4.30' }), r = f.run('--write')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(f.read('app.js'), 'const VERSION = "1.4.30";\n')
  assert.equal(f.read('install.sh'), '# new tagged installer\n')
  assert.match(f.read('requests'), /v1\.4\.30\/install\.sh/)
  assert.equal(f.read('built'), 'yes')
  assert.equal(f.read('output'), 'changed=1\nversion=1.4.30\n')
})
test('missing production tag does not advance version or overwrite current installer', t => {
  const f = fixture(t, { latest: '1.4.30', status: 404 }), r = f.run('--write')
  assert.equal(r.status, 1)
  assert.match(r.stderr, /HTTP 404/)
  for (const [name, bytes] of Object.entries(f.initial)) assert.equal(f.read(name), bytes)
})
test('same explicit target also preserves a post-tag installer fix', t => {
  const f = fixture(t), r = f.run('--write', '--target', '1.4.29')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(f.read('install.sh'), f.initial['install.sh'])
  assert.equal(fs.existsSync(path.join(f.root, 'requests')), false)
})

test('version advance updates visible homepage labels after native guides are reviewed', t => {
  const f = fixture(t, { latest: '1.4.30' })
  fs.appendFileSync(path.join(f.root,'app.js'), 'const label = "sintbot v1.4.29 · 1.4.29 installation guide";\n')
  fs.mkdirSync(path.join(f.root,'guide/install'),{recursive:true})
  fs.writeFileSync(path.join(f.root,'guide/install/index.html'),'<h1>Reviewed 1.4.30 guide</h1>')
  const r = f.run('--write')
  assert.equal(r.status,0,r.stderr)
  assert.match(f.read('app.js'),/sintbot v1\.4\.30 · 1\.4\.30 installation guide/)
  assert.equal(f.read('guide/install/index.html'),'<h1>Reviewed 1.4.30 guide</h1>')
})
test('unreviewed native guides block version advance before changing any release files', t => {
  for (const name of ['guide/install/index.html','guide/usage/index.html','zh/guide/install/index.html','zh/guide/usage/index.html']) {
    const f = fixture(t, { latest: '1.4.30' })
    fs.mkdirSync(path.dirname(path.join(f.root,name)),{recursive:true})
    fs.writeFileSync(path.join(f.root,name),'<h1>1.4.29 release capabilities</h1>')
    const r = f.run('--write')
    assert.equal(r.status,1)
    assert.match(r.stderr,/Review .* before advancing the site/)
    for (const [file,bytes] of Object.entries(f.initial)) assert.equal(f.read(file),bytes)
    assert.equal(f.read(name),'<h1>1.4.29 release capabilities</h1>')
  }
})

// /changelog/ and /zh/changelog/ (scripts/changelog.mjs), regenerated from the tag when the version advances.
const ids = html => [...html.matchAll(/<section class="guide-section" id="([^"]+)"/g)].map(m => m[1])
test('version advance generates both changelog pages from the tag, one anchor per version from 1.4.1', t => {
  const f = fixture(t, { latest: '1.4.30' }), r = f.run('--write')
  assert.equal(r.status, 0, r.stderr)
  assert.match(f.read('requests'), /\/refs\/tags\/v1\.4\.30\/CHANGELOG\.en\.json\n/)
  assert.match(f.read('requests'), /\/refs\/tags\/v1\.4\.30\/CHANGELOG\.json\n/)
  for (const [file, lang, title, href] of [['changelog/index.html', 'en', '1.4.30 English title', '/zh/changelog/'], ['zh/changelog/index.html', 'zh-CN', '1.4.30 中文标题', '/changelog/']]) {
    const html = f.read(file)
    assert.deepEqual(ids(html), ['v1.4.30', 'v1.4.29', 'v1.4.1'])
    assert.match(html, new RegExp(`<html class="guide-root" lang="${lang}">`))
    assert.ok(html.includes(`<h2 id="heading-v1.4.30">1.4.30 · ${title}</h2>`))
    assert.match(html, /<time datetime="2026-11-21">2026-11-21<\/time>/)
    assert.match(html, new RegExp(`<a href="${href}" data-lang=`))
    assert.match(html, /<!-- Guide SEO: generated -->/)
    assert.doesNotMatch(html, /1\.3\.9|<version>|<版本>/)
    assert.equal((html.match(/<dt>/g) || []).length, 6)
  }
  assert.match(f.read('changelog/index.html'), /Detail 1\.4\.30 with &lt;version&gt; &amp; more/)
  assert.match(f.read('zh/changelog/index.html'), /说明 1\.4\.30 &lt;版本&gt;/)
  assert.match(r.stdout, /changelog\/index\.html 按 v1\.4\.30 标签的更新记录重新生成/)
})
test('changelog generation is idempotent: a second run and --check find nothing to change', t => {
  const f = fixture(t, { latest: '1.4.30' })
  assert.equal(f.run('--write').status, 0)
  const first = ['changelog/index.html', 'zh/changelog/index.html'].map(f.read)
  fs.writeFileSync(path.join(f.root, 'app.js'), 'const VERSION = "1.4.30";\n')
  const check = f.notesCli('--check')
  assert.equal(check.status, 0, check.stderr)
  const again = f.notesCli()
  assert.equal(again.status, 0, again.stderr)
  assert.match(again.stdout, /already up to date/)
  assert.deepEqual(['changelog/index.html', 'zh/changelog/index.html'].map(f.read), first)
  fs.appendFileSync(path.join(f.root, 'changelog/index.html'), '<!-- hand edit -->')
  assert.equal(f.notesCli('--check').status, 1)
})
test('changelog sitemap entries get today as lastmod when their text changes', t => {
  const f = fixture(t, { latest: '1.4.30' })
  fs.writeFileSync(path.join(f.root, 'sitemap.xml'), f.initial['sitemap.xml'].replace('</urlset>', '<url><loc>https://sintbot.com/changelog/</loc><lastmod>2026-11-08</lastmod></url><url><loc>https://sintbot.com/zh/changelog/</loc><lastmod>2026-11-08</lastmod></url></urlset>'))
  for (const file of ['changelog/index.html', 'zh/changelog/index.html']) { fs.mkdirSync(path.join(f.root, path.dirname(file)), { recursive: true }); fs.writeFileSync(path.join(f.root, file), '<p>1.4.29 notes</p>') }
  assert.equal(f.run('--write').status, 0)
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
  assert.equal((f.read('sitemap.xml').match(new RegExp(`changelog/</loc><lastmod>${today}<`, 'g')) || []).length, 2)
})
test('release notes without the new version, or missing at the tag, block the advance and change nothing', t => {
  for (const options of [{ changelog: RELEASES.slice(1) }, { changelogStatus: 404 }]) {
    const f = fixture(t, { latest: '1.4.30', ...options }), r = f.run('--write')
    assert.equal(r.status, 1)
    assert.match(r.stderr, /no entry for 1\.4\.30|HTTP 404/)
    for (const [name, bytes] of Object.entries(f.initial)) assert.equal(f.read(name), bytes)
    assert.equal(fs.existsSync(path.join(f.root, 'changelog')), false)
  }
})
test('--repo reads release notes at the tag, never from the working tree', t => {
  const f = fixture(t), repo = path.join(f.root, 'public')
  const git = (...args) => { const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr) }
  fs.mkdirSync(repo)
  git('init', '-q')
  for (const [name, lang] of [['CHANGELOG.en.json', 'en'], ['CHANGELOG.json', 'zh']]) fs.writeFileSync(path.join(repo, name), JSON.stringify(notes(RELEASES.slice(1), lang)))
  git('add', '.'); git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'notes'); git('tag', 'v1.4.29')
  for (const [name, lang] of [['CHANGELOG.en.json', 'en'], ['CHANGELOG.json', 'zh']]) fs.writeFileSync(path.join(repo, name), JSON.stringify(notes([['1.4.29', '2026-11-19', 9], ...RELEASES.slice(2)], lang)))
  const r = f.notesCli('--repo', repo)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(fs.existsSync(path.join(f.root, 'requests')), false)
  assert.deepEqual(ids(f.read('zh/changelog/index.html')), ['v1.4.29', 'v1.4.1'])
  assert.equal((f.read('changelog/index.html').match(/<dt>/g) || []).length, 4)
  assert.equal(f.notesCli('--repo', repo, '--version', '1.4.28').status, 1)
})
