// /changelog/ and /zh/changelog/: generated from the public repository's CHANGELOG.en.json / CHANGELOG.json
// as of a release tag (never a working tree), so the site lists exactly what that release published.
// One section per version from 1.4.1 up to the given one, anchor #v<version> (the console links there).
// The service only: desktop app versions are not listed.
//
//   node scripts/changelog.mjs                  regenerate both pages for the site's VERSION (app.js), tag read from GitHub
//   node scripts/changelog.mjs --check          exit 1 if either page differs from what the tag gives
//   node scripts/changelog.mjs --repo DIR       read the tag from a local clone (git show refs/tags/v<V>:<file>)
//   node scripts/changelog.mjs --version 1.2.3  another version (local checks only)
// sync-version.mjs --write calls this when it advances the site's version, before build-zh (llms-full.txt reads the pages).
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { guideSeo } from './build-guide-seo.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SITE = 'https://sintbot.com'
const REPO = 'sintlab/sintbot'
const FIRST = '1.4.1'
export const FILES = { en: 'changelog/index.html', zh: 'zh/changelog/index.html' }
const SOURCES = { en: 'CHANGELOG.en.json', zh: 'CHANGELOG.json' }

// 取网页用 curl:它认 https_proxy 等代理变量,Node 自带的 fetch 不认(墙内本机直连 raw.githubusercontent.com 会超时)
export function get(url) {
  const out = execFileSync('curl', ['-sSL', '--max-time', '30', '-w', '\n%{http_code}', url], { encoding: 'utf8' })
  const i = out.lastIndexOf('\n')
  return { status: Number(out.slice(i + 1)), text: out.slice(0, i) }
}

const SEMVER = /^\d+\.\d+\.\d+$/
const cmp = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

function readTagged(version, name, repo) {
  if (!repo) return get(`https://raw.githubusercontent.com/${REPO}/refs/tags/v${version}/${name}`)
  try {
    return { status: 200, text: execFileSync('git', ['-C', repo, 'show', `refs/tags/v${version}:${name}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch {
    return { status: 404, text: '' }
  }
}

// The releases a page lists: FIRST … version, newest first. Malformed notes fail instead of publishing a partial page.
function releases(list, version, name) {
  if (!Array.isArray(list)) throw new Error(`${name} at v${version} is not a list`)
  const seen = new Set()
  for (const e of list) {
    const ok = e && SEMVER.test(e.version) && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && typeof e.name === 'string' && e.name.trim() &&
      Array.isArray(e.items) && e.items.every((i) => i && typeof i.t === 'string' && i.t.trim() && typeof i.d === 'string')
    if (!ok) throw new Error(`${name} at v${version}: malformed entry ${JSON.stringify(e).slice(0, 80)}`)
    if (seen.has(e.version)) throw new Error(`${name} at v${version}: ${e.version} appears twice`)
    seen.add(e.version)
  }
  const picked = list.filter((e) => cmp(e.version, FIRST) >= 0 && cmp(e.version, version) <= 0).sort((a, b) => cmp(b.version, a.version))
  if (picked[0]?.version !== version) throw new Error(`${name} at v${version} has no entry for ${version}`)
  return picked
}

// Both files at the tag, checked and paired. A failed fetch carries .status (404 = no such tag).
export function loadChangelogs(version, { repo } = {}) {
  if (!SEMVER.test(version || '')) throw new Error(`not a version: ${version}`)
  const out = {}
  for (const [lang, name] of Object.entries(SOURCES)) {
    const res = readTagged(version, name, repo)
    if (res.status !== 200) throw Object.assign(new Error(`取 v${version} 标签的 ${name} 失败:HTTP ${res.status}`), { status: res.status })
    let list
    try { list = JSON.parse(res.text) } catch { throw new Error(`${name} at v${version} is not JSON`) }
    out[lang] = releases(list, version, name)
  }
  const key = (l) => l.map((e) => `${e.version}@${e.date}`).join(' ')
  if (key(out.en) !== key(out.zh)) throw new Error(`CHANGELOG.en.json and CHANGELOG.json at v${version} list different versions or dates`)
  return out
}

const text = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const attr = (s) => text(s).replace(/"/g, '&quot;')

const PICKER_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1m14 20-5-10-5 10M14 18h6"/></svg>'
const ANALYTICS = `<!-- Analytics: Umami (privacy-first, no cookies) + /track.js intent events; ?notrack=1 marks this browser as ours, ?notrack=0 undoes it -->
<script>try{var nt=new URLSearchParams(location.search).get("notrack");if(nt==="1")localStorage.setItem("umami.disabled","1");else if(nt==="0")localStorage.removeItem("umami.disabled")}catch(e){}</script>
<script defer src="https://cloud.umami.is/script.js" data-website-id="9ea8a003-6b41-41b9-9b1f-af5c0a22d845" data-domains="sintbot.com"></script>
<script defer src="/track.js"></script>`

const COPY = {
  en: {
    htmlLang: 'en', home: '/', prefix: '',
    title: 'Changelog · SintBot',
    description: (v) => `What changed in each SintBot release from ${FIRST} to ${v}, newest first: new features, fixes and changed behavior, as published with each version.`,
    skip: 'Skip to changelog', mainNav: 'Main navigation', navHome: 'Home', navInstall: 'Installation', navUsage: 'Usage',
    toc: 'Releases', kicker: 'CHANGELOG', h1: 'What changed in each release',
    lede: (v) => `Every SintBot release from ${FIRST} to ${v}, newest first, with the notes published for that version.`,
    latest: (v) => `Latest release: ${v}`,
    note: (v, src) => `To update, open Settings → Software updates in the console. This page is generated from <a href="${src}">CHANGELOG.en.json</a> at the v${v} tag of the public repository.`,
    footerTag: 'Coding agents in your project group.', footerNav: 'Footer', usage: 'Usage', changelog: 'Changelog', privacy: 'Privacy', terms: 'Terms', current: 'English',
  },
  zh: {
    htmlLang: 'zh-CN', home: '/zh/', prefix: '/zh',
    title: '更新记录 · SintBot',
    description: (v) => `SintBot 每个版本改了什么：从 ${FIRST} 到 ${v}，新版在前，列出新功能、修复和行为变化，与每版发布的更新说明一致。`,
    skip: '跳到更新记录', mainNav: '主导航', navHome: '首页', navInstall: '安装指南', navUsage: '使用说明',
    toc: '版本', kicker: '更新记录', h1: '<span class="zh-title-line">每个版本</span><span class="zh-title-line">改了什么</span>',
    lede: (v) => `SintBot 从 ${FIRST} 到 ${v} 的每个版本，新版在前，内容与该版发布的更新说明一致。`,
    latest: (v) => `最新版本 ${v}`,
    note: (v, src) => `在控制台「设置 → 软件更新」里升级。本页由公开仓 v${v} 标签里的 <a href="${src}">CHANGELOG.json</a> 生成。`,
    footerTag: '项目群里的编码助手。', footerNav: '页脚', usage: '使用说明', changelog: '更新记录', privacy: '隐私政策', terms: '服务条款', current: '简体中文',
  },
}

function page(lang, version, list) {
  const c = COPY[lang]
  const url = `${SITE}${c.prefix}/changelog/`
  const en = `${SITE}/changelog/`, zh = `${SITE}/zh/changelog/`
  const desc = attr(c.description(version))
  const src = `https://github.com/${REPO}/blob/v${version}/${SOURCES[lang]}`
  const toc = list.map((e) => `<li><a href="#v${e.version}"><span>${e.date.slice(5)}</span>${e.version}</a></li>`).join('')
  const sections = list.map((e) => {
    const items = e.items.length ? `<dl class="guide-definitions">${e.items.map((i) => `<dt>${text(i.t)}</dt><dd>${text(i.d)}</dd>`).join('')}</dl>` : ''
    return `<section class="guide-section" id="v${e.version}" aria-labelledby="heading-v${e.version}"><p class="guide-section-no"><time datetime="${e.date}">${e.date}</time></p><h2 id="heading-v${e.version}">${e.version} · ${text(e.name)}</h2>${items}</section>`
  }).join('\n')
  const cur = (target) => (target === lang ? ' aria-current="true"' : '')
  const html = `<!doctype html>
<html class="guide-root" lang="${c.htmlLang}"><head><meta charset="utf-8">${c.htmlLang === "en" ? '<script src="/lang.js"></script>' : ""}<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#13171c"><title>${text(c.title)}</title><meta name="description" content="${desc}"><link rel="canonical" href="${url}"><link rel="alternate" hreflang="en" href="${en}"><link rel="alternate" hreflang="zh-CN" href="${zh}"><link rel="alternate" hreflang="x-default" href="${en}"><meta property="og:title" content="${attr(c.title)}"><meta property="og:description" content="${desc}"><meta property="og:url" content="${url}"><meta property="og:type" content="article"><link rel="icon" type="image/svg+xml" href="/assets/favicon.svg"><link rel="preload" href="/assets/fonts/google-sans-flex-rounded-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/styles.css?v=20261121"><link rel="stylesheet" href="/guide.css"><script src="/guide.js" defer></script>${ANALYTICS}
</head>
<body class="guide-page"><a class="skip-link" href="#guide-content">${c.skip}</a><nav class="guide-nav" aria-label="${c.mainNav}"><a class="guide-brand" href="${c.home}"><img src="/assets/favicon.svg" width="28" height="28" alt=""><span>SintBot</span></a><div class="guide-nav__links"><a href="${c.home}">${c.navHome}</a><a href="${c.prefix}/guide/install/">${c.navInstall}</a><a href="${c.prefix}/guide/usage/">${c.navUsage}</a></div></nav>
<!-- GENERATED by scripts/changelog.mjs from ${SOURCES[lang]} at the v${version} tag of ${REPO}; do not edit by hand -->
<main class="guide-layout" id="guide-content"><aside class="guide-toc" aria-label="${c.toc}"><p>${c.toc}</p><ol>${toc}</ol></aside><article class="guide-article"><header class="guide-hero"><p class="guide-kicker">${c.kicker}</p><h1>${c.h1}</h1><p class="guide-lede">${text(c.lede(version))}</p><a class="guide-hero__link" href="#v${version}">${text(c.latest(version))} <span aria-hidden="true">↓</span></a></header>
${sections}
<div class="guide-note"><p>${c.note(version, src)}</p></div></article></main><footer class="guide-footer"><a href="${c.home}">SintBot</a><p>${c.footerTag}</p><nav aria-label="${c.footerNav}"><a href="${c.prefix}/guide/usage/">${c.usage}</a><a href="${c.prefix}/changelog/" aria-current="page">${c.changelog}</a><a href="/privacy.html">${c.privacy}</a><a href="/terms.html">${c.terms}</a></nav><details class="language-picker"><summary aria-label="Choose language">${PICKER_ICON}<span>${c.current}</span><span class="language-picker__arrow" aria-hidden="true">⌃</span></summary><nav class="language-picker__options" aria-label="Language"><a href="/changelog/" data-lang="en" class="lang-toggle__btn" lang="en" hreflang="en"${cur('en')}>English</a><a href="/zh/changelog/" data-lang="zh" class="lang-toggle__btn" lang="zh-CN" hreflang="zh-CN"${cur('zh')}>简体中文</a></nav></details></footer></body></html>
`
  return guideSeo(html, FILES[lang])
}

// [[file, html], …] for both languages.
export function changelogPages(version, notes) {
  return Object.keys(FILES).map((lang) => [FILES[lang], page(lang, version, notes[lang])])
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
  const version = opt('--version') || (readFileSync(path.join(ROOT, 'app.js'), 'utf8').match(/const VERSION = "([^"]+)";/) || [])[1]
  const pages = changelogPages(version, loadChangelogs(version, { repo: opt('--repo') }))
  const current = (f) => { try { return readFileSync(path.join(ROOT, f), 'utf8') } catch { return null } }
  const stale = pages.filter(([f, html]) => current(f) !== html).map(([f]) => f)
  if (args.includes('--check')) {
    if (stale.length) { console.error(`changelog: out of date for v${version}: ${stale.join(', ')} — run: node scripts/changelog.mjs`); process.exit(1) }
    console.log(`changelog: up to date with v${version}`)
  } else {
    for (const [f, html] of pages) { mkdirSync(path.dirname(path.join(ROOT, f)), { recursive: true }); writeFileSync(path.join(ROOT, f), html) }
    console.log(`changelog: v${version}, ${stale.length ? `wrote ${stale.join(', ')}` : 'already up to date'}`)
  }
}
