/* Classic Rows for Google Images — content script.
 *
 * Strategy (robust against Google's obfuscated class names):
 * 1. The results grid is detected structurally — a wide container whose
 *    >= 10 children each contain a thumbnail.
 * 2. The container gets .ogi-grid and styles.css turns it into justified
 *    flex rows of fixed height, like the classic layout.
 * 3. Each tile gets a --ar custom property (aspect ratio read from the
 *    thumbnail's natural size).
 * 4. Original image URLs are recovered from the page's embedded data:
 *    inline scripts hold records of  "<docid>",["<thumb url>",w,h],
 *    ["<original url>",w,h]  — parsed into a docid -> original map.
 * 5. Extras: hover-zoom preview, a "View image" hover button per tile,
 *    and a size-filter chip bar above the grid.
 *
 * DOM nodes are never moved or cloned — only classes and styles are
 * added — so other extensions (e.g. uBlacklist) keep working unchanged.
 */
(() => {
  "use strict";

  const html = document.documentElement;
  const MIN_TILES = 10; // min children for a container to count as the grid
  const MIN_WIDTH = 600; // the results grid is wide; skips carousels
  const ZOOM_DELAY = 120; // ms of hover before the preview appears

  const prefs = { enabled: true, rowH: 180, gap: 6, zoom: true, viewBtn: true, filters: true, hideRelated: true, aiBadge: true, hideAi: false };

  let grid = null; // { el, cols } — detected grid container
  let lastHref = location.href;
  let originals = null; // Map<docid, {url, thumb}> — lazily (re)built

  function isImageSearch() {
    const p = new URLSearchParams(location.search);
    // Google now redirects tbm=isch to udm=2 — accept both.
    return p.get("tbm") === "isch" || p.get("udm") === "2";
  }

  // Layout prefs go to CSS variables on <html>; tile heights and gaps
  // recompute themselves with no DOM scanning.
  function applyPrefs() {
    html.style.setProperty("--ogi-h", `${prefs.rowH}px`);
    html.style.setProperty("--ogi-gap", `${prefs.gap}px`);
    html.classList.toggle("ogi-hide-related", !!prefs.hideRelated);
  }

  // --- original image URLs --------------------------------------------------

  function unescape(s) {
    return s
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\\//g, "/");
  }

  // Embedded-data records look like this (plain quotes in the script
  // source; only the URLs carry \uXXXX escapes):
  //   "docid",["https://...thumb...",557,359],["https://...original...",4138,2676]
  const RECORD_RE = /"([-\w]{8,})",\["((?:[^"\\]|\\.)+?)",\d+,\d+\],\["((?:[^"\\]|\\.)+?)",\d+,\d+\]/g;

  function getOriginals() {
    if (originals) return originals;
    originals = new Map();
    for (const s of document.scripts) {
      const t = s.textContent;
      if (!t || t.length < 100) continue;
      let m;
      while ((m = RECORD_RE.exec(t))) {
        originals.set(m[1], { thumb: unescape(m[2]), url: unescape(m[3]) });
      }
    }
    return originals;
  }

  function originalFor(item) {
    const holder = item.querySelector("[data-docid]");
    const id = holder && holder.getAttribute("data-docid");
    return id ? getOriginals().get(id) : null;
  }

  // --- grid detection ---------------------------------------------------------

  function countImgs(el) {
    return el.querySelectorAll("img").length;
  }

  function findGrid() {
    let best = null;
    for (const el of document.querySelectorAll("div, ul, section")) {
      if (el.clientWidth < MIN_WIDTH) continue;
      const kids = [...el.children];
      if (kids.length < MIN_TILES) continue;
      const withImg = kids.filter((c) => c.querySelector("img"));
      if (withImg.length / kids.length < 0.8) continue;
      if (best && withImg.length <= best.count) continue;
      // A child with >= 4 images is a column wrapper, not a single tile
      // (a tile holds a thumbnail plus maybe a favicon / avatar).
      const wrappers = withImg.filter((c) => countImgs(c) >= 4).length;
      best = { el, count: withImg.length, cols: wrappers / withImg.length > 0.5 };
    }
    return best;
  }

  function isRelatedSearchItem(el) {
    if (!el) return false;
    // Common text indicators in Polish/English Google Images
    const text = (el.textContent || "").toLowerCase();
    if (text.includes("podobne wyszukiwania") || text.includes("related searches") || text.includes("wyszukiwania w necie")) {
      return true;
    }
    // Attribute / data-type checks
    if (el.matches('[data-rel]')) return true;
    return false;
  }

  function getItems() {
    if (!grid) return [];
    const scope = grid.cols
      ? grid.el.querySelectorAll(":scope > * > *") // grandchildren (tiles inside columns)
      : grid.el.children;
    return [...scope].filter((el) => {
      if (!el.querySelector("img")) return false;
      if (prefs.hideRelated && isRelatedSearchItem(el)) {
        el.classList.add("ogi-related-hidden");
        return false;
      } else {
        el.classList.remove("ogi-related-hidden");
      }
      return true;
    });
  }

  // --- thumbnails -------------------------------------------------------------

  function pickThumb(item) {
    let best = null;
    let bestArea = 0;
    for (const img of item.querySelectorAll("img")) {
      const w = img.naturalWidth || img.clientWidth || parseFloat(img.getAttribute("width")) || 0;
      const h = img.naturalHeight || img.clientHeight || parseFloat(img.getAttribute("height")) || 0;
      if (w * h > bestArea) {
        bestArea = w * h;
        best = img;
      }
    }
    return best;
  }

  function aspectRatio(item) {
    const img = pickThumb(item);
    if (!img) return 0;
    if (img.naturalWidth && img.naturalHeight) return img.naturalWidth / img.naturalHeight;
    const w = parseFloat(img.getAttribute("width"));
    const h = parseFloat(img.getAttribute("height"));
    return w && h ? w / h : 0;
  }

  // --- AI badge -------------------------------------------------------------

  // Match labels Google surfaces on tiles / About this image chrome.
  // Keep this strict: no heuristic guessing from visual style alone.
  const AI_MARK_RE =
    /\bai[-\s]?generated\b|\bgenerated\s+(?:by|with|using)\s+ai\b|\bmade\s+with\s+ai\b|\bimage\s+self[-\s]?labeled\s+as\s+ai\b|\bsynthetic(?:ally generated)?\b|\bwygenerowan[aey]\s+(?:przez\s+)?ai\b|\bobraz\s+wygenerowany\b|\bwygenerowano\s+za\s+pomocą\s+ai\b|\bgeneriert\s+mit\s+ki\b|\bgenerada?\s+por\s+ia\b|\bgénérée?\s+par\s+l['’]?ia\b/i;

  const AI_OVERVIEW_RE =
    /\bai overview\b|\boverview generated by ai\b|\bprzegląd od ai\b|\bprzegląd wygenerowany przez ai\b|\bübersicht mit ki\b|\bresumen (?:creado|generado) con ia\b|\bvue d['’]ensemble générée par l['’]ia\b/i;

  // Deterministic signals only. These do not inspect image pixels or call an
  // AI service. They intentionally favor precision over matching a bare "AI".
  const AI_LIKELY_RE =
    /\bai[-\s]?(?:generated|created|portrait|image|images|art|artwork|photo|photography|headshot|avatar|generator)\b|\b(?:generated|created|made)\s+(?:by|with|using)\s+(?:generative\s+)?ai\b|\b(?:midjourney|stable\s*diffusion|dall[·.\s-]?e|adobe\s+firefly|leonardo\s*ai|nightcafe|openart|ideogram|dreamstudio|playground\s*ai|starryai|bluewillow|flux(?:\s*(?:1|pro|dev|schnell))?)\b/i;

  const AI_SOURCE_RE =
    /(?:^|\.)(?:midjourney\.com|leonardo\.ai|openart\.ai|nightcafe\.studio|ideogram\.ai|dreamstudio\.ai|playground\.com|starryai\.com|bluewillow\.ai|firefly\.adobe\.com|civitai\.com|tensor\.art|seaart\.ai|getimg\.ai|deepai\.org|craiyon\.com|generated\.photos)$/i;

  const AI_QUERY_RE =
    /\bai[-\s]?(?:generated|created|portrait|image|images|art|artwork|photo|photography|headshot|avatar|generator)\b|\b(?:midjourney|stable\s*diffusion|dall[·.\s-]?e|firefly|leonardo\s*ai|nightcafe|openart|ideogram|flux)\b/i;

  function isAiMarkText(text) {
    if (!text) return false;
    const t = String(text).replace(/\s+/g, " ").trim();
    if (!t || t.length > 96) return false;
    // Google currently uses short labels such as "AI" and "Generated".
    if (/^(?:ai|generated|ai generated|generated image)$/i.test(t)) return true;
    return AI_MARK_RE.test(t) || AI_OVERVIEW_RE.test(t);
  }

  function ownMetadataTexts(el) {
    if (!el) return [];
    return [
      el.getAttribute && el.getAttribute("aria-label"),
      el.getAttribute && el.getAttribute("title"),
      el.getAttribute && el.getAttribute("alt"),
      el.getAttribute && el.getAttribute("data-label"),
      el.getAttribute && el.getAttribute("data-source"),
      el.getAttribute && el.getAttribute("data-software"),
      el.getAttribute && el.getAttribute("data-digital-source-type"),
      el.getAttribute && el.getAttribute("data-creator-tool"),
    ];
  }

  function currentSearchLooksAiSpecific() {
    const query = new URLSearchParams(location.search).get("q") || "";
    return AI_QUERY_RE.test(query.replace(/[+_]+/g, " "));
  }

  function aiSourceFromUrl(value) {
    if (!value) return false;
    try {
      const url = new URL(value, location.href);
      if (AI_SOURCE_RE.test(url.hostname.toLowerCase())) return true;
      const filename = decodeURIComponent(url.pathname.split("/").pop() || "").replace(/[-_]+/g, " ");
      return AI_LIKELY_RE.test(filename);
    } catch (_) {
      return AI_LIKELY_RE.test(String(value).replace(/[-_]+/g, " "));
    }
  }

  function hasLikelyAiSignals(item) {
    // A highly specific search such as "AI generated portrait" is enough to
    // mark the result set. The badge is still a heuristic, not pixel analysis.
    if (currentSearchLooksAiSpecific()) return true;

    const visibleText = (item.innerText || "").replace(/\s+/g, " ").trim();
    if (visibleText && AI_LIKELY_RE.test(visibleText.slice(0, 1200))) return true;

    for (const value of ownMetadataTexts(item)) {
      if (value && (AI_LIKELY_RE.test(String(value)) || AI_MARK_RE.test(String(value)))) return true;
    }
    if (aiSourceFromUrl(item.getAttribute("href")) || aiSourceFromUrl(item.getAttribute("src"))) return true;

    const metadataNodes = item.querySelectorAll(
      "[aria-label], [title], [data-label], [data-source], [data-software], [data-digital-source-type], [data-creator-tool], img[alt], img[src], a[href]"
    );
    for (const el of metadataNodes) {
      if (el.closest(".ogi-viewbtn, .ogi-ai-badge")) continue;
      for (const value of ownMetadataTexts(el)) {
        if (value && (AI_LIKELY_RE.test(String(value)) || AI_MARK_RE.test(String(value)))) return true;
      }
      if (aiSourceFromUrl(el.getAttribute("href")) || aiSourceFromUrl(el.getAttribute("src"))) return true;
    }
    return false;
  }

  function isInsideAiOverview(item) {
    // Stay close to the tile. Walking up to the page root could mark the whole
    // result page merely because a separate AI Overview exists elsewhere.
    let node = item;
    for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
      for (const text of ownMetadataTexts(node)) {
        if (text && AI_OVERVIEW_RE.test(String(text))) return true;
      }

      for (const heading of node.querySelectorAll(":scope > h1, :scope > h2, :scope > h3, :scope > [role='heading']")) {
        const text = (heading.textContent || "").replace(/\s+/g, " ").trim();
        if (text.length <= 96 && AI_OVERVIEW_RE.test(text)) return true;
      }

      if (grid && node === grid.el) break;
    }
    return hasLikelyAiSignals(item);
  }

  function isGoogleMarkedAi(item) {
    if (!item) return false;

    if (isInsideAiOverview(item)) return true;

    for (const bit of ownMetadataTexts(item)) {
      if (isAiMarkText(bit)) return true;
    }

    const attrNodes = item.querySelectorAll("[aria-label], [title], [data-label], [data-source], img[alt]");
    for (const el of attrNodes) {
      if (el.closest(".ogi-viewbtn, .ogi-ai-badge")) continue;
      const bits = ownMetadataTexts(el);
      for (const bit of bits) {
        if (isAiMarkText(bit)) return true;
      }
    }

    // Google's visible badge: short overlay node whose text is "AI" / "AI-generated".
    for (const el of item.querySelectorAll("span, div, button, p, label, a")) {
      if (el.closest(".ogi-viewbtn, .ogi-ai-badge")) continue;
      // Prefer leaf-ish nodes so we don't match a whole tile's concatenated text.
      if (el.children.length > 2) continue;
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 48) continue;
      if (isAiMarkText(text)) return true;
    }

    return false;
  }

  function updateAiBadge(item) {
    let badge = item.querySelector(":scope > .ogi-ai-badge");
    const marked = isGoogleMarkedAi(item);
    item.classList.toggle("ogi-ai-marked", marked);

    if (prefs.hideAi && marked) {
      item.classList.add("ogi-ai-hidden");
      if (badge) badge.remove();
      return;
    }
    item.classList.remove("ogi-ai-hidden");

    const show = prefs.aiBadge && marked;
    if (!show) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "ogi-ai-badge";
      badge.innerHTML =
        '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">' +
        '<path d="M8 1.5 9.1 5 12.5 6.1 9.1 7.2 8 10.5 6.9 7.2 3.5 6.1 6.9 5 8 1.5Z" fill="currentColor"/>' +
        '<path d="m12.4 9.2.55 1.45 1.45.55-1.45.55-.55 1.45-.55-1.45-1.45-.55 1.45-.55.55-1.45Z" fill="currentColor"/>' +
        "</svg><span>AI</span>";
      badge.title = "AI-generated or likely AI-generated";
      badge.setAttribute("aria-label", "AI-generated or likely AI-generated image");
      // Inline locks size — Google's tile CSS otherwise stretches absolute children.
      badge.style.cssText =
        "position:absolute;top:6px;left:6px;right:auto;bottom:auto;z-index:2147483000;" +
        "display:inline-flex;align-items:center;justify-content:center;" +
        "width:max-content;height:max-content;margin:0;padding:3px 7px;" +
        "border:0;border-radius:4px;background:rgba(7,20,38,.88);color:#fff;" +
        "font:700 10px/1 Google Sans,Roboto,system-ui,sans-serif;letter-spacing:.04em;" +
        "white-space:nowrap;pointer-events:none;user-select:none;" +
        "box-shadow:0 1px 4px rgba(0,0,0,.35);";
      // Keep the badge intact even if a previously opened Google Images tab
      // still has an older extension stylesheet cached. Google also uses many
      // high-specificity rules on direct tile children.
      const lockedBadgeStyles = {
        position: "absolute",
        top: "6px",
        left: "6px",
        right: "auto",
        bottom: "auto",
        zIndex: "2147483000",
        display: "inline-flex",
        width: "max-content",
        height: "max-content",
        minWidth: "0",
        minHeight: "0",
      };
      for (const [property, value] of Object.entries(lockedBadgeStyles)) {
        badge.style.setProperty(property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`), value, "important");
      }
      item.appendChild(badge);
    }
  }

  // --- "View image" button -----------------------------------------------------

  function updateViewButton(item, img) {
    let btn = item.querySelector(":scope > .ogi-viewbtn");
    const href = (originalFor(item) || {}).url || (img && img.src);
    if (!prefs.viewBtn || !href) {
      if (btn) btn.remove();
      return;
    }
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ogi-viewbtn";
      btn.textContent = "View image";
      btn.setAttribute("aria-label", "Open full-size image in a new tab");
      // Keep Google's side panel from opening when the button is used.
      btn.addEventListener("mousedown", (e) => e.stopPropagation());
      btn.addEventListener("mouseup", (e) => e.stopPropagation());
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        window.open(btn.dataset.href, "_blank", "noopener");
      });
      item.appendChild(btn);
    }
    btn.dataset.href = href;
  }

  // --- hover zoom ---------------------------------------------------------------

  let zoomEl = null;
  let zoomTimer = 0;
  let zoomRect = null;

  function ensureZoomEl() {
    if (zoomEl) return zoomEl;
    zoomEl = document.createElement("div");
    zoomEl.id = "ogi-zoom";
    const img = document.createElement("img");
    img.alt = "";
    zoomEl.appendChild(img);
    document.body.appendChild(zoomEl);
    return zoomEl;
  }

  function positionZoom() {
    if (!zoomEl || !zoomRect) return;
    const M = 12; // viewport margin
    const zw = zoomEl.offsetWidth;
    const zh = zoomEl.offsetHeight;
    let left = zoomRect.left + zoomRect.width / 2 - zw / 2;
    left = Math.max(M, Math.min(left, innerWidth - zw - M));
    let top = zoomRect.top - zh - 8;
    if (top < M) top = zoomRect.bottom + 8;
    if (top + zh > innerHeight - M) top = Math.max(M, innerHeight - zh - M);
    zoomEl.style.left = `${left}px`;
    zoomEl.style.top = `${top}px`;
  }

  function showZoom(item, thumb) {
    const el = ensureZoomEl();
    const im = el.firstElementChild;
    zoomRect = item.getBoundingClientRect();
    im.src = thumb.currentSrc || thumb.src; // instant: the thumbnail itself
    // Upgrade to the original file once it has loaded in the background.
    const orig = originalFor(item);
    if (orig && orig.url !== im.src) {
      const big = new Image();
      big.onload = () => {
        if (el.classList.contains("ogi-visible")) {
          im.src = orig.url;
          positionZoom();
        }
      };
      big.src = orig.url;
    }
    el.classList.add("ogi-visible");
    im.onload = positionZoom;
    positionZoom();
  }

  function hideZoom() {
    clearTimeout(zoomTimer);
    if (zoomEl) zoomEl.classList.remove("ogi-visible");
    zoomRect = null;
  }

  function initZoom() {
    document.addEventListener("mouseover", (e) => {
      if (!prefs.zoom || !html.classList.contains("ogi-on")) return;
      if (!(e.target instanceof Element)) return;
      const item = e.target.closest(".ogi-item");
      if (!item) return;
      const img = pickThumb(item);
      if (!img) return;
      clearTimeout(zoomTimer);
      zoomTimer = setTimeout(() => showZoom(item, img), ZOOM_DELAY);
    });
    document.addEventListener("mouseout", (e) => {
      if (!(e.target instanceof Element)) return;
      if (!e.target.closest(".ogi-item")) return;
      if (e.relatedTarget instanceof Element && e.relatedTarget.closest(".ogi-item")) return;
      hideZoom();
    });
    document.addEventListener("scroll", hideZoom, true);
    document.addEventListener("mousedown", hideZoom, true);
  }

  // --- size filter chips ---------------------------------------------------------

  const SIZES = [
    { label: "All sizes", value: "" },
    { label: "Large", value: "l" },
    { label: "Medium", value: "m" },
    { label: "Icon", value: "i" },
  ];

  function currentIsz() {
    const tbs = new URLSearchParams(location.search).get("tbs") || "";
    const m = tbs.match(/(?:^|,)isz:(\w)/);
    return m ? m[1] : "";
  }

  function urlForSize(value) {
    const url = new URL(location.href);
    const p = url.searchParams;
    const kept = (p.get("tbs") || "")
      .split(",")
      .filter((part) => part && !part.startsWith("isz:"));
    if (value) kept.push(`isz:${value}`);
    if (kept.length) p.set("tbs", kept.join(","));
    else p.delete("tbs");
    return url.toString();
  }

  function ensureFiltersBar() {
    let bar = document.getElementById("ogi-filters");
    if (!prefs.filters || !grid) {
      if (bar) bar.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "ogi-filters";
      bar.setAttribute("role", "group");
      bar.setAttribute("aria-label", "Image size filter");
      for (const size of SIZES) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = size.label;
        b.addEventListener("click", () => location.assign(urlForSize(size.value)));
        bar.appendChild(b);
      }
    }
    const active = currentIsz();
    [...bar.children].forEach((b, i) => {
      b.classList.toggle("ogi-active", SIZES[i].value === active);
    });
    if (bar.nextElementSibling !== grid.el || bar.parentElement !== grid.el.parentElement) {
      grid.el.parentElement.insertBefore(bar, grid.el);
    }
  }

  // --- processing ------------------------------------------------------------

  function clearGrid() {
    if (!grid) return;
    grid.el.classList.remove("ogi-grid", "ogi-flatten");
    for (const el of grid.el.querySelectorAll(".ogi-item")) {
      el.classList.remove("ogi-item");
      el.style.removeProperty("--ar");
    }
    for (const img of grid.el.querySelectorAll(".ogi-thumb")) {
      img.classList.remove("ogi-thumb");
    }
    for (const btn of grid.el.querySelectorAll(".ogi-viewbtn")) {
      btn.remove();
    }
    for (const badge of grid.el.querySelectorAll(".ogi-ai-badge")) {
      badge.remove();
    }
    for (const el of grid.el.querySelectorAll(".ogi-ai-marked, .ogi-ai-hidden")) {
      el.classList.remove("ogi-ai-marked", "ogi-ai-hidden");
    }
    grid = null;
  }

  function scan() {
    const on = isImageSearch() && prefs.enabled;
    html.classList.toggle("ogi-on", on);
    if (!on) {
      hideZoom();
      clearGrid();
      return;
    }

    if (grid && !document.contains(grid.el)) grid = null;
    // Re-detect on every scan: the candidate with the most tiles wins, so a
    // temporary match (e.g. the related-searches carousel) corrects itself
    // once the real results container renders.
    const best = findGrid();
    if (best && best.el !== (grid && grid.el)) {
      clearGrid();
      grid = best;
      grid.el.classList.add("ogi-grid");
      grid.el.classList.toggle("ogi-flatten", grid.cols);
    }
    if (!grid) return;

    for (const item of getItems()) {
      item.classList.add("ogi-item");
      const ar = aspectRatio(item);
      if (ar > 0) item.style.setProperty("--ar", ar.toFixed(4));
      const img = pickThumb(item);
      if (img) img.classList.add("ogi-thumb");
      updateViewButton(item, img);
      updateAiBadge(item);
    }
    ensureFiltersBar();
  }

  // --- scheduling (rAF debounce) ---------------------------------------------

  let scheduled = false;
  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scan();
    });
  }

  // --- startup ------------------------------------------------------------

  function start() {
    // New nodes (infinite scroll, SPA navigation without reload).
    new MutationObserver(scheduleScan).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Late-loaded thumbnails — only then do we know their aspect ratio.
    document.addEventListener(
      "load",
      (e) => {
        if (e.target instanceof HTMLImageElement) scheduleScan();
      },
      true
    );

    // Google overwrites className on <html> (width-breakpoint classes),
    // which strips our toggle class. Watch the class attribute and repair.
    // No loop: after the repair the callback's condition no longer holds.
    new MutationObserver(() => {
      const shouldBeOn = isImageSearch() && prefs.enabled;
      if (html.classList.contains("ogi-on") !== shouldBeOn) scheduleScan();
    }).observe(html, { attributes: true, attributeFilter: ["class"] });

    // SPA navigation: Google changes the URL without reloading.
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        originals = null; // fresh results carry fresh embedded data
        scheduleScan();
      }
    }, 800);

    initZoom();

    // Popup settings + live reaction to their changes (no reload needed).
    chrome.storage.sync.get(prefs, (data) => {
      Object.assign(prefs, data);
      applyPrefs();
      scheduleScan();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      let layoutChanged = false;
      for (const key of Object.keys(changes)) {
        if (!(key in prefs)) continue;
        prefs[key] = changes[key].newValue;
        if (key === "rowH" || key === "gap") layoutChanged = true;
      }
      applyPrefs();
      if (!layoutChanged) scheduleScan(); // rowH/gap reflow via CSS vars alone
    });

    scan();
  }

  if (document.documentElement) {
    start();
  } else {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  }
})();
