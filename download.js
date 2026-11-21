/* Desktop download button: offer the disk image for this Mac's chip.
   Chrome and Edge report the architecture; other browsers are read from the
   WebGL renderer name. Nothing is stored or sent: the choice only changes the
   link, and the click is counted like any download (track.js). When the chip
   cannot be told (Safari, or not a Mac) the Apple silicon image is offered and
   the other one is one click away. */
(() => {
  const TEXT = {
    en: { arm: "Apple silicon", intel: "Intel", toIntel: "Intel Mac? Get the Intel version", toArm: "Apple silicon Mac? Get that version", other: "For Macs with macOS 12 or later." },
    zh: { arm: "Apple 芯片", intel: "Intel 芯片", toIntel: "Intel 芯片的 Mac？下载 Intel 版", toArm: "Apple 芯片的 Mac？下载 Apple 芯片版", other: "适用于 macOS 12 及以上的 Mac。" },
  };
  const boxes = [...document.querySelectorAll("[data-dl]")];
  if (!boxes.length) return;
  const ua = navigator.userAgent;
  const isMac = /Macintosh|Mac OS X/.test(ua) && !/iPhone|iPad|iPod/.test(ua) && !(navigator.maxTouchPoints > 1);
  let arch = "arm";

  const lang = () => (document.documentElement.lang || "en").startsWith("zh") ? "zh" : "en";
  function render() {
    const t = TEXT[lang()];
    boxes.forEach((box) => {
      const link = box.querySelector("[data-dl-link]");
      const arm = link.dataset.dlArm || (link.dataset.dlArm = link.href);
      const intel = arm.replace(/_aarch64\.dmg$/, "_x64.dmg");
      link.href = arch === "intel" ? intel : arm;
      box.querySelector("[data-dl-chip]").textContent = t[arch];
      const other = box.querySelector("[data-dl-switch]");
      other.textContent = arch === "intel" ? t.toArm : t.toIntel;
      other.href = arch === "intel" ? arm : intel; // still a real link without this script
      const note = box.querySelector("[data-dl-note]");
      note.textContent = isMac ? "" : t.other;
      note.hidden = isMac;
    });
  }

  function fromRenderer() {
    try {
      const gl = document.createElement("canvas").getContext("webgl");
      const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
      const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
      const lose = gl && gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
      if (/Apple M\d/i.test(name)) return "arm";
      if (/Intel|AMD|Radeon|NVIDIA/i.test(name)) return "intel";
    } catch (_) { /* unknown */ }
    return null;
  }

  async function detect() {
    if (!isMac) return null;
    try {
      const d = navigator.userAgentData;
      if (d && d.getHighEntropyValues) {
        const { architecture } = await d.getHighEntropyValues(["architecture"]);
        if (architecture === "x86") return "intel";
        if (architecture === "arm") return "arm";
      }
    } catch (_) { /* fall through */ }
    return fromRenderer();
  }

  // The switch changes the button, it does not download (nor count as a download).
  boxes.forEach((box) => box.querySelector("[data-dl-switch]").addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
    event.preventDefault();
    event.stopPropagation();
    arch = arch === "intel" ? "arm" : "intel";
    render();
  }));
  document.addEventListener("sintbot:languagechange", render);
  render();
  detect().then((found) => { if (found && found !== arch) { arch = found; render(); } });
})();
