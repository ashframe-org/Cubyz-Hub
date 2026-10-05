const CHANGELOG_LAST_SEEN_KEY = "cubyzhub-changelog-last-seen";
const CHANGELOG_TRUNCATE_PX = 150;

let isChangelogAdmin = false;
let editingEntryId = null;
let allChangelogEntries = [];
let currentModalEntry = null;
let activeChangelogFilter = "";

const changelogPurifierConfig = { ADD_TAGS: ["img"], ADD_ATTR: ["src", "alt", "title"] };

function looksLikeHTML(text) {
  return /<\/?[a-z][\s\S]*>/i.test(text);
}

function looksLikeMarkdown(text) {
  return (
    text.includes("#") ||
    text.includes("**") ||
    text.includes("- ") ||
    (text.includes("[") && text.includes("]("))
  );
}

function renderChangelogBody(text) {
  if (!text) return "";
  let html;
  if (looksLikeHTML(text)) {
    html = text;
  } else if (looksLikeMarkdown(text)) {
    html = marked.parse(text);
  } else {
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = escaped.replace(/\n/g, "<br>");
  }
  return DOMPurify.sanitize(html, changelogPurifierConfig);
}

function formatChangelogDate(value) {
  if (!value) return "";
  const isoValue = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
}

function changelogTagLabel(tag) {
  if (tag === "major") return "Major";
  if (tag === "minor") return "Minor";
  return "";
}

let changelogImgModalImages = [];
let changelogImgModalIndex = 0;

function openChangelogImgModal(images, startIndex) {
  const modal = document.getElementById("changelog-img-modal");
  if (!modal || !images.length) return;
  changelogImgModalImages = images;
  changelogImgModalIndex = startIndex;
  document.getElementById("changelog-img-modal-content").src = images[startIndex];
  modal.style.display = "flex";
}

function showChangelogImgModalIndex(index) {
  if (!changelogImgModalImages.length) return;
  changelogImgModalIndex = (index + changelogImgModalImages.length) % changelogImgModalImages.length;
  document.getElementById("changelog-img-modal-content").src = changelogImgModalImages[changelogImgModalIndex];
}

function setupChangelogImgModal() {
  const modal = document.getElementById("changelog-img-modal");
  if (!modal) return;
  document.getElementById("changelog-img-modal-close").addEventListener("click", () => {
    modal.style.display = "none";
  });
  document.getElementById("changelog-img-prev").addEventListener("click", () => showChangelogImgModalIndex(changelogImgModalIndex - 1));
  document.getElementById("changelog-img-next").addEventListener("click", () => showChangelogImgModalIndex(changelogImgModalIndex + 1));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.style.display = "none";
  });
  document.addEventListener("keydown", (e) => {
    if (modal.style.display !== "flex") return;
    if (e.key === "ArrowLeft") showChangelogImgModalIndex(changelogImgModalIndex - 1);
    if (e.key === "ArrowRight") showChangelogImgModalIndex(changelogImgModalIndex + 1);
    if (e.key === "Escape") modal.style.display = "none";
  });
}

function renderScreenshotThumbs(container, screenshots) {
  container.innerHTML = "";
  if (!screenshots || !screenshots.length) return;
  screenshots.forEach((src, i) => {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "screenshot";
    img.addEventListener("click", () => openChangelogImgModal(screenshots, i));
    container.appendChild(img);
  });
}

function openChangelogModal(entry) {
  const modal = document.getElementById("changelog-modal");
  if (!modal) return;
  document.getElementById("changelog-modal-title").textContent = entry.title;
  document.getElementById("changelog-modal-date").textContent = formatChangelogDate(entry.created_at);
  document.getElementById("changelog-modal-body").innerHTML = renderChangelogBody(entry.body);
  renderScreenshotThumbs(document.getElementById("changelog-modal-screenshots"), entry.screenshots);
  const captureBtn = document.getElementById("changelog-modal-capture-btn");
  if (captureBtn) captureBtn.classList.toggle("hidden", !isChangelogAdmin);
  const downloadBtn = document.getElementById("changelog-modal-download-btn");
  if (downloadBtn) downloadBtn.classList.toggle("hidden", !isChangelogAdmin);
  const previewBtn = document.getElementById("changelog-modal-preview-btn");
  if (previewBtn) previewBtn.classList.toggle("hidden", !isChangelogAdmin);
  currentModalEntry = entry;
  modal.classList.remove("hidden");
}

function closeChangelogModal() {
  const modal = document.getElementById("changelog-modal");
  if (modal) modal.classList.add("hidden");
  currentModalEntry = null;
}

async function renderChangelogCaptureCanvas() {
  const box = document.querySelector(".changelog-modal-box");
  if (!box || typeof html2canvas !== "function") return null;

  const excludedIds = new Set([
    "changelog-modal-close",
    "changelog-modal-preview-btn",
    "changelog-modal-capture-btn",
    "changelog-modal-download-btn",
    "changelog-modal-screenshots"
  ]);

  const bg = getComputedStyle(box).backgroundColor;
  return html2canvas(box, {
    backgroundColor: bg && bg !== "rgba(0, 0, 0, 0)" ? bg : "#1e1e1e",
    scale: 2,
    useCORS: true,
    ignoreElements: (el) => excludedIds.has(el.id)
  });
}

async function captureChangelogModalImage() {
  const captureBtn = document.getElementById("changelog-modal-capture-btn");
  if (typeof html2canvas !== "function") return;

  const originalLabel = captureBtn.textContent;
  const reset = () => { captureBtn.textContent = originalLabel; captureBtn.disabled = false; };
  captureBtn.disabled = true;
  captureBtn.textContent = "Copying…";
  try {
    const canvas = await renderChangelogCaptureCanvas();
    if (!canvas) {
      captureBtn.textContent = "Failed - try again";
      setTimeout(reset, 2000);
      return;
    }

    canvas.toBlob(async (blob) => {
      if (!blob) {
        captureBtn.textContent = "Failed - try again";
        setTimeout(reset, 2000);
        return;
      }
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        captureBtn.textContent = "Copied!";
      } catch (err) {
        console.error("Clipboard write failed:", err);
        captureBtn.textContent = "Copy failed - check permissions";
      }
      setTimeout(reset, 2000);
    }, "image/png");
  } catch (err) {
    console.error("Failed to capture changelog entry as image:", err);
    captureBtn.textContent = "Failed - try again";
    setTimeout(reset, 2000);
  }
}

async function downloadChangelogModalImage() {
  const downloadBtn = document.getElementById("changelog-modal-download-btn");
  if (typeof html2canvas !== "function") return;

  const originalLabel = downloadBtn.textContent;
  const reset = () => { downloadBtn.textContent = originalLabel; downloadBtn.disabled = false; };
  downloadBtn.disabled = true;
  downloadBtn.textContent = "Preparing…";
  try {
    const canvas = await renderChangelogCaptureCanvas();
    if (!canvas) {
      downloadBtn.textContent = "Failed - try again";
      setTimeout(reset, 2000);
      return;
    }

    canvas.toBlob((blob) => {
      if (!blob) {
        downloadBtn.textContent = "Failed - try again";
        setTimeout(reset, 2000);
        return;
      }
      const titleEl = document.getElementById("changelog-modal-title");
      const slug = (titleEl?.textContent || "changelog-update").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slug || "changelog-update"}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      reset();
    }, "image/png");
  } catch (err) {
    console.error("Failed to download changelog entry as image:", err);
    downloadBtn.textContent = "Failed - try again";
    setTimeout(reset, 2000);
  }
}

async function setChangelogPreviewImage() {
  const btn = document.getElementById("changelog-modal-preview-btn");
  const entry = currentModalEntry;
  if (!btn || !entry || typeof html2canvas !== "function") return;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Generating…";
  try {
    const canvas = await renderChangelogCaptureCanvas();
    if (!canvas) throw new Error("capture failed");
    const dataUrl = canvas.toDataURL("image/png");
    const res = await fetch(`/api/admin/changelog/${entry.id}/og-image`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "text/plain" },
      body: dataUrl,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    if (!res.ok || !json || !json.ok) {
      throw new Error((json && json.error) || `Request failed (${res.status}).`);
    }
    entry.og_image = json.og_image;
    if (window.toast && typeof window.toast.success === "function") window.toast.success("Link preview image set");
    btn.textContent = "Preview set!";
  } catch (err) {
    console.error("Failed to set changelog preview image:", err);
    if (window.toast && typeof window.toast.error === "function") window.toast.error(err.message || "Failed to set preview image");
    btn.textContent = "Failed - try again";
  }
  setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1800);
}

function renderChangelogEntries() {
  const list = document.getElementById("changelog-list");
  const empty = document.getElementById("changelog-empty");
  const filterBar = document.getElementById("changelog-filter-bar");
  if (!list) return;

  const entries = activeChangelogFilter
    ? allChangelogEntries.filter((entry) => entry.tag === activeChangelogFilter)
    : allChangelogEntries;

  if (filterBar) filterBar.classList.toggle("hidden", allChangelogEntries.length === 0);

  if (!entries.length) {
    list.innerHTML = "";
    if (empty) empty.classList.remove("hidden");
    return;
  }
  if (empty) empty.classList.add("hidden");

  list.innerHTML = entries.map((entry) => {
    const fullIndex = allChangelogEntries.indexOf(entry);
    const prevEntry = allChangelogEntries[fullIndex - 1];
    const nextEntry = allChangelogEntries[fullIndex + 1];
    const canMoveUp = isChangelogAdmin && prevEntry && prevEntry.created_at === entry.created_at;
    const canMoveDown = isChangelogAdmin && nextEntry && nextEntry.created_at === entry.created_at;

    return `
    <article class="changelog-entry${entry.is_draft ? " changelog-entry-draft" : ""}">
      <div class="changelog-entry-header">
        <h3 class="changelog-entry-title"></h3>
        <div class="changelog-entry-meta">
          ${(canMoveUp || canMoveDown) ? `
            <span class="changelog-reorder-btns">
              <button type="button" class="changelog-reorder-btn changelog-move-up-btn" title="Move up" ${canMoveUp ? "" : "disabled"}>▲</button>
              <button type="button" class="changelog-reorder-btn changelog-move-down-btn" title="Move down" ${canMoveDown ? "" : "disabled"}>▼</button>
            </span>
          ` : ""}
          ${entry.is_draft ? '<span class="changelog-entry-draft-badge">DRAFT - only visible to you</span>' : ""}
          ${entry.tag ? `<span class="changelog-entry-tag changelog-entry-tag-${entry.tag}">${changelogTagLabel(entry.tag)}</span>` : ""}
          <button type="button" class="changelog-link-btn btn btn-ghost btn-sm" title="Copy a shareable link to this update">Copy link</button>
          <span class="changelog-entry-date">${formatChangelogDate(entry.created_at)}</span>
        </div>
      </div>
      <div class="changelog-entry-body addon-longdesc"></div>
      <div class="changelog-entry-fade hidden"></div>
      <button type="button" class="changelog-show-more hidden">Show more</button>
      <div class="changelog-screenshots"></div>
      ${isChangelogAdmin ? `
        <div class="changelog-entry-admin-actions">
          ${entry.is_draft ? '<button type="button" class="changelog-publish-btn btn btn-primary btn-sm">Publish</button>' : ""}
          <button type="button" class="changelog-view-btn btn btn-ghost btn-sm">Copy/download image</button>
          <button type="button" class="changelog-edit-btn btn btn-ghost btn-sm">Edit</button>
          <button type="button" class="changelog-delete-btn btn btn-ghost btn-sm">Delete</button>
        </div>
      ` : ""}
    </article>
  `;
  }).join("");

  const articles = list.querySelectorAll(".changelog-entry");
  entries.forEach((entry, i) => {
    const article = articles[i];
    article.querySelector(".changelog-entry-title").textContent = entry.title;

    const bodyEl = article.querySelector(".changelog-entry-body");
    bodyEl.innerHTML = renderChangelogBody(entry.body);

    renderScreenshotThumbs(article.querySelector(".changelog-screenshots"), entry.screenshots);

    const linkBtn = article.querySelector(".changelog-link-btn");
    if (linkBtn) linkBtn.addEventListener("click", () => copyChangelogLink(entry));

    requestAnimationFrame(() => {
      if (bodyEl.scrollHeight > CHANGELOG_TRUNCATE_PX + 4) {
        bodyEl.classList.add("is-truncated");
        article.querySelector(".changelog-entry-fade").classList.remove("hidden");
        const showMoreBtn = article.querySelector(".changelog-show-more");
        showMoreBtn.classList.remove("hidden");
        showMoreBtn.addEventListener("click", () => openChangelogModal(entry));
      }
    });

    if (isChangelogAdmin) {
      article.querySelector(".changelog-view-btn").addEventListener("click", () => openChangelogModal(entry));
      article.querySelector(".changelog-edit-btn").addEventListener("click", () => startEditingEntry(entry));
      article.querySelector(".changelog-delete-btn").addEventListener("click", () => deleteChangelogEntry(entry));
      const publishBtn = article.querySelector(".changelog-publish-btn");
      if (publishBtn) publishBtn.addEventListener("click", () => publishChangelogEntry(entry));
      const upBtn = article.querySelector(".changelog-move-up-btn");
      if (upBtn && !upBtn.disabled) upBtn.addEventListener("click", () => reorderChangelogEntry(entry, "up"));
      const downBtn = article.querySelector(".changelog-move-down-btn");
      if (downBtn && !downBtn.disabled) downBtn.addEventListener("click", () => reorderChangelogEntry(entry, "down"));
    }
  });
}

async function reorderChangelogEntry(entry, direction) {
  try {
    const res = await fetch(`/api/admin/changelog/${entry.id}/reorder`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction })
    });
    const json = await res.json();
    if (!json.ok) {
      toast.error(json.error || "Failed to reorder entry.");
      return;
    }
    loadChangelog();
  } catch (err) {
    toast.error("Failed to reorder entry.");
  }
}

function setupChangelogFilterBar() {
  const filterBar = document.getElementById("changelog-filter-bar");
  if (!filterBar) return;
  filterBar.addEventListener("click", (e) => {
    const btn = e.target.closest(".changelog-filter-btn");
    if (!btn) return;
    activeChangelogFilter = btn.dataset.filter || "";
    filterBar.querySelectorAll(".changelog-filter-btn").forEach((b) => b.classList.toggle("active", b === btn));
    renderChangelogEntries();
  });
}

async function publishChangelogEntry(entry) {
  if (!confirm(`Publish "${entry.title}"? This makes it public.`)) return;
  const notify = confirm(`Also notify everyone about "${entry.title}"?\n\nOK = notify everyone\nCancel = publish silently, no notification`);
  try {
    const res = await fetch(`/api/admin/changelog/${entry.id}/publish`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notify })
    });
    const json = await res.json();
    if (!json.ok) {
      toast.error(json.error || "Failed to publish entry.");
      return;
    }
    loadChangelog();
  } catch (err) {
    toast.error("Failed to publish entry.");
  }
}

function changelogShareVersion(entry) {
  const s = entry.og_image || "";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function copyChangelogLink(entry) {
  // Include a version when a preview image is set so a re-shared entry gets a
  // fresh Discord embed (Discord caches embeds per URL).
  const suffix = entry.og_image ? `?v=${changelogShareVersion(entry)}` : "";
  const url = `${location.origin}/changelog/${entry.id}${suffix}`;
  const done = () => {
    if (window.toast && typeof window.toast.success === "function") window.toast.success("Link copied");
    else if (window.toast) window.toast("Link copied");
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done, () => {});
  } else {
    done();
  }
}

async function loadChangelog() {
  try {
    const res = await fetch("/api/changelog", { credentials: "include" });
    const json = await res.json();
    if (!json.ok) return;
    allChangelogEntries = json.entries || [];
    renderChangelogEntries();

    // Deep link: /changelog/<id> opens that entry.
    const match = location.pathname.match(/^\/changelog\/(\d+)/);
    if (match) {
      const entry = allChangelogEntries.find((e) => String(e.id) === match[1]);
      if (entry) openChangelogModal(entry);
    }

    const latestReal = allChangelogEntries.find((entry) => !entry.is_draft);
    if (latestReal) {
      try {
        localStorage.setItem(CHANGELOG_LAST_SEEN_KEY, String(latestReal.id));
      } catch (_) {}
    }
  } catch (err) {
    console.error("Failed to load changelog:", err);
  }
}

function toDateInputValue(createdAt) {
  if (!createdAt) return "";
  const isoValue = createdAt.includes("T") ? createdAt : createdAt.replace(" ", "T") + "Z";
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return "";
  const iso = date.toISOString().slice(0, 10);
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function parseDateInputValue(value) {
  if (!value || !value.trim()) return null;
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return iso;
}

function renderComposerScreenshots(entry) {
  const container = document.getElementById("changelog-composer-screenshots");
  const hint = document.getElementById("changelog-screenshots-hint");
  if (!container) return;
  container.innerHTML = "";
  (entry?.screenshots || []).forEach((src) => {
    const wrapper = document.createElement("div");
    wrapper.className = "changelog-screenshot-item";
    const img = document.createElement("img");
    img.src = src;
    img.alt = "screenshot";
    img.addEventListener("click", () => openChangelogImgModal(entry.screenshots, entry.screenshots.indexOf(src)));
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "changelog-screenshot-delete-btn";
    delBtn.textContent = "✕";
    delBtn.title = "Delete screenshot";
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Delete this screenshot?")) return;
      try {
        const res = await fetch(`/api/admin/changelog/${entry.id}/screenshots/remove`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: src })
        });
        const json = await res.json();
        if (!json.ok) {
          toast.error(json.error || "Failed to delete screenshot.");
          return;
        }
        entry.screenshots = json.screenshots;
        renderComposerScreenshots(entry);
      } catch (err) {
        toast.error("Failed to delete screenshot.");
      }
    });
    wrapper.append(img, delBtn);
    container.appendChild(wrapper);
  });

  if (hint) hint.classList.toggle("hidden", !!entry);
  const addBtn = document.getElementById("changelog-add-screenshot-btn");
  if (addBtn) addBtn.classList.toggle("hidden", !entry);
}

function startEditingEntry(entry) {
  editingEntryId = entry.id;
  document.getElementById("changelog-composer-heading").textContent = "Edit update";
  document.getElementById("changelog-title-input").value = entry.title;
  document.getElementById("changelog-body-input").value = entry.body;
  document.getElementById("changelog-date-input").value = toDateInputValue(entry.created_at);
  document.getElementById("changelog-tag-select").value = entry.tag || "";
  document.getElementById("changelog-notify-row").classList.add("hidden");
  document.getElementById("changelog-post-btn").textContent = "Save changes";
  document.getElementById("changelog-draft-btn").classList.add("hidden");
  document.getElementById("changelog-cancel-edit-btn").classList.remove("hidden");
  renderComposerScreenshots(entry);
  document.getElementById("changelog-composer").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cancelEditingEntry() {
  editingEntryId = null;
  document.getElementById("changelog-composer-heading").textContent = "Post an update";
  document.getElementById("changelog-title-input").value = "";
  document.getElementById("changelog-body-input").value = "";
  document.getElementById("changelog-date-input").value = "";
  document.getElementById("changelog-tag-select").value = "";
  document.getElementById("changelog-notify-checkbox").checked = true;
  document.getElementById("changelog-notify-row").classList.remove("hidden");
  document.getElementById("changelog-post-btn").textContent = "Publish now";
  document.getElementById("changelog-draft-btn").classList.remove("hidden");
  document.getElementById("changelog-cancel-edit-btn").classList.add("hidden");
  document.getElementById("changelog-composer-error").hidden = true;
  renderComposerScreenshots(null);
}

async function deleteChangelogEntry(entry) {
  if (!confirm(`Delete "${entry.title}"? This cannot be undone.`)) return;
  try {
    const res = await fetch(`/api/admin/changelog/${entry.id}`, {
      method: "DELETE",
      credentials: "include"
    });
    const json = await res.json();
    if (!json.ok) {
      toast.error(json.error || "Failed to delete entry.");
      return;
    }
    if (editingEntryId === entry.id) cancelEditingEntry();
    loadChangelog();
  } catch (err) {
    toast.error("Failed to delete entry.");
  }
}

async function setupComposer() {
  const composer = document.getElementById("changelog-composer");
  if (!composer) return;

  try {
    const res = await fetch("/api/auth/status", { credentials: "include" });
    const json = await res.json();
    if (!json.ok || json.user?.username !== "iNiKKo") return;
  } catch (_) {
    return;
  }

  isChangelogAdmin = true;
  composer.classList.remove("hidden");

  const titleInput = document.getElementById("changelog-title-input");
  const bodyInput = document.getElementById("changelog-body-input");
  const dateInput = document.getElementById("changelog-date-input");
  const tagSelect = document.getElementById("changelog-tag-select");
  const notifyCheckbox = document.getElementById("changelog-notify-checkbox");
  const errorEl = document.getElementById("changelog-composer-error");
  const postBtn = document.getElementById("changelog-post-btn");
  const draftBtn = document.getElementById("changelog-draft-btn");
  const cancelEditBtn = document.getElementById("changelog-cancel-edit-btn");
  const addScreenshotBtn = document.getElementById("changelog-add-screenshot-btn");

  cancelEditBtn.addEventListener("click", cancelEditingEntry);
  renderComposerScreenshots(null);

  const screenshotFileInput = document.createElement("input");
  screenshotFileInput.type = "file";
  screenshotFileInput.accept = "image/*";
  screenshotFileInput.multiple = true;
  screenshotFileInput.style.display = "none";
  document.body.appendChild(screenshotFileInput);

  addScreenshotBtn.addEventListener("click", () => screenshotFileInput.click());
  screenshotFileInput.addEventListener("change", async () => {
    if (!screenshotFileInput.files.length || editingEntryId === null) return;
    const fd = new FormData();
    for (const f of screenshotFileInput.files) {
      const compressed = await compressImage(f, 1920, 1080, 0.8);
      fd.append("screenshots", compressed);
    }
    try {
      const res = await fetch(`/api/admin/changelog/${editingEntryId}/screenshots`, {
        method: "POST",
        credentials: "include",
        body: fd
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error || "Screenshot upload failed.");
        return;
      }
      renderComposerScreenshots({ id: editingEntryId, screenshots: json.screenshots });
    } catch (err) {
      toast.error("Screenshot upload failed.");
    } finally {
      screenshotFileInput.value = "";
    }
  });

  async function submitComposer(isDraft) {
    errorEl.hidden = true;
    const title = titleInput.value.trim();
    const body = bodyInput.value.trim();
    if (!title || !body) {
      errorEl.textContent = "Title and body are required.";
      errorEl.hidden = false;
      return;
    }

    let dateValue = "";
    if (dateInput.value.trim()) {
      const parsed = parseDateInputValue(dateInput.value);
      if (!parsed) {
        errorEl.textContent = "Date must be in DD/MM/YYYY format.";
        errorEl.hidden = false;
        return;
      }
      dateValue = parsed;
    }

    postBtn.disabled = true;
    draftBtn.disabled = true;
    try {
      const isEditing = editingEntryId !== null;
      const url = isEditing ? `/api/admin/changelog/${editingEntryId}` : "/api/admin/changelog";
      const payload = isEditing
        ? { title, body, date: dateValue, tag: tagSelect.value }
        : { title, body, date: dateValue, tag: tagSelect.value, isDraft, notify: notifyCheckbox.checked };
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.ok) {
        errorEl.textContent = json.error || "Failed to save update.";
        errorEl.hidden = false;
        return;
      }

      if (isEditing) {
        cancelEditingEntry();
      } else {
        loadChangelog();
        startEditingEntry({ id: json.id, title, body, created_at: null, tag: tagSelect.value || null, screenshots: [] });
        return;
      }
      loadChangelog();
    } catch (err) {
      errorEl.textContent = "Failed to save update.";
      errorEl.hidden = false;
    } finally {
      postBtn.disabled = false;
      draftBtn.disabled = false;
    }
  }

  postBtn.addEventListener("click", () => submitComposer(false));
  draftBtn.addEventListener("click", () => submitComposer(true));
}

function setupModal() {
  const modal = document.getElementById("changelog-modal");
  if (!modal) return;
  document.getElementById("changelog-modal-close").addEventListener("click", closeChangelogModal);
  document.getElementById("changelog-modal-capture-btn").addEventListener("click", captureChangelogModalImage);
  document.getElementById("changelog-modal-download-btn").addEventListener("click", downloadChangelogModalImage);
  const previewBtn = document.getElementById("changelog-modal-preview-btn");
  if (previewBtn) previewBtn.addEventListener("click", setChangelogPreviewImage);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeChangelogModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeChangelogModal();
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  await setupComposer();
  const bodyInput = document.getElementById("changelog-body-input");
  const bodyToolbar = document.getElementById("changelog-body-toolbar");
  if (bodyInput && bodyToolbar && window.ForumEditor) window.ForumEditor.attach(bodyInput, bodyToolbar);
  loadChangelog();
  setupModal();
  setupChangelogImgModal();
  setupChangelogFilterBar();
});
