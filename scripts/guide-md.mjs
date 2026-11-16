// Turns a directly maintained guide page (guide/*/index.html) into Markdown for llms-full.txt,
// so AI assistants can read the complete steps in one plain-text fetch. Only the article is
// converted: the table of contents, buttons, screenshots and decorative arrows are dropped.
const SITE = "https://sintbot.com";

const decode = (s) => s
  .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
const strip = (s) => s.replace(/<[^>]+>/g, "");
const oneLine = (s) => s.replace(/\s+/g, " ").trim();

export function guideMarkdown(html, pageUrl) {
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/);
  if (!article) throw new Error(`no <article> in ${pageUrl}`);
  let s = article[1];
  const keep = [];
  const hold = (md) => `\u0000${keep.push(md) - 1}\u0000`;

  // Code blocks first, verbatim.
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/g, (_, body) => hold(`\n\n\`\`\`\n${decode(strip(body)).replace(/\n+$/, "")}\n\`\`\`\n\n`));
  // Not content for a text reader.
  s = s.replace(/<button\b[\s\S]*?<\/button>/g, "")
    .replace(/<span\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g, "")
    .replace(/<a\b[^>]*class="guide-shot"[^>]*>[\s\S]*?<\/a>/g, "")
    .replace(/<img\b[^>]*>/g, "")
    .replace(/<p class="guide-(?:step|eyebrow)">[\s\S]*?<\/p>/g, "");
  // Tables.
  s = s.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/g, (_, body) => {
    const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((r) =>
      [...r[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => oneLine(inline(c[1], pageUrl)).replace(/\|/g, "\\|")));
    if (!rows.length) return "";
    const line = (cells) => `| ${cells.join(" | ")} |`;
    return hold(`\n\n${[line(rows[0]), line(rows[0].map(() => "---")), ...rows.slice(1).map(line)].join("\n")}\n\n`);
  });
  s = inline(s, pageUrl);
  // Blocks.
  s = s.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g, (_, t) => `\n\n# ${oneLine(strip(t.replace(/<br\s*\/?>/g, " ")))}\n\n`)
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g, (_, t) => `\n\n## ${oneLine(strip(t))}\n\n`)
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g, (_, t) => `\n\n### ${oneLine(strip(t))}\n\n`)
    .replace(/<summary\b[^>]*>([\s\S]*?)<\/summary>/g, (_, t) => `\n\n#### ${oneLine(strip(t))}\n\n`)
    .replace(/<div class="guide-meta">([\s\S]*?)<\/div>/g, (_, t) =>
      `\n\n${[...t.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/g)].map((m) => oneLine(strip(m[1]))).join(" · ")}\n\n`)
    .replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/g, (_, body) => {
      let n = 0;
      return `\n\n${[...body.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => `${++n}. ${oneLine(strip(m[1]))}`).join("\n")}\n\n`;
    })
    .replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/g, (_, body) =>
      `\n\n${[...body.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => `- ${oneLine(strip(m[1]))}`).join("\n")}\n\n`)
    .replace(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/g, (_, a, b) => `\n- **${oneLine(strip(a))}**: ${oneLine(strip(b))}\n`)
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/g, (_, t) => `\n\n> ${oneLine(strip(t))}\n\n`)
    .replace(/<div class="guide-note">\s*<strong>([\s\S]*?)<\/strong>/g, (_, t) => `\n\n**${oneLine(strip(t))}**\n\n`)
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<\/?(?:p|div|section|header|details|dl|li)\b[^>]*>/g, "\n\n");
  s = decode(strip(s));
  s = s.split("\n").map((l) => (l.includes("\u0000") ? l.trim() : oneLine(l))).join("\n");
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[Number(i)]);
  return s.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// Inline markup → Markdown. Links become absolute so the text stands on its own.
function inline(s, pageUrl) {
  return s
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, href, t) => {
      const label = oneLine(strip(t));
      if (!label) return "";
      const url = href.startsWith("#") ? pageUrl + href : href.startsWith("/") ? SITE + href : href;
      return `[${label}](${decode(url)})`;
    })
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/g, (_, t) => "`" + strip(t) + "`")
    .replace(/<kbd\b[^>]*>([\s\S]*?)<\/kbd>/g, (_, t) => "`" + strip(t) + "`")
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/g, (_, _t, t) => `**${oneLine(strip(t))}**`);
}
