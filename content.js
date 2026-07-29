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

  const prefs = { enabled: true, rowH: 180, gap: 6, zoom: true, viewBtn: true, filters: true, hideRelated: true };

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
