#!/usr/bin/env node
// Renders the page's static text from the translations table in app.js — the one place copy lives —
// and derives everything that must say the same thing:
//
//   index.html     English body text, <head>, JSON-LD (SoftwareApplication + FAQPage)
//   zh/index.html  the same page with Chinese body text, <head>, JSON-LD
//   llms.txt       plain-text summary, key facts + FAQ in both languages, for AI assistants
//   llms-full.txt  llms.txt's facts and FAQ plus the guide pages as Markdown
//
// Why static: share-card unfurlers (Lark, WeChat, Slack) and AI crawlers read HTML without running JS.
// app.js still switches languages in the browser exactly as before.
//
//   node scripts/build-zh.mjs          write all three files
//   node scripts/build-zh.mjs --check  exit 1 if any is out of date (pre-commit hook)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { guideMarkdown } from "./guide-md.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const SITE = "https://sintbot.com";

// --- translations: evaluate just the literal out of app.js (the IIFE touches the DOM) ---
const appJs = readFileSync(join(root, "app.js"), "utf8");
const version = appJs.match(/const VERSION = "[^"]*";/);
const start = appJs.indexOf("const translations = {");
const end = appJs.indexOf("\n  };\n", start);
if (!version || start < 0 || end < 0) fail("could not locate VERSION / translations in app.js");
const { VERSION, translations: t } = vm.runInNewContext(`${version[0]}\n${appJs.slice(start, end + 5)}\n({ VERSION, translations })`);
for (const k of ["meta.title", "meta.description", "meta.ogAlt"]) {
  if (!t[k] || !t[k].en || !t[k].zh) fail(`translations["${k}"] needs both en and zh`);
}
// The desktop download link on the page is the one source for the app version and its URL.
const pageSrc = readFileSync(join(root, "index.html"), "utf8");
const dmgs = [...new Set(pageSrc.match(/https:\/\/github\.com\/sintlab\/sintbot-desktop\/releases\/latest\/download\/SintBot_\d+\.\d+\.\d+_aarch64\.dmg/g) || [])];
if (dmgs.length !== 1) fail(`expected one desktop download URL in index.html, found ${dmgs.length}`);
const DMG = dmgs[0];
const DESKTOP = DMG.match(/SintBot_(\d+\.\d+\.\d+)_/)[1];
const faqIds = Object.keys(t).map((k) => k.match(/^faq\.(\d+)\.q$/)).filter(Boolean).map((m) => m[1]).sort((a, b) => a - b);

const attr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const text = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const plain = (html) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

// --- body: fill every data-i18n* element from the table --------------------------------
// Finds the element's matching close tag by counting nested tags of the same name, so inner
// markup (<em>, <code>, nested <span>) is replaced whole — the same thing innerHTML does in app.js.
function renderBody(html, lang) {
  const out = [];
  let pos = 0;
  const open = /<([a-zA-Z][\w-]*)\b[^>]*\sdata-i18n(-html|-svg)?="([^"]+)"[^>]*>/g;
  let m;
  while ((m = open.exec(html))) {
    const [tag, name, kind, key] = m;
    const entry = t[key];
    if (!entry) fail(`index.html uses data-i18n key "${key}" that app.js does not define`);
    const value = entry[lang] != null ? entry[lang] : entry.en;
    const innerStart = m.index + tag.length;
    const close = findClose(html, name, innerStart);
    out.push(html.slice(pos, innerStart), kind === "-html" ? value : text(value));
    pos = close;
    open.lastIndex = close;
  }
  out.push(html.slice(pos));
  let result = out.join("");
  // alt attributes
  result = result.replace(/(<img\b[^>]*\salt=")[^"]*("[^>]*\sdata-i18n-alt="([^"]+)")/g, (_, a, b, key) => {
    if (!t[key]) fail(`index.html uses data-i18n-alt key "${key}" that app.js does not define`);
    return a + attr(t[key][lang] != null ? t[key][lang] : t[key].en) + b;
  });
  result = result.replace(/(<span data-language-current>)[^<]*(<\/span>)/,
    (_, a, b) => a + (lang === "zh" ? "简体中文" : "English") + b);
  result = result.replace(/(<a\b[^>]*data-lang="(en|zh)"[^>]*?)(?: aria-current="true")?>/g,
    (_, tag, target) => tag.replace(/ aria-current="true"/, "") + (target === lang ? ' aria-current="true"' : '') + '>');
  return result;
}

function findClose(html, name, from) {
  const re = new RegExp(`<(/?)${name}\\b[^>]*>`, "gi");
  re.lastIndex = from;
  let depth = 1, m;
  while ((m = re.exec(html))) {
    if (m[0].endsWith("/>")) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index;
  }
  fail(`no closing </${name}> after offset ${from}`);
}

// --- head --------------------------------------------------------------------------------
function setOnce(html, re, value, label) {
  const hits = html.match(new RegExp(re.source, "g"));
  if (!hits || hits.length !== 1) fail(`expected exactly one ${label} in index.html, found ${hits ? hits.length : 0}`);
  return html.replace(re, (_, a, b) => a + value + b);
}

function jsonLd(lang) {
  const page = lang === "zh" ? `${SITE}/zh/` : `${SITE}/`;
  const authorId = `${SITE}/#author`;
  const publisherId = `${SITE}/#publisher`;
  const websiteId = `${SITE}/#website`;
  const graph = [
    {
      "@type": "Organization", "@id": publisherId,
      name: "SintLab", url: "https://sintlab.com/",
      sameAs: ["https://github.com/sintlab"],
    },
    {
      "@type": "WebSite", "@id": websiteId,
      name: "SintBot", url: `${SITE}/`,
      inLanguage: ["en", "zh-CN"],
      publisher: { "@id": publisherId },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE}/#software`,
      name: "SintBot",
      url: page,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "macOS",
      softwareVersion: VERSION,
      license: "https://polyformproject.org/licenses/shield/1.0.0",
      isAccessibleForFree: true,
      downloadUrl: DMG,
      installUrl: lang === "zh" ? `${SITE}/zh/guide/install/` : `${SITE}/guide/install/`,
      softwareRequirements: lang === "zh"
        ? "macOS 12 及以上的 Mac（Apple 芯片或 Intel）；已安装并登录的 Claude Code 或 Codex"
        : "Mac with Apple silicon or Intel, macOS 12 or later; Claude Code or Codex installed and signed in",
      author: { "@id": authorId },
      creator: { "@id": authorId },
      // Same entity elsewhere: only public pages that are SintBot itself (cc-bot is a separate project).
      sameAs: ["https://github.com/sintlab/sintbot", "https://www.npmjs.com/package/sintbot"],
      // Publishing/project identity only. Authorship belongs solely to WaterTian.
      publisher: { "@id": publisherId },
      inLanguage: lang === "zh" ? "zh-CN" : "en",
      description: t["meta.description"][lang],
    },
    {
      "@type": "Person",
      "@id": authorId,
      name: "WaterTian",
      url: "https://github.com/WaterTian",
      sameAs: ["https://github.com/WaterTian"],
    },
    {
      "@type": "FAQPage",
      "@id": `${page}#faq`,
      url: `${page}#faq`,
      isPartOf: { "@id": websiteId },
      inLanguage: lang === "zh" ? "zh-CN" : "en",
      mainEntity: faqIds.map((i) => ({
        "@type": "Question",
        name: plain(t[`faq.${i}.q`][lang]),
        acceptedAnswer: { "@type": "Answer", text: plain(t[`faq.${i}.a`][lang]) },
      })),
    },
  ];
  const body = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2)
    .replace(/</g, "\\u003c").split("\n").map((l) => "      " + l).join("\n");
  return `<script type="application/ld+json">\n${body}\n    </script>`;
}

function head(html, lang) {
  const zh = lang === "zh";
  const pick = (k) => t[k][lang];
  const page = zh ? `${SITE}/zh/` : `${SITE}/`;
  const meta = (attrName, key) => new RegExp(`(<meta\\s+${attrName}="${key}"\\s+content=")[^"]*(")`);
  html = setOnce(html, /(<html lang=")[^"]*(")/, zh ? "zh-CN" : "en", "<html lang>");
  html = setOnce(html, /(<title>)[^<]*(<\/title>)/, text(pick("meta.title")), "<title>");
  html = setOnce(html, meta("name", "description"), attr(pick("meta.description")), "meta description");
  html = setOnce(html, meta("property", "og:title"), attr(pick("meta.title")), "og:title");
  html = setOnce(html, meta("property", "og:description"), attr(pick("meta.description")), "og:description");
  html = setOnce(html, meta("name", "twitter:title"), attr(pick("meta.title")), "twitter:title");
  html = setOnce(html, meta("name", "twitter:description"), attr(pick("meta.description")), "twitter:description");
  html = setOnce(html, meta("property", "og:url"), page, "og:url");
  html = setOnce(html, meta("property", "og:locale"), zh ? "zh_CN" : "en_US", "og:locale");
  html = setOnce(html, /(<link rel="canonical" href=")[^"]*(")/, page, "canonical");
  const image = `${SITE}/assets/og-banner${zh ? "-zh" : ""}.png?v=20261111`;
  html = setOnce(html, meta("property", "og:image"), image, "og:image");
  html = setOnce(html, meta("property", "og:image:alt"), attr(pick("meta.ogAlt")), "og:image:alt");
  html = setOnce(html, meta("name", "twitter:image"), image, "twitter:image");
  html = setOnce(html, meta("name", "twitter:image:alt"), attr(pick("meta.ogAlt")), "twitter:image:alt");
  const ld = html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g);
  if (!ld || ld.length !== 1) fail(`expected exactly one JSON-LD block in index.html, found ${ld ? ld.length : 0}`);
  html = html.replace(/\s*<link rel="describedby"[^>]*>/g, "");
  html = html.replace(/\s*<\/head>/, `\n    <link rel="describedby" type="text/plain" href="${SITE}/llms.txt" title="SintBot summary for AI readers">\n    <link rel="describedby" type="text/plain" href="${SITE}/llms-full.txt" title="SintBot full documentation">\n  </head>`);
  return html.replace(ld[0], jsonLd(lang));
}

// --- llms.txt / llms-full.txt ------------------------------------------------------------
// Key facts answer what an assistant is asked most (cost, requirements, how to install, where
// it runs) in one place, in both languages. Versions come from app.js and the page's download link.
function facts(lang) {
  if (lang === "zh") return `## 要点

- 费用：免费开源，没有付费版，不用注册 SintBot 账号。费用只来自你自己选的模型套餐或 API Key。
- 许可：PolyForm Shield 1.0.0（https://polyformproject.org/licenses/shield/1.0.0）。
- 运行环境：macOS 12 及以上的 Mac（Apple 芯片或 Intel）；需要已安装并登录的 Claude Code 或 Codex。
- 聊天平台：飞书群、企业微信的群和单聊、Slack 的频道和私聊；也可以不接聊天平台，在 App 里本机对话。
- 模型：通过 Claude Code 用 Claude，通过 Codex 用 GPT；GLM、MiniMax、DeepSeek、Kimi 等通过兼容端点和自己的 API Key 接入。
- 安装（推荐，桌面版 ${DESKTOP}）：下载 ${DMG} （Intel 芯片：${DMG.replace('_aarch64.dmg', '_x64.dmg')}），把 SintBot 拖进「应用程序」后打开。App 自带 SintBot 服务和 Node.js。
- 安装（终端，需要 Node.js 22 及以上）：\`curl -fsSL ${SITE}/install.sh | bash\`，后续步骤见 ${SITE}/zh/guide/install/#terminal
- 当前版本：服务 ${VERSION}（npm 包 \`sintbot\`），桌面版 ${DESKTOP}。
- 更新：在控制台「设置 → 软件更新」里完成。
- 数据：项目、笔记和设置是你 Mac 上的普通文件；聊天平台和模型服务需要联网。
- 作者 WaterTian，发布方 SintLab。`;
  return `## Key facts

- Cost: free and open source, with no paid tier and no SintBot account. The only costs are the model plans or API keys you choose.
- License: PolyForm Shield 1.0.0 (https://polyformproject.org/licenses/shield/1.0.0).
- Runs on: Macs with Apple silicon or Intel, macOS 12 or later; needs an installed, signed-in Claude Code or Codex.
- Chat platforms: Slack channels and direct messages, Feishu groups, WeCom groups and direct chats; or a local conversation in the app with no chat account.
- Models: Claude through Claude Code, GPT through Codex; GLM, MiniMax, DeepSeek, Kimi and other services through compatible endpoints and your own API keys.
- Install (recommended, desktop app ${DESKTOP}): download ${DMG} (Intel: ${DMG.replace('_aarch64.dmg', '_x64.dmg')}), move SintBot to Applications and open it. The app includes the SintBot service and Node.js.
- Install (terminal, needs Node.js 22+): \`curl -fsSL ${SITE}/install.sh | bash\`, then follow ${SITE}/guide/install/#terminal
- Current versions: service ${VERSION} (npm package \`sintbot\`), desktop app ${DESKTOP}.
- Updates: from the console, Settings → Software updates.
- Data: projects, notes and settings are ordinary files on your Mac; chat platforms and model services need a network connection.
- Author WaterTian; publisher SintLab.`;
}

const faqMd = (lang) => faqIds.map((i) => `### ${plain(t[`faq.${i}.q`][lang])}\n\n${plain(t[`faq.${i}.a`][lang])}`).join("\n\n");

function llms() {
  return `# SintBot

> ${t["meta.description"].en}

Generated from ${SITE}/ by scripts/build-zh.mjs — the same facts as the page. The full guides as Markdown: ${SITE}/llms-full.txt

${facts("en")}

## Pages

- [SintBot (English)](${SITE}/): product workflow, chat platforms, Claude Code and Codex, model choices, visual collaboration and project management
- [SintBot（中文）](${SITE}/zh/): 同一页面的中文版
- [Installation guide](${SITE}/guide/install/): desktop app download, connecting Slack, Feishu or WeCom, the terminal alternative and the first task
- [Usage guide](${SITE}/guide/usage/): task briefs, model selection, project notes and daily workflows
- Platform walkthroughs: [Slack](${SITE}/guide/slack/), [Feishu](${SITE}/guide/feishu/), [WeCom](${SITE}/guide/wecom/)
- [Changelog](${SITE}/changelog/): what changed in each release, generated from the release notes at the version's tag
- [安装指南](${SITE}/zh/guide/install/): 桌面版下载，连接 Slack、飞书、企业微信，终端安装与第一条任务
- [使用说明](${SITE}/zh/guide/usage/): 派活、模型、记忆与协作
- 平台专题：[Slack](${SITE}/zh/guide/slack/)、[飞书](${SITE}/zh/guide/feishu/)、[企业微信](${SITE}/zh/guide/wecom/)
- [更新记录](${SITE}/zh/changelog/): 每个版本改了什么，由该版标签里的更新说明生成
- [Full documentation](${SITE}/llms-full.txt): these facts, the FAQ and all guide pages as Markdown, in English and Chinese
- [SintBot on GitHub](https://github.com/sintlab/sintbot): code and documentation for SintBot
- [SintBot for macOS on GitHub](https://github.com/sintlab/sintbot-desktop): the desktop app; releases carry the signed and notarized disk image
- [sintbot on npm](https://www.npmjs.com/package/sintbot): exact version ${VERSION}; use the isolated installer and versioned guide on the website
- [WaterTian](https://github.com/WaterTian): the sole author of SintBot
- [SintLab](https://sintlab.com/): the publisher and project studio for SintBot
- [Terms of Service](${SITE}/terms.html): licensing and acceptable use
- [Privacy Policy](${SITE}/privacy.html): what the site and the software do and do not send
- [cc-bot on GitHub](https://github.com/WaterTian/cc-bot): the companion MIT-licensed Claude Code plugin

## FAQ

${faqMd("en")}

## 中文

> ${t["meta.description"].zh}

${facts("zh")}

## 常见问题

${faqMd("zh")}
`;
}

const GUIDES = [
  ["guide/install/index.html", `${SITE}/guide/install/`],
  ["guide/usage/index.html", `${SITE}/guide/usage/`],
  ["zh/guide/install/index.html", `${SITE}/zh/guide/install/`],
  ["zh/guide/usage/index.html", `${SITE}/zh/guide/usage/`],
  ...["slack", "feishu", "wecom"].flatMap(p => [[`guide/${p}/index.html`, `${SITE}/guide/${p}/`], [`zh/guide/${p}/index.html`, `${SITE}/zh/guide/${p}/`]]),
];
// Generated by scripts/changelog.mjs; listed last in each language.
const CHANGELOGS = [["changelog/index.html", `${SITE}/changelog/`], ["zh/changelog/index.html", `${SITE}/zh/changelog/`]];

function llmsFull() {
  const guide = ([file, url]) => {
    const md = guideMarkdown(readFileSync(join(root, file), "utf8"), url);
    // Guide pages start with their own H1; nest them under this file's sections.
    return `Source: ${url}\n\n${md.replace(/^(#{1,5}) /gm, "#$1 ")}`;
  };
  return `# SintBot — full documentation

> ${t["meta.description"].en}

Generated from ${SITE}/ and its guide pages by scripts/build-zh.mjs, with the same text as the pages. Summary: ${SITE}/llms.txt

${facts("en")}

## FAQ

${faqMd("en")}

${[...GUIDES.slice(0, 2), CHANGELOGS[0]].map(guide).join("\n\n")}

# 中文

> ${t["meta.description"].zh}

${facts("zh")}

## 常见问题

${faqMd("zh")}

${[...GUIDES.slice(2), CHANGELOGS[1]].map(guide).join("\n\n")}`;
}

// --- write / check -----------------------------------------------------------------------
const MARK = "<!-- GENERATED from /index.html by scripts/build-zh.mjs — edit index.html / app.js, then run the script -->";
const src = pageSrc;
const en = renderBody(head(src, "en"), "en");
const zh = renderBody(head(src, "zh"), "zh").replace("<head>", `<head>\n    ${MARK}`).replace(/href="\/(guide|changelog)\//g, 'href="/zh/$1/');

const targets = [["index.html", en], [join("zh", "index.html"), zh], ["llms.txt", llms()], ["llms-full.txt", llmsFull()]];
if (check) {
  const stale = targets.filter(([f, want]) => !existsSync(join(root, f)) || readFileSync(join(root, f), "utf8") !== want).map(([f]) => f);
  if (stale.length) fail(`out of date: ${stale.join(", ")} — run: node scripts/build-zh.mjs`);
  console.log("build-zh: up to date");
} else {
  mkdirSync(join(root, "zh"), { recursive: true });
  for (const [f, content] of targets) writeFileSync(join(root, f), content);
  console.log(`build-zh: wrote index.html, zh/index.html, llms.txt, llms-full.txt (${faqIds.length} FAQ entries)`);
}

function fail(msg) { console.error(`build-zh: ${msg}`); process.exit(1); }
