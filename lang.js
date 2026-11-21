/* First visit with no language chosen: a Chinese system language opens the Chinese page,
   every other language stays on English. A language picked on the site (sintbot_site_lang),
   ?lang= and any /zh/ link are left alone. Loaded without defer at the top of each English
   page so the move happens before the page draws or counts a view. */
(function () {
  try {
    if (/^\/zh(\/|$)/.test(location.pathname) || /[?&]lang=/.test(location.search) || localStorage.getItem("sintbot_site_lang")) return;
    var lang = String((navigator.languages && navigator.languages[0]) || navigator.language || "").toLowerCase();
    if (lang.indexOf("zh") === 0) location.replace("/zh" + location.pathname + location.search + location.hash);
  } catch (e) { /* stay on English */ }
})();
