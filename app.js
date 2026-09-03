// app.js — ties db.js, lookup.js, and scanner.js together into the UI.

const state = {
  items: [],
  searchText: "",
  sort: "name", // 'name' | 'expiration' | 'added'
  scannedBarcode: null,
};

// ---------- Rendering ----------

function expirationStatus(item) {
  if (!item.expirationDate) return "none";
  const days = Math.floor((new Date(item.expirationDate) - new Date()) / 86400000);
  if (days < 0) return "expired";
  if (days <= 3) return "soon";
  return "fresh";
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getFilteredSortedItems() {
  const q = state.searchText.trim().toLowerCase();
  let items = state.items.filter((item) => {
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      (item.category || "").toLowerCase().includes(q) ||
      (item.brand || "").toLowerCase().includes(q)
    );
  });

  items = [...items];
  if (state.sort === "name") {
    items.sort((a, b) => a.name.localeCompare(b.name));
  } else if (state.sort === "expiration") {
    items.sort((a, b) => {
      if (a.expirationDate && b.expirationDate) return new Date(a.expirationDate) - new Date(b.expirationDate);
      if (a.expirationDate) return -1;
      if (b.expirationDate) return 1;
      return 0;
    });
  } else if (state.sort === "added") {
    items.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
  }
  return items;
}

function render() {
  const listEl = document.getElementById("list");
  const emptyEl = document.getElementById("empty-state");
  const countEl = document.getElementById("item-count");

  countEl.textContent = state.items.length ? String(state.items.length) : "";

  if (state.items.length === 0) {
    listEl.hidden = true;
    emptyEl.hidden = false;
    return;
  }
  listEl.hidden = false;
  emptyEl.hidden = true;

  const items = getFilteredSortedItems();
  listEl.innerHTML = "";

  items.forEach((item) => {
    const status = expirationStatus(item);
    const row = document.createElement("div");
    row.className = `item-row ${status}`;
    row.dataset.id = item.id;

    const thumb = document.createElement("div");
    thumb.className = "item-thumb";
    if (item.imageUrl) {
      const img = document.createElement("img");
      img.src = item.imageUrl;
      img.alt = "";
      thumb.appendChild(img);
    } else {
      thumb.innerHTML = jarGlyphSVG();
    }

    const info = document.createElement("div");
    info.className = "item-info";
    const nameEl = document.createElement("div");
    nameEl.className = "name";
    nameEl.textContent = item.name;

    const metaParts = [];
    if (item.category) metaParts.push(escapeHtml(item.category));
    if (item.expirationDate) {
      const cls = status === "expired" ? "exp-expired" : status === "soon" ? "exp-soon" : "";
      const label = status === "expired" ? "Expired" : "Exp";
      metaParts.push(`<span class="${cls}">${label} ${formatDate(item.expirationDate)}</span>`);
    }
    const metaEl = document.createElement("div");
    metaEl.className = "meta";
    metaEl.innerHTML = metaParts.join(" · ") || "&nbsp;";

    info.appendChild(nameEl);
    info.appendChild(metaEl);

    const qty = document.createElement("div");
    qty.className = "item-qty";
    qty.textContent = `×${item.quantity}`;

    row.appendChild(thumb);
    row.appendChild(info);
    row.appendChild(qty);
    row.addEventListener("click", () => openEditSheet(item.id));

    listEl.appendChild(row);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function jarGlyphSVG() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M8 4h8v3.5c1.5 0 2 1 2 2.5v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-9c0-1.5.5-2.5 2-2.5V4z" fill="#7C8A6A"/></svg>`;
}

async function refreshItems() {
  state.items = await getAllItems();
  render();
}

// ---------- Search & sort ----------

document.getElementById("search-input").addEventListener("input", (e) => {
  state.searchText = e.target.value;
  render();
});

document.querySelectorAll(".sort-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".sort-chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    state.sort = chip.dataset.sort;
    render();
  });
});

// ---------- Scan flow ----------

const scanOverlay = document.getElementById("scan-overlay");
const scanStageScanning = document.getElementById("scan-stage-scanning");
const scanStageLoading = document.getElementById("scan-stage-loading");
const scanStageForm = document.getElementById("scan-stage-form");

document.getElementById("fab-scan").addEventListener("click", openScanFlow);
document.getElementById("empty-scan-btn").addEventListener("click", openScanFlow);
document.getElementById("scan-cancel").addEventListener("click", closeScanFlow);

async function openScanFlow() {
  scanOverlay.hidden = false;
  showScanStage("scanning");
  try {
    await startScanner("scan-region", onBarcodeScanned, (err) => {
      showScanStage("scanning");
      document.getElementById("scan-hint").textContent =
        "Camera unavailable. Check camera permission in Settings and try again.";
    });
  } catch (err) {
    console.error(err);
  }
}

async function closeScanFlow() {
  await stopScanner();
  scanOverlay.hidden = true;
}

function showScanStage(stage) {
  scanStageScanning.hidden = stage !== "scanning";
  scanStageLoading.hidden = stage !== "loading";
  scanStageForm.hidden = stage !== "form";
  document.getElementById("scan-footer").style.display = stage === "form" ? "block" : "none";
}

async function onBarcodeScanned(barcode) {
  state.scannedBarcode = barcode;
  await stopScanner();
  showScanStage("loading");

  const [result, existing] = await Promise.all([lookupProduct(barcode), getItemByBarcode(barcode)]);
  buildScanForm(result, existing, barcode);
  showScanStage("form");
}

function buildScanForm(lookupResult, existing, barcode) {
  document.getElementById("scan-barcode-readout").textContent = `Barcode: ${barcode}`;

  const noteEl = document.getElementById("lookup-note");
  if (!lookupResult) {
    noteEl.hidden = false;
    noteEl.textContent = "Couldn't find this product online — enter it yourself below.";
  } else {
    noteEl.hidden = true;
  }

  document.getElementById("scan-name").value = existing?.name || lookupResult?.name || "";
  document.getElementById("scan-brand").value = existing?.brand || lookupResult?.brand || "";
  document.getElementById("scan-category").value = existing?.category || lookupResult?.category || "";

  const existingNote = document.getElementById("existing-note");
  if (existing) {
    existingNote.hidden = false;
    existingNote.textContent = `You already have ${existing.quantity} in your pantry — this adds to that.`;
  } else {
    existingNote.hidden = true;
  }

  let qty = 1;
  const qtyValueEl = document.getElementById("scan-qty-value");
  qtyValueEl.textContent = qty;
  document.getElementById("scan-qty-minus").onclick = () => {
    qty = Math.max(1, qty - 1);
    qtyValueEl.textContent = qty;
  };
  document.getElementById("scan-qty-plus").onclick = () => {
    qty = Math.min(999, qty + 1);
    qtyValueEl.textContent = qty;
  };

  const expToggle = document.getElementById("scan-exp-toggle");
  const expField = document.getElementById("scan-exp-field");
  const expInput = document.getElementById("scan-exp-date");
  expToggle.checked = false;
  expField.hidden = true;
  const defaultExp = new Date();
  defaultExp.setDate(defaultExp.getDate() + 7);
  expInput.value = defaultExp.toISOString().slice(0, 10);
  expToggle.onchange = () => {
    expField.hidden = !expToggle.checked;
  };

  document.getElementById("scan-save-btn").onclick = async () => {
    const name = document.getElementById("scan-name").value.trim() || "Unnamed Item";
    const brand = document.getElementById("scan-brand").value.trim() || null;
    const category = document.getElementById("scan-category").value.trim() || null;
    const expirationDate = expToggle.checked ? new Date(expInput.value).toISOString() : null;

    if (existing) {
      existing.quantity += qty;
      existing.name = name;
      existing.brand = brand;
      existing.category = category;
      existing.lastUpdated = new Date().toISOString();
      if (expirationDate) existing.expirationDate = expirationDate;
      await saveItem(existing);
    } else {
      await saveItem({
        id: crypto.randomUUID(),
        barcode,
        name,
        brand,
        category,
        quantity: qty,
        expirationDate,
        imageUrl: lookupResult?.imageUrl || null,
        dateAdded: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      });
    }

    scanOverlay.hidden = true;
    await refreshItems();
  };
}

// ---------- Edit existing item ----------

const editOverlay = document.getElementById("edit-overlay");
document.getElementById("edit-cancel").addEventListener("click", () => {
  editOverlay.hidden = true;
});

async function openEditSheet(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;

  document.getElementById("edit-name").value = item.name;
  document.getElementById("edit-brand").value = item.brand || "";
  document.getElementById("edit-category").value = item.category || "";
  document.getElementById("edit-barcode-readout").textContent = `Barcode: ${item.barcode}`;

  let qty = item.quantity;
  const qtyValueEl = document.getElementById("edit-qty-value");
  qtyValueEl.textContent = qty;
  document.getElementById("edit-qty-minus").onclick = () => {
    qty = Math.max(0, qty - 1);
    qtyValueEl.textContent = qty;
  };
  document.getElementById("edit-qty-plus").onclick = () => {
    qty = Math.min(999, qty + 1);
    qtyValueEl.textContent = qty;
  };

  const expToggle = document.getElementById("edit-exp-toggle");
  const expField = document.getElementById("edit-exp-field");
  const expInput = document.getElementById("edit-exp-date");
  expToggle.checked = Boolean(item.expirationDate);
  expField.hidden = !item.expirationDate;
  expInput.value = item.expirationDate
    ? new Date(item.expirationDate).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  expToggle.onchange = () => {
    expField.hidden = !expToggle.checked;
  };

  document.getElementById("edit-save-btn").onclick = async () => {
    item.name = document.getElementById("edit-name").value.trim() || "Unnamed Item";
    item.brand = document.getElementById("edit-brand").value.trim() || null;
    item.category = document.getElementById("edit-category").value.trim() || null;
    item.quantity = qty;
    item.expirationDate = expToggle.checked ? new Date(expInput.value).toISOString() : null;
    item.lastUpdated = new Date().toISOString();
    await saveItem(item);
    editOverlay.hidden = true;
    await refreshItems();
  };

  document.getElementById("edit-delete-btn").onclick = async () => {
    await deleteItem(item.id);
    editOverlay.hidden = true;
    await refreshItems();
  };

  editOverlay.hidden = false;
}

// ---------- Backup: export / import ----------

const backupOverlay = document.getElementById("backup-overlay");
const backupStatus = document.getElementById("backup-status");

document.getElementById("menu-btn").addEventListener("click", () => {
  backupStatus.textContent = "";
  backupOverlay.hidden = false;
});
document.getElementById("backup-cancel").addEventListener("click", () => {
  backupOverlay.hidden = true;
});

document.getElementById("export-btn").addEventListener("click", async () => {
  const items = await getAllItems();
  const payload = {
    app: "pantry-scanner",
    exportedAt: new Date().toISOString(),
    items,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const dateStamp = new Date().toISOString().slice(0, 10);

  const a = document.createElement("a");
  a.href = url;
  a.download = `pantry-backup-${dateStamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  backupStatus.textContent = `Exported ${items.length} item${items.length === 1 ? "" : "s"}. Save the file somewhere safe (e.g. Files app or iCloud Drive).`;
});

document.getElementById("import-btn").addEventListener("click", () => {
  document.getElementById("import-file").click();
});

document.getElementById("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // allow re-selecting the same file later
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const items = Array.isArray(parsed) ? parsed : parsed.items;

    if (!Array.isArray(items)) {
      throw new Error("This file doesn't look like a Pantry backup.");
    }

    let imported = 0;
    for (const raw of items) {
      if (!raw || typeof raw !== "object" || !raw.barcode || !raw.name) continue;
      await saveItem({
        id: raw.id || crypto.randomUUID(),
        barcode: raw.barcode,
        name: raw.name,
        brand: raw.brand || null,
        category: raw.category || null,
        quantity: typeof raw.quantity === "number" ? raw.quantity : 1,
        expirationDate: raw.expirationDate || null,
        imageUrl: raw.imageUrl || null,
        dateAdded: raw.dateAdded || new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      });
      imported += 1;
    }

    await refreshItems();
    backupStatus.textContent = `Imported ${imported} item${imported === 1 ? "" : "s"}. Items with a matching ID were updated; others were added.`;
  } catch (err) {
    console.error(err);
    backupStatus.textContent = "Couldn't read that file — make sure it's a Pantry backup exported from this app.";
  }
});

// ---------- Boot ----------

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}

refreshItems();
