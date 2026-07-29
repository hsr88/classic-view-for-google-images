// Classic Rows — popup logic.
// Settings live in chrome.storage.sync; content.js reacts without reload.
(() => {
  "use strict";

  const DEFAULTS = { enabled: true, rowH: 180, gap: 6, zoom: true, viewBtn: true, filters: true, hideRelated: true };

  const body = document.body;
  const status = document.getElementById("status");
  const master = document.getElementById("master");
  const rowH = document.getElementById("rowH");
  const gap = document.getElementById("gap");
  const zoom = document.getElementById("zoom");
  const viewBtn = document.getElementById("viewBtn");
  const filters = document.getElementById("filters");
  const hideRelated = document.getElementById("hideRelated");
  const rowHVal = document.getElementById("rowHVal");
  const gapVal = document.getElementById("gapVal");

  // The popup also renders as a plain page (file://) for design previews —
  // without the storage API it just shows defaults and stays interactive.
  const store =
    typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync
      ? chrome.storage.sync
      : null;

  function statusText(data) {
    return data.enabled ? "Classic layout is on" : "Classic layout is off";
  }

  function render(data) {
    master.checked = data.enabled;
    zoom.checked = data.zoom;
    viewBtn.checked = data.viewBtn;
    filters.checked = data.filters;
    if (hideRelated) hideRelated.checked = data.hideRelated;
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

  rowH.addEventListener("input", () => {
    rowHVal.textContent = `${rowH.value} px`;
    saveDebounced({ rowH: Number(rowH.value) });
  });
  gap.addEventListener("input", () => {
    gapVal.textContent = `${gap.value} px`;
    saveDebounced({ gap: Number(gap.value) });
  });

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
