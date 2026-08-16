// Classic Rows — popup logic.
// Settings live in chrome.storage.sync; content.js reacts without reload.
(() => {
  "use strict";

  const DEFAULTS = { enabled: true, rowH: 180, gap: 6, zoom: true, viewBtn: true, filters: true, hideRelated: true, aiBadge: true, hideAi: false };

  const body = document.body;
  const status = document.getElementById("status");
  const master = document.getElementById("master");
  const rowH = document.getElementById("rowH");
  const gap = document.getElementById("gap");
  const zoom = document.getElementById("zoom");
  const viewBtn = document.getElementById("viewBtn");
  const filters = document.getElementById("filters");
  const hideRelated = document.getElementById("hideRelated");
  const aiBadge = document.getElementById("aiBadge");
  const hideAi = document.getElementById("hideAi");
  const rowHVal = document.getElementById("rowHVal");
  const gapVal = document.getElementById("gapVal");
  const reportIssue = document.getElementById("reportIssue");
  const version = document.getElementById("version");
  const manifestVersion =
    typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest
      ? chrome.runtime.getManifest().version
      : "0.5.3";

  // The popup also renders as a plain page (file://) for design previews —
  // without the storage API it just shows defaults and stays interactive.
  const store =
    typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync
      ? chrome.storage.sync
      : null;

  if (version) version.textContent = `v${manifestVersion}`;

  function statusText(data) {
    return data.enabled ? "Classic layout is on" : "Classic layout is off";
  }

  function render(data) {
    master.checked = data.enabled;
    zoom.checked = data.zoom;
    viewBtn.checked = data.viewBtn;
    filters.checked = data.filters;
    if (hideRelated) hideRelated.checked = data.hideRelated;
    if (aiBadge) aiBadge.checked = data.aiBadge !== false;
    if (hideAi) hideAi.checked = !!data.hideAi;
    rowH.value = data.rowH;
    gap.value = data.gap;
    rowHVal.textContent = `${data.rowH} px`;
    gapVal.textContent = `${data.gap} px`;
    body.classList.toggle("is-off", !data.enabled);
    status.classList.remove("is-ok", "is-error");
    status.textContent = statusText(data);
  }

  let ackTimer = null;
  function ackSaved() {
    status.classList.remove("is-error");
    status.classList.add("is-ok");
    status.textContent = "Saved";
    clearTimeout(ackTimer);
    ackTimer = setTimeout(() => {
      status.classList.remove("is-ok");
      status.textContent = statusText({ enabled: master.checked });
    }, 1400);
  }

  function ackError() {
    status.classList.remove("is-ok");
    status.classList.add("is-error");
    status.textContent = "Couldn’t save — try again";
  }

  function save(patch) {
    if (!store) return;
    store.set(patch, () => {
      if (chrome.runtime.lastError) ackError();
      else ackSaved();
    });
  }

  // Debounce slider drags — storage.sync has a write quota.
  let saveTimer = null;
  function saveDebounced(patch) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(patch), 150);
  }

  master.addEventListener("change", () => {
    body.classList.toggle("is-off", !master.checked);
    save({ enabled: master.checked });
  });
  zoom.addEventListener("change", () => save({ zoom: zoom.checked }));
  viewBtn.addEventListener("change", () => save({ viewBtn: viewBtn.checked }));
  filters.addEventListener("change", () => save({ filters: filters.checked }));
  if (hideRelated) hideRelated.addEventListener("change", () => save({ hideRelated: hideRelated.checked }));
  if (aiBadge) aiBadge.addEventListener("change", () => save({ aiBadge: aiBadge.checked }));
  if (hideAi) hideAi.addEventListener("change", () => save({ hideAi: hideAi.checked }));

  rowH.addEventListener("input", () => {
    rowHVal.textContent = `${rowH.value} px`;
    saveDebounced({ rowH: Number(rowH.value) });
  });
  gap.addEventListener("input", () => {
    gapVal.textContent = `${gap.value} px`;
    saveDebounced({ gap: Number(gap.value) });
  });

  function chromeVersion() {
    const match = navigator.userAgent.match(/(?:Chrome|CriOS)\/([\d.]+)/);
    return match ? match[1] : "Unknown";
  }

  function activeGoogleDomain(callback) {
    if (typeof chrome === "undefined" || !chrome.tabs || !chrome.tabs.query) {
      callback("Unknown");
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError || !tabs[0] || !tabs[0].url) {
        callback("Unknown");
        return;
      }

      try {
        const hostname = new URL(tabs[0].url).hostname;
        callback(hostname.startsWith("www.google.") ? hostname : "Not on Google Images");
      } catch {
        callback("Unknown");
      }
    });
  }

  function openReportIssue() {
    activeGoogleDomain((domain) => {
      const title = `Broken Google Images layout on ${domain}`;
      const body = [
        "## What happened?",
        "",
        "<!-- Describe what looks wrong and what you expected to see. -->",
        "",
        "## Diagnostics",
        "",
        `- Extension version: ${manifestVersion}`,
        `- Chrome version: ${chromeVersion()}`,
        `- Google domain: ${domain}`,
        "",
        "## Screenshot",
        "",
        "<!-- Drag a screenshot here. Please hide private searches or account information. -->",
      ].join("\n");
      const url = new URL("https://github.com/hsr88/classic-view-for-google-images/issues/new");
      url.searchParams.set("title", title);
      url.searchParams.set("body", body);

      if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: url.toString() });
      }
      else window.open(url.toString(), "_blank", "noopener");
    });
  }

  if (reportIssue) reportIssue.addEventListener("click", openReportIssue);

  function init() {
    if (!store) {
      render(DEFAULTS);
      body.classList.remove("is-loading");
      return;
    }
    store.get(DEFAULTS, (data) => {
      render(data);
      body.classList.remove("is-loading");
    });
  }

  init();
})();
