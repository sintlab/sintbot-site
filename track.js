/* SintBot site analytics. Umami's script.js records page views; this file adds intent events on
   every page. Anonymous and aggregate only, as privacy.html describes: no text people type, no
   identifiers. A recognized ChatGPT source is kept in this tab for up to 30 minutes; no
   visitor ID, full referrer or query string is stored. Every event carries page and language.

   Events (name · data beyond page and lang):
     gpt-referral     source, source_via             recognized ChatGPT landing (not unique people)
     download-dmg      version, chip                 desktop disk image link (chip: apple / intel, from the file)
     copy-oneline      block                         copy button on the one-line installer
     copy-other        block                         any other copy button
     copy-manual       block                         text selected and copied from a code block
     github-click      target                        sintbot / sintbot-docs / sintbot-desktop / cc-bot / owner
     outbound          host                          any other external link
     nav-click         to, where                     links to other site pages and in-page anchors
     toc-click         id                            guide table of contents
     lang-en, lang-zh                                language switch
     cta-install, cta-meet                           homepage hero buttons
     section-<id>                                    homepage section reached (names kept from before)
     guide-section     id                            guide section reached
     faq-open          q, question                   homepage FAQ opened by a click
     details-open      section, title                guide troubleshooting item opened by a click
     image-open        image                         guide screenshot enlarged
     demo-tab          tab                           homepage showcase tab
     demo-playback                                   showcase pause / play
     scroll-depth      depth                         25 / 50 / 75 / 100 percent, once each
     engaged           seconds                       30 / 120 / 300 seconds visible, once each
     not-found         path, ref                     404 page */
(() => {
  const query = new URLSearchParams(location.search);
  let disabled = query.get("notrack") === "1";
  try { disabled ||= localStorage.getItem("umami.disabled") === "1"; } catch (_) {}
  const sourceKey = "sintbot_source";
  if (disabled) { try { sessionStorage.removeItem(sourceKey); } catch (_) {} return; }

  // Only known source labels are retained, never arbitrary query/referrer data.
  const gptHost = host => host === "chatgpt.com" || host.endsWith(".chatgpt.com") || host === "chat.openai.com";
  const utm = (query.get("utm_source") || "").trim().toLowerCase();
  const gptUtm = ["chatgpt", "chatgpt.com", "chat.openai.com"].includes(utm);
  let refHost = "";
  try { refHost = new URL(document.referrer).hostname.toLowerCase(); } catch (_) {}
  const external = refHost && refHost !== location.hostname;
  const via = utm ? (gptUtm ? "utm" : "") : (gptHost(refHost) ? "referrer" : "");
  let attribution = null;
  try {
    if (via) {
      attribution = { source: "chatgpt", source_via: via, at: Date.now() };
      sessionStorage.setItem(sourceKey, JSON.stringify(attribution));
    } else if (utm || external) sessionStorage.removeItem(sourceKey);
    else {
      const saved = JSON.parse(sessionStorage.getItem(sourceKey) || "null");
      if (saved && saved.source === "chatgpt" && ["utm", "referrer"].includes(saved.source_via)
          && Number.isFinite(saved.at) && Date.now() >= saved.at && Date.now() - saved.at < 30 * 60 * 1000) attribution = saved;
      else sessionStorage.removeItem(sourceKey);
    }
  } catch (_) { if (via) attribution = { source: "chatgpt", source_via: via, at: Date.now() }; }
  function clearSource() { attribution = null; try { sessionStorage.removeItem(sourceKey); } catch (_) {} }
  if (attribution) setTimeout(clearSource, Math.max(0, 30 * 60 * 1000 - (Date.now() - attribution.at)));
  const sourceData = () => {
    if (attribution && Date.now() - attribution.at >= 30 * 60 * 1000) clearSource();
    return attribution ? { source: attribution.source, source_via: attribution.source_via } : {};
  };

  // Read at send time: the homepage switches language in place.
  const lang = () => ((document.documentElement.lang || "en").toLowerCase().startsWith("zh") ? "zh" : "en");
  const path = location.pathname;
  const page = document.getElementById("error-content") ? "404"
    : /^\/(zh\/)?$/.test(path) || /^\/(zh\/)?index\.html$/.test(path) ? "home"
    : /\/guide\/install\//.test(path) ? "guide-install"
    : /\/guide\/usage\//.test(path) ? "guide-usage"
    : /\/guide\/slack\//.test(path) ? "guide-slack"
    : /\/guide\/feishu\//.test(path) ? "guide-feishu"
    : /\/guide\/wecom\//.test(path) ? "guide-wecom"
    : /\/changelog\//.test(path) ? "changelog"
    : /\/terms(\.html)?$/.test(path) ? "terms"
    : /\/privacy(\.html)?$/.test(path) ? "privacy"
    : "other";

  // script.js loads in parallel (defer); hold early events until window.umami exists.
  const queue = [];
  let timer = 0, tries = 0;
  const ready = () => window.umami && typeof window.umami.track === "function";
  const send = (name, data) => { try { window.umami.track(name, Object.assign({ page, lang: lang() }, sourceData(), data)); } catch (e) {} };
  function track(name, data) {
    if (ready()) return send(name, data);
    queue.push([name, data]);
    if (timer) return;
    timer = setInterval(() => {
      if (ready()) { clearInterval(timer); timer = 0; queue.splice(0).forEach(([n, d]) => send(n, d)); }
      else if (++tries > 60) { clearInterval(timer); timer = 0; queue.length = 0; }
    }, 250);
  }
  if (via) track("gpt-referral");

  const short = (s, n = 80) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

  function githubTarget(url) {
    const parts = url.pathname.split("/").filter(Boolean);
    const repo = parts.slice(0, 2).join("/");
    if (repo === "sintlab/sintbot") return url.pathname.includes("/docs/") ? "sintbot-docs" : "sintbot";
    if (repo === "sintlab/sintbot-desktop") return "sintbot-desktop";
    if (repo === "WaterTian/cc-bot") return "cc-bot";
    return parts[0] || "github";
  }
  function where(a) {
    if (a.closest(".guide-toc")) return "toc";
    if (a.closest("header, .nav, .guide-nav")) return "header";
    if (a.closest("footer")) return "footer";
    return "body";
  }

  // One delegated listener for links and buttons, so content added later is covered too.
  document.addEventListener("click", (event) => {
    const el = event.target instanceof Element ? event.target : null;
    if (!el) return;

    const copyBtn = el.closest(".copy[data-copy], [data-copy-target]");
    if (copyBtn) {
      const id = copyBtn.getAttribute("data-copy-target");
      const text = id ? (document.getElementById(id)?.textContent || "") : copyBtn.getAttribute("data-copy") || "";
      track(text.includes("install.sh") ? "copy-oneline" : "copy-other", { block: id || "home-install" });
      return;
    }
    const tab = el.closest(".showcase__tab[data-showcase-tab]");
    if (tab) return track("demo-tab", { tab: tab.getAttribute("data-showcase-tab") });
    if (el.closest(".playback")) return track("demo-playback");
    const summary = el.closest("summary");
    if (summary) {
      const details = summary.parentElement;
      if (details && details.tagName === "DETAILS" && !details.open) { // this click opens it
        const label = summary.querySelector('[data-i18n^="faq."]');
        const key = label?.getAttribute("data-i18n") || "";
        if (details.classList.contains("faq__item")) track("faq-open", { q: key.split(".")[1] || "", question: short(label ? label.textContent : summary.textContent) });
        else track("details-open", { section: details.closest("section[id]")?.id || "", title: short(summary.textContent) });
      }
      return;
    }
    const image = el.closest("[data-guide-image]");
    if (image) return track("image-open", { image: (image.getAttribute("href") || "").split("/").pop() });

    const a = el.closest("a[href]");
    if (!a) return;
    // The chip switch under the download button only changes the button (download.js).
    if (a.hasAttribute("data-dl-switch") && !(event.metaKey || event.ctrlKey || event.shiftKey || event.button)) return;
    let url;
    try { url = new URL(a.getAttribute("href"), location.href); } catch (e) { return; }
    if (/\/sintbot-desktop\/releases\/.+\.dmg$/.test(url.pathname)) {
      const file = url.pathname.match(/_(\d+\.\d+\.\d+)_(aarch64|x64)\.dmg$/) || [];
      return track("download-dmg", { version: file[1] || "", chip: file[2] === "x64" ? "intel" : file[2] ? "apple" : "" });
    }
    if (url.host !== location.host) {
      return url.hostname.endsWith("github.com") ? track("github-click", { target: githubTarget(url) }) : track("outbound", { host: url.hostname });
    }
    if (a.matches(".lang-toggle__btn[data-lang], .guide-lang")) {
      return track("lang-" + (a.getAttribute("data-lang") || (/^\/zh\//.test(url.pathname) ? "zh" : "en")));
    }
    if (a.matches('.btn[href="#plugin"]')) return track("cta-install");
    if (a.matches('.btn[href="#what"]')) return track("cta-meet");
    if (a.closest(".guide-toc") && url.hash) return track("toc-click", { id: url.hash.slice(1) });
    const samePage = url.pathname === location.pathname;
    track("nav-click", { to: samePage && url.hash ? url.hash : url.pathname + url.hash, where: where(a) });
  }, true);

  // Text copied by hand out of a code block (the copy buttons' own fallback is not inside one).
  document.addEventListener("copy", () => {
    const node = document.getSelection()?.anchorNode;
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    const block = el && el.closest("pre, code");
    if (block) track("copy-manual", { block: block.id || block.closest("pre")?.id || block.closest("section[id]")?.id || "" });
  });

  // Sections reached: counted once a section's top part enters the upper 60% of the viewport,
  // so sections taller than the screen count too.
  if ("IntersectionObserver" in window) {
    const seen = new Set();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const id = entry.target.id;
        if (!entry.isIntersecting || !id || seen.has(id)) return;
        seen.add(id);
        if (page === "home") track("section-" + id);
        else track("guide-section", { id });
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -40% 0px", threshold: 0 });
    document.querySelectorAll("main .section[id], .guide-section[id]").forEach((s) => observer.observe(s));
  }

  // Scroll depth, once per mark.
  const depthMarks = [25, 50, 75, 100];
  const reached = new Set();
  let queued = false;
  function measure() {
    queued = false;
    const doc = document.documentElement;
    const max = doc.scrollHeight - innerHeight;
    const pct = max <= 0 ? 100 : Math.round((scrollY / max) * 100);
    depthMarks.forEach((m) => { if (pct >= m - 2 && !reached.has(m)) { reached.add(m); track("scroll-depth", { depth: m }); } });
  }
  addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(measure); } }, { passive: true });

  // Time with the page visible, once per mark.
  const timeMarks = [30, 120, 300];
  let visibleMs = 0, since = document.visibilityState === "visible" ? Date.now() : 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") since = Date.now();
    else if (since) { visibleMs += Date.now() - since; since = 0; }
  });
  const clock = setInterval(() => {
    const seconds = (visibleMs + (since ? Date.now() - since : 0)) / 1000;
    while (timeMarks.length && seconds >= timeMarks[0]) track("engaged", { seconds: timeMarks.shift() });
    if (!timeMarks.length) clearInterval(clock);
  }, 5000);

  if (page === "404") {
    let ref = "direct";
    try { if (document.referrer) ref = new URL(document.referrer).hostname || "direct"; } catch (e) {}
    track("not-found", { path: path.slice(0, 120), ref });
  }
})();
