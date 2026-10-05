function parseServerDate(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(value.replace(" ", "T") + "Z");
  }
  return new Date(value);
}

function showToast(msg, { error = false, duration } = {}) {
  if (typeof window.toast === "function") {
    (error ? window.toast.error : window.toast.info)(msg, duration ? { duration } : undefined);
    return;
  }
  const area = document.getElementById("toastArea");
  if (!area) return;
  const t = document.createElement("div");
  t.className = "toast" + (error ? " error" : "");
  t.textContent = msg;
  area.appendChild(t);

  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 250);
  }, typeof duration === "number" ? duration : 2000);
}



let currentAddons = [];

const addonGrid = document.getElementById("addonGrid");
const emptyState = document.getElementById("emptyState");


async function loadUserAddons() {
  try {
    const res = await fetch("/api/user/addons", { credentials: "include" });
    if (res.status === 401) {
      window.location.href = "/";
      return;
    }

    const json = await res.json();

    addonGrid.innerHTML = "";
    if (!json.ok || !Array.isArray(json.addons) || json.addons.length === 0) {
      emptyState.classList.remove("hidden");
      return;
    }

    emptyState.classList.add("hidden");
    currentAddons = json.addons;

    currentAddons.forEach((a) => {
      const card = document.createElement("article");
      card.className = "user-addon-card fade-in-card";
      card.innerHTML = `
      <div class="user-addon-icon">
        <img class="img-fade" src="${a.iconThumbUrl || a.iconUrl || "assets/default_icon.png"}" alt="icon">
      </div>
      <div class="user-addon-info">
        <h4>${escapeHtml(a.name)}</h4>
        <div class="user-addon-meta">v${escapeHtml(a.version || "—")} &bull; ${parseServerDate(a.created_at).toLocaleDateString("en-GB")}</div>
        <div class="user-addon-actions">
          <button class="btn btn-ghost btn-sm view-btn" data-id="${a.id}">View</button>
          <button class="btn btn-danger btn-sm delete-btn" data-id="${a.id}">Delete</button>
        </div>
      </div>
      `;

      const cardIcon = card.querySelector("img.img-fade");
      if (cardIcon) {
        const reveal = () => cardIcon.classList.add("loaded");
        if (cardIcon.complete && cardIcon.naturalWidth > 0) reveal();
        else {
          cardIcon.addEventListener("load", reveal, { once: true });
          cardIcon.addEventListener("error", reveal, { once: true });
        }
      }

      addonGrid.appendChild(card);
    });

    document.querySelectorAll(".view-btn").forEach((b) =>
      b.addEventListener("click", () => {
        window.location.href = `/addon.html?id=${b.dataset.id}`;
      })
    );

    document.querySelectorAll(".delete-btn").forEach((b) =>
      b.addEventListener("click", () => openConfirmDelete(b.dataset.id))
    );
  } catch (err) {
    console.error("LOAD ADDONS FAIL:", err);
    emptyState.classList.remove("hidden");
  }
}


const confirmModal = document.getElementById("confirmModal");
const confirmOk = document.getElementById("confirmOk");
const confirmCancel = document.getElementById("confirmCancel");
let deleteTarget = null;

function openConfirmDelete(id) {
  deleteTarget = id;
  confirmModal.classList.add("open");
  confirmModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

confirmCancel.addEventListener("click", () => {
  confirmModal.classList.remove("open");
  confirmModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
});

confirmOk.addEventListener("click", async () => {
  if (!deleteTarget) return;

  try {
    const r = await fetch(`/api/addons/${deleteTarget}`, { method: "DELETE", credentials: "include" });
    const j = await r.json().catch(() => ({ ok: false }));

    if (j.ok) {
      showToast("Deleted", { duration: 900 });
      setTimeout(() => loadUserAddons(), 400);
    } else {
      showToast("Delete failed", { error: true });
    }
  } catch (e) {
    showToast("Delete failed", { error: true });
  }

  confirmModal.classList.remove("open");
  confirmModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
});


function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (m) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[m];
  });
}


const modelGrid = document.getElementById("modelGrid");
const modelEmptyState = document.getElementById("modelEmptyState");

async function loadUserModels() {
  if (!modelGrid) return;
  try {
    const res = await fetch("/api/user/models", { credentials: "include" });
    if (res.status === 401) return;

    const json = await res.json();
    modelGrid.innerHTML = "";
    if (!json.ok || !Array.isArray(json.models) || json.models.length === 0) {
      modelEmptyState.classList.remove("hidden");
      return;
    }

    modelEmptyState.classList.add("hidden");
    if (window.ModelViewer) window.ModelViewer.disposeAll();
    modelGrid.innerHTML = "";
    json.models.forEach((m, idx) => {
      const isDraft = m.status === "draft";
      const card = document.createElement("article");
      card.className = "model-card fade-in-card";
      card.innerHTML = `
      <div class="model-card-header">
        ${escapeHtml(m.title)}
        ${isDraft ? '<span class="model-draft-badge">Draft</span>' : ""}
      </div>
      <div class="model-card-thumb" id="dash-model-canvas-${idx}"></div>
      <div class="model-card-footer">
        <div class="model-card-actions">
          ${isDraft ? `<button class="btn btn-ghost btn-sm model-publish-btn" data-id="${m.id}">Publish</button>` : ""}
          <button class="btn btn-ghost btn-sm model-edit-btn" data-id="${m.id}">Edit</button>
          <button class="btn btn-danger btn-sm model-delete-btn" data-id="${m.id}">Delete</button>
        </div>
      </div>
      `;

      modelGrid.appendChild(card);
      if (window.ModelViewer) {
        window.ModelViewer.mount(document.getElementById(`dash-model-canvas-${idx}`), m);
      }
    });

    modelGrid.querySelectorAll(".model-delete-btn").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!confirm("Delete this model?")) return;
        try {
          const res = await fetch(`/api/models/${b.dataset.id}`, { method: "DELETE" });
          const data = await res.json();
          if (!data.ok) {
            showToast(data.error || "Failed to delete.", { error: true });
            return;
          }
          await loadUserModels();
        } catch (err) {
          console.error("Delete model failed:", err);
          showToast("Failed to delete.", { error: true });
        }
      })
    );

    modelGrid.querySelectorAll(".model-edit-btn").forEach((b) =>
      b.addEventListener("click", () => {
        window.location.href = `/uploadmodel.html?edit=${encodeURIComponent(b.dataset.id)}`;
      })
    );

    modelGrid.querySelectorAll(".model-publish-btn").forEach((b) =>
      b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          const res = await fetch(`/api/models/${b.dataset.id}/update`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "published" }),
          });
          const data = await res.json();
          if (!data.ok) {
            showToast(data.error || "Failed to publish.", { error: true });
            b.disabled = false;
            return;
          }
          showToast("Model published.");
          await loadUserModels();
        } catch (err) {
          console.error("Publish model failed:", err);
          showToast("Failed to publish.", { error: true });
          b.disabled = false;
        }
      })
    );
  } catch (err) {
    console.error("Failed to load user models:", err);
  }
}

const serverManageGrid = document.getElementById("serverManageGrid");
const serverEmptyState = document.getElementById("serverEmptyState");

async function loadUserServers() {
  if (!serverManageGrid) return;
  try {
    const res = await fetch("/api/user/servers", { credentials: "include" });
    if (res.status === 401) return;

    const json = await res.json();
    serverManageGrid.innerHTML = "";
    if (!json.ok || !Array.isArray(json.servers) || json.servers.length === 0) {
      serverEmptyState.classList.remove("hidden");
      return;
    }

    serverEmptyState.classList.add("hidden");
    json.servers.forEach((s) => {
      const isDraft = s.status === "draft";
      const isOnline = !!s.online;
      const card = document.createElement("article");
      card.className = "server-card fade-in-card";
      card.innerHTML = `
      <img class="server-card-icon img-fade" src="${escapeHtml(s.icon_url || "assets/default_icon.png")}" alt="">
      <div class="server-card-main">
        <div class="server-card-title-row">
          <span class="server-card-title">${escapeHtml(s.name)}</span>
          ${isDraft ? '<span class="server-draft-badge">Draft</span>' : ""}
        </div>
        <p class="server-card-desc">${escapeHtml(s.description || "")}</p>
      </div>
      <div class="server-card-stats">
        <span class="server-status-badge ${isOnline ? "server-status-online" : "server-status-offline"}">${isOnline ? `Online - ${escapeHtml(String(s.player_count ?? 0))} players` : "Offline"}</span>
        <div class="user-addon-actions">
          <button class="btn btn-ghost btn-sm server-publish-btn" data-id="${s.id}" data-draft="${isDraft}">${isDraft ? "Publish" : "Unpublish"}</button>
          <button class="btn btn-ghost btn-sm server-edit-btn" data-id="${s.id}">Edit</button>
          <button class="btn btn-danger btn-sm server-delete-btn" data-id="${s.id}">Delete</button>
        </div>
      </div>
      `;
      const serverIcon = card.querySelector("img.img-fade");
      if (serverIcon) {
        const reveal = () => serverIcon.classList.add("loaded");
        if (serverIcon.complete && serverIcon.naturalWidth > 0) reveal();
        else {
          serverIcon.addEventListener("load", reveal, { once: true });
          serverIcon.addEventListener("error", reveal, { once: true });
        }
      }
      serverManageGrid.appendChild(card);
    });

    serverManageGrid.querySelectorAll(".server-delete-btn").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!confirm("Delete this server?")) return;
        try {
          const res = await fetch(`/api/servers/${b.dataset.id}`, { method: "DELETE", credentials: "include" });
          const data = await res.json();
          if (!data.ok) {
            showToast(data.error || "Failed to delete.", { error: true });
            return;
          }
          await loadUserServers();
        } catch (err) {
          console.error("Delete server failed:", err);
          showToast("Failed to delete.", { error: true });
        }
      })
    );

    serverManageGrid.querySelectorAll(".server-edit-btn").forEach((b) =>
      b.addEventListener("click", () => {
        window.location.href = `/server.html?id=${encodeURIComponent(b.dataset.id)}`;
      })
    );

    serverManageGrid.querySelectorAll(".server-publish-btn").forEach((b) =>
      b.addEventListener("click", async () => {
        const wasDraft = b.dataset.draft === "true";
        const newStatus = wasDraft ? "published" : "draft";
        b.disabled = true;
        try {
          const res = await fetch(`/api/servers/${b.dataset.id}/update`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: newStatus }),
          });
          const data = await res.json();
          if (!data.ok) {
            showToast(data.error || "Failed to update status.", { error: true });
            b.disabled = false;
            return;
          }
          showToast(wasDraft ? "Server published." : "Server set to draft.");
          await loadUserServers();
        } catch (err) {
          console.error("Publish/unpublish server failed:", err);
          showToast("Failed to update status.", { error: true });
          b.disabled = false;
        }
      })
    );
  } catch (err) {
    console.error("Failed to load user servers:", err);
  }
}

async function loadUserForum() {
  const list = document.getElementById("forumList");
  const empty = document.getElementById("forumEmptyState");
  if (!list) return;
  try {
    const res = await fetch("/api/user/forum", { credentials: "include" });
    const json = await res.json();
    if (!json.ok) return;
    const threads = json.threads || [];
    list.innerHTML = "";
    if (!threads.length) {
      if (empty) empty.classList.remove("hidden");
      return;
    }
    if (empty) empty.classList.add("hidden");
    threads.forEach((t) => {
      const li = document.createElement("li");
      li.className = "dash-forum-item";

      const a = document.createElement("a");
      a.className = "dash-forum-link";
      a.href = `/forum/t/${t.id}`;
      a.textContent = t.title;
      li.appendChild(a);

      const bits = [t.category];
      if (t.hidden) bits.push("Hidden");
      if (t.pinned) bits.push("Pinned");
      if (t.solved) bits.push("Solved");
      bits.push(`${t.votes || 0} votes`);
      bits.push(`${t.replyCount || 0} replies`);
      const meta = document.createElement("div");
      meta.className = "dash-forum-meta";
      meta.textContent = bits.join(" \u00b7 ");
      li.appendChild(meta);

      list.appendChild(li);
    });
  } catch (err) {
    console.error("Failed to load forum posts:", err);
  }
}

function wireUploadFilter() {
  const input = document.getElementById("uploadsFilter");
  if (!input) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll("#addonGrid .user-addon-card").forEach((card) => {
      const name = (card.querySelector("h4")?.textContent || "").toLowerCase();
      card.style.display = !q || name.includes(q) ? "" : "none";
    });
  });
}

function setupContentTabs() {
  const tabs = Array.from(document.querySelectorAll(".content-tab"));
  if (!tabs.length) return;

  function activate(which) {
    tabs.forEach((t) => {
      const on = t.dataset.contentTab === which;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".content-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === `content-panel-${which}`);
    });
    if (history.replaceState) history.replaceState(null, "", `#${which}`);
  }

  tabs.forEach((t) => t.addEventListener("click", () => activate(t.dataset.contentTab)));

  const initial = (location.hash || "").replace("#", "");
  if (tabs.some((t) => t.dataset.contentTab === initial)) activate(initial);
}

window.addEventListener("DOMContentLoaded", () => {
  loadUserAddons();
  loadUserModels();
  loadUserServers();
  loadUserForum();
  setupContentTabs();
  wireUploadFilter();

  const goUpload = document.getElementById("goUpload");
  if (goUpload) {
    goUpload.addEventListener("click", (e) => {
      e.stopPropagation();
      window.location.href = "/upload.html";
    });
  }

  const uploadNew = document.getElementById("uploadNew");
  if (uploadNew) {
    uploadNew.addEventListener("click", () => {
      window.location.href = "/upload.html";
    });
  }

  const accountTabs = document.querySelectorAll(".account-tab");
  accountTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const which = tab.dataset.accountTab;
      accountTabs.forEach((t) => {
        t.classList.toggle("active", t === tab);
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      document.querySelectorAll(".account-panel").forEach((panel) => {
        panel.classList.toggle("active", panel.id === `account-panel-${which}`);
      });
    });
  });
});


function setFieldError(errorElId, message) {
  const el = document.getElementById(errorElId);
  if (!el) return;
  if (message) {
    el.textContent = message;
    el.hidden = false;
  } else {
    el.textContent = "";
    el.hidden = true;
  }
}

async function changeUsername() {
  const newUsernameEl = document.getElementById("newUsername");
  if (!newUsernameEl) return;
  setFieldError("newUsernameError", null);

  const newUsername = newUsernameEl.value.trim();
  if (!newUsername) {
    return setFieldError("newUsernameError", "Enter a username.");
  }

  try {
    const res = await fetch("/api/auth/change-username", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ newUsername })
    });

    const data = await res.json();

    if (data.ok) {
      showToast("Username updated");
      const name = document.querySelector(".user-name");
      if (name && data.username) name.textContent = data.username;
      setTimeout(() => location.reload(), 500);
    } else {
      setFieldError("newUsernameError", data.error || "Failed to update username.");
    }
  } catch (err) {
    console.error("CHANGE USERNAME ERROR:", err);
    setFieldError("newUsernameError", "Network error - please try again.");
  }
}


async function changePassword() {
  const oldEl = document.getElementById("oldPassword");
  const newEl = document.getElementById("newPassword");
  if (!oldEl || !newEl) return;
  setFieldError("changePasswordError", null);

  const oldPassword = oldEl.value;
  const newPassword = newEl.value;

  if (!oldPassword || !newPassword) {
    return setFieldError("changePasswordError", "Fill in both fields.");
  }

  try {
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ oldPassword, newPassword })
    });

    const data = await res.json();

    if (data.ok) {
      showToast("Password updated - please log in again");
      oldEl.value = "";
      newEl.value = "";
      setTimeout(() => {
        window.location.href = "/";
      }, 1600);
    } else {
      setFieldError("changePasswordError", data.error || "Failed to update password.");
    }
  } catch (err) {
    console.error("CHANGE PASSWORD ERROR:", err);
    setFieldError("changePasswordError", "Network error - please try again.");
  }
}




const deleteAccountModal = document.getElementById("deleteAccountModal");
const openDeleteAccountBtn = document.getElementById("openDeleteAccount");
const deleteAccountCancel = document.getElementById("deleteAccountCancel");
const deleteAccountConfirm = document.getElementById("deleteAccountConfirm");
const deleteAccountUsernameInput = document.getElementById("deleteAccountUsernameInput");
const deleteAccountPasswordInput = document.getElementById("deleteAccountPassword");
const deleteAccountError = document.getElementById("deleteAccountError");
const deleteAccountUsernameLabel = document.getElementById("deleteAccountUsername");

let currentUsername = null;

const USAGE_COLORS = {
  addons: "#6ea8fe",
  models: "#f7b955",
  servers: "#4dd4ac",
  creator: "#c792ea",
  profile: "#ff8fab",
  changelog: "#9aa0a6",
};

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[i]}`;
}

async function loadUsageStats() {
  const bar = document.getElementById("usageBar");
  if (!bar) return;
  try {
    const res = await fetch("/api/user/usage", { credentials: "include" });
    if (res.status === 401) return;
    const json = await res.json();
    if (!json.ok) return;
    renderUsage(json);
  } catch (err) {
    console.error("Failed to load usage stats:", err);
  }
}

function renderUsage(data) {
  const bar = document.getElementById("usageBar");
  const legend = document.getElementById("usageLegend");
  const totalEl = document.getElementById("usageTotal");
  const itemsEl = document.getElementById("usageTotalItems");
  const emptyEl = document.getElementById("usageEmpty");
  if (!bar || !legend) return;

  const categories = Array.isArray(data.categories) ? data.categories : [];
  const totalBytes = data.totalBytes || 0;
  const totalItems = data.totalItems || 0;

  bar.innerHTML = "";
  legend.innerHTML = "";

  if (!categories.length) {
    if (emptyEl) emptyEl.hidden = false;
    if (totalEl) totalEl.textContent = "0 B";
    if (itemsEl) itemsEl.textContent = "";
    return;
  }
  if (emptyEl) emptyEl.hidden = true;
  if (totalEl) totalEl.textContent = formatBytes(totalBytes);
  if (itemsEl) itemsEl.textContent = `across ${totalItems} item${totalItems === 1 ? "" : "s"}`;

  categories.forEach((cat) => {
    const color = USAGE_COLORS[cat.key] || "#9aa0a6";
    const percent = totalBytes > 0 ? (cat.bytes / totalBytes) * 100 : 0;

    const seg = document.createElement("div");
    seg.className = "usage-bar-seg";
    seg.style.width = `${percent}%`;
    seg.style.background = color;
    seg.title = `${cat.label}: ${formatBytes(cat.bytes)}`;
    bar.appendChild(seg);

    const row = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "usage-swatch";
    swatch.style.background = color;
    const label = document.createElement("span");
    label.className = "usage-label";
    label.textContent = cat.label;
    const count = document.createElement("span");
    count.className = "usage-count";
    count.textContent = `${cat.items} item${cat.items === 1 ? "" : "s"}`;
    const size = document.createElement("span");
    size.className = "usage-size";
    size.textContent = formatBytes(cat.bytes);
    const pct = document.createElement("span");
    pct.className = "usage-pct";
    pct.textContent = totalBytes > 0 ? `${Math.round(percent)}%` : "0%";
    row.append(swatch, label, count, size, pct);
    legend.appendChild(row);
  });
}

async function loadCurrentUsername() {
  try {
    const res = await fetch("/api/auth/status", { credentials: "include" });
    const json = await res.json();
    if (json.ok && json.user) {
      currentUsername = json.user.username;
      if (deleteAccountUsernameLabel) deleteAccountUsernameLabel.textContent = currentUsername;
      loadRecoveryStatus(currentUsername);
      loadPasskeys();
      loadNotificationPrefs();
      loadPrivacySettings();
      loadThemePreference();
      loadUsageStats();
    }
  } catch (err) {
    console.error("Failed to load current username for delete-account confirmation:", err);
  }
}

async function loadThemePreference() {
  const select = document.getElementById("themePreference");
  if (!select) return;

  const THEME_KEY = "cubyzhub-theme";
  let current = "ashframe";
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "default" || stored === "ashframe") current = stored;
  } catch (_) {}
  select.value = current;

  if (window.enhanceSelect) window.enhanceSelect(select);

  select.addEventListener("change", async () => {
    const previousValue = select.dataset.lastValue || current;
    const theme = select.value;

    if (theme === "default") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", "ashframe");
    }
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (_) {}

    try {
      const res = await fetch("/api/users/theme-preference", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme })
      });
      const json = await res.json();
      if (json.ok) {
        select.dataset.lastValue = theme;
        showToast("Theme saved");
      } else {
        select.value = previousValue;
        showToast(json.error || "Failed to save theme", { error: true });
      }
    } catch (err) {
      console.error("Failed to save theme preference:", err);
      select.value = previousValue;
      showToast("Failed to save theme", { error: true });
    }
  });
}

async function loadPrivacySettings() {
  const followersSelect = document.getElementById("followersVisibility");
  const followingSelect = document.getElementById("followingVisibility");
  const activityToggle = document.getElementById("activityVisible");
  const forumToggle = document.getElementById("forumVisible");
  if (!followersSelect || !followingSelect) return;

  try {
    const res = await fetch("/api/users/privacy-settings", { credentials: "include" });
    const json = await res.json();
    if (json.ok) {
      followersSelect.value = json.followersVisibility;
      followingSelect.value = json.followingVisibility;
      if (activityToggle) activityToggle.checked = json.activityVisible !== false;
      if (forumToggle) forumToggle.checked = json.forumVisible !== false;
    }
  } catch (err) {
    console.error("Failed to load privacy settings:", err);
  }

  function bindPrivacyToggle(toggle, key) {
    if (!toggle) return;
    toggle.addEventListener("change", async () => {
      const previousValue = !toggle.checked;
      try {
        const res = await fetch("/api/users/privacy-settings", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [key]: toggle.checked }),
        });
        const json = await res.json();
        if (json.ok) {
          showToast("Privacy setting saved");
        } else {
          toggle.checked = previousValue;
          showToast(json.error || "Failed to save setting", { error: true });
        }
      } catch (err) {
        console.error("Failed to save privacy toggle:", err);
        toggle.checked = previousValue;
        showToast("Failed to save setting", { error: true });
      }
    });
  }

  bindPrivacyToggle(activityToggle, "activityVisible");
  bindPrivacyToggle(forumToggle, "forumVisible");

  if (window.enhanceSelect) {
    window.enhanceSelect(followersSelect);
    window.enhanceSelect(followingSelect);
  }

  async function savePrivacySetting(select, bodyKey) {
    const previousValue = select.dataset.lastValue || select.value;
    try {
      const res = await fetch("/api/users/privacy-settings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [bodyKey]: select.value })
      });
      const json = await res.json();
      if (json.ok) {
        select.dataset.lastValue = select.value;
        showToast("Privacy setting saved");
      } else {
        select.value = previousValue;
        showToast(json.error || "Failed to save setting", { error: true });
      }
    } catch (err) {
      console.error("Failed to save privacy setting:", err);
      select.value = previousValue;
      showToast("Failed to save setting", { error: true });
    }
  }

  followersSelect.dataset.lastValue = followersSelect.value;
  followingSelect.dataset.lastValue = followingSelect.value;
  followersSelect.addEventListener("change", () => savePrivacySetting(followersSelect, "followersVisibility"));
  followingSelect.addEventListener("change", () => savePrivacySetting(followingSelect, "followingVisibility"));
}

async function loadNotificationPrefs() {
  const toggles = document.querySelectorAll(".pref-toggle");
  if (!toggles.length) return;

  try {
    const res = await fetch("/api/users/notification-prefs", { credentials: "include" });
    const json = await res.json();
    if (!json.ok) return;

    toggles.forEach((toggle) => {
      const key = toggle.dataset.pref;
      toggle.checked = json.prefs[key] !== false;
    });
  } catch (err) {
    console.error("Failed to load notification preferences:", err);
  }

  toggles.forEach((toggle) => {
    toggle.addEventListener("change", async () => {
      const key = toggle.dataset.pref;
      const previousValue = !toggle.checked;
      try {
        const res = await fetch("/api/users/notification-prefs", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prefs: { [key]: toggle.checked } })
        });
        const json = await res.json();
        if (!json.ok) {
          toggle.checked = previousValue;
          showToast(json.error || "Failed to save setting", { error: true });
        }
      } catch (err) {
        console.error("Failed to save notification preference:", err);
        toggle.checked = previousValue;
        showToast("Failed to save setting", { error: true });
      }
    });
  });
}

const recoveryStatusEl = document.getElementById("recoveryStatus");
const openRecoverySetupBtn = document.getElementById("openRecoverySetup");

async function loadRecoveryStatus(username) {
  if (!recoveryStatusEl || !username) return;
  try {
    const res = await fetch("/api/auth/recovery-options", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    const json = await res.json();
    if (!json.ok) {
      recoveryStatusEl.textContent = "Could not load recovery status.";
      return;
    }
    if (json.hasSecurityQuestion && json.hasRecoveryCode) {
      recoveryStatusEl.textContent = "Security question and recovery code set up.";
    } else if (json.hasSecurityQuestion) {
      recoveryStatusEl.textContent = "Security question set up.";
    } else if (json.hasRecoveryCode) {
      recoveryStatusEl.textContent = "Recovery code set up.";
    } else {
      recoveryStatusEl.textContent = "No recovery method set up.";
      recoveryStatusEl.style.color = "#e0b25d";
    }
  } catch (err) {
    console.error("Failed to load recovery status:", err);
    recoveryStatusEl.textContent = "Could not load recovery status.";
  }
}

if (openRecoverySetupBtn) {
  openRecoverySetupBtn.addEventListener("click", () => {
    if (typeof window.openAccountRecoverySetup === "function") {
      window.openAccountRecoverySetup();
    }
  });
}

const passkeyListEl = document.getElementById("passkeyList");
const addPasskeyBtn = document.getElementById("addPasskeyBtn");

async function loadPasskeys() {
  if (!passkeyListEl) return;
  try {
    const res = await fetch("/api/auth/passkeys", { credentials: "include" });
    const json = await res.json();
    if (!json.ok) return;

    passkeyListEl.innerHTML = "";
    if (!json.passkeys.length) {
      const li = document.createElement("li");
      li.style.cssText = "color:#aaa;font-size:0.9rem;";
      li.textContent = "No passkeys added yet.";
      passkeyListEl.appendChild(li);
      return;
    }

    json.passkeys.forEach((pk) => {
      const li = document.createElement("li");
      li.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;background:#171b19;border:1px solid #2d3530;border-radius:8px;";

      const label = document.createElement("span");
      label.style.cssText = "font-size:0.9rem;color:#ddd;";
      const created = pk.created_at ? parseServerDate(pk.created_at).toLocaleDateString("en-GB") : "";
      label.textContent = `${pk.device_name || "Passkey"} — added ${created}`;

      const removeBtn = document.createElement("button");
      removeBtn.className = "btn btn-danger btn-sm";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", async () => {
        if (!confirm("Remove this passkey? You'll no longer be able to sign in with it.")) return;
        try {
          const delRes = await fetch(`/api/auth/passkeys/${pk.id}`, {
            method: "DELETE",
            credentials: "include",
          });
          const delJson = await delRes.json();
          if (delJson.ok) {
            showToast("Passkey removed");
            loadPasskeys();
          } else {
            showToast(delJson.error || "Failed to remove passkey", { error: true });
          }
        } catch (err) {
          console.error("Failed to remove passkey:", err);
          showToast("Network error", { error: true });
        }
      });

      li.append(label, removeBtn);
      passkeyListEl.appendChild(li);
    });
  } catch (err) {
    console.error("Failed to load passkeys:", err);
  }
}

if (addPasskeyBtn) {
  addPasskeyBtn.addEventListener("click", async () => {
    if (!window.SimpleWebAuthnBrowser || !window.PublicKeyCredential) {
      showToast("Passkeys aren't supported in this browser", { error: true });
      return;
    }
    try {
      const optRes = await fetch("/api/auth/passkey/register-options", {
        method: "POST",
        credentials: "include",
      });
      const optJson = await optRes.json();
      if (!optJson.ok) {
        showToast(optJson.error || "Could not start passkey registration", { error: true });
        return;
      }

      const attestation = await window.SimpleWebAuthnBrowser.startRegistration({ optionsJSON: optJson.options });

      const deviceName = prompt("Name this passkey (e.g. \"MacBook\", \"Phone\"):", "") || undefined;

      const verifyRes = await fetch("/api/auth/passkey/register-verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceName, response: attestation }),
      });
      const verifyJson = await verifyRes.json();
      if (verifyJson.ok) {
        showToast("Passkey added");
        loadPasskeys();
      } else {
        showToast(verifyJson.error || "Failed to add passkey", { error: true });
      }
    } catch (err) {
      if (err.name !== "NotAllowedError") {
        console.error("Failed to add passkey:", err);
        showToast("Failed to add passkey", { error: true });
      }
    }
  });
}

function openDeleteAccountModal() {
  if (!deleteAccountModal) return;
  deleteAccountUsernameInput.value = "";
  deleteAccountPasswordInput.value = "";
  deleteAccountError.hidden = true;
  deleteAccountError.textContent = "";
  deleteAccountModal.classList.add("open");
  deleteAccountModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeDeleteAccountModal() {
  if (!deleteAccountModal) return;
  deleteAccountModal.classList.remove("open");
  deleteAccountModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

if (openDeleteAccountBtn) {
  openDeleteAccountBtn.addEventListener("click", openDeleteAccountModal);
}

if (deleteAccountCancel) {
  deleteAccountCancel.addEventListener("click", closeDeleteAccountModal);
}

if (deleteAccountModal) {
  deleteAccountModal.addEventListener("click", (e) => {
    if (e.target === deleteAccountModal) closeDeleteAccountModal();
  });
}

if (deleteAccountConfirm) {
  deleteAccountConfirm.addEventListener("click", async () => {
    deleteAccountError.hidden = true;

    const typedUsername = deleteAccountUsernameInput.value.trim();
    const password = deleteAccountPasswordInput.value;

    if (currentUsername && typedUsername !== currentUsername) {
      deleteAccountError.textContent = "Username doesn't match.";
      deleteAccountError.hidden = false;
      return;
    }

    if (!password) {
      deleteAccountError.textContent = "Password is required.";
      deleteAccountError.hidden = false;
      return;
    }

    try {
      const res = await fetch("/api/auth/account", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = await res.json().catch(() => ({ ok: false }));

      if (json.ok) {
        closeDeleteAccountModal();
        window.location.href = "/";
      } else {
        deleteAccountError.textContent = json.error || "Account deletion failed.";
        deleteAccountError.hidden = false;
      }
    } catch (err) {
      deleteAccountError.textContent = "Network error. Please try again.";
      deleteAccountError.hidden = false;
    }
  });
}

loadCurrentUsername();
