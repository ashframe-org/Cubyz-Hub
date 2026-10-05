
import { enhanceSelect } from './custom-select.js?v=20260919-17';

function escapeHTML(str) {
  return String(str ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m]));
}

const DOM = {
  container: document.getElementById("server-container"),
  emptyState: document.getElementById("server-empty-state"),
  search: document.getElementById("serverSearchBar"),
  sort: document.getElementById("serverSortSelect"),
  version: document.getElementById("serverVersionFilter"),
  minPlayers: document.getElementById("serverMinPlayersFilter"),
  maxPlayers: document.getElementById("serverMaxPlayersFilter"),
  requiresMods: document.getElementById("serverRequiresModsFilter"),
};

let currentUser = null;
async function loadCurrentUser() {
  try {
    const res = await fetch("/api/auth/status", { credentials: "include" });
    const data = await res.json();
    if (data.ok && data.user) currentUser = data.user;
  } catch (_) {}
}

async function toggleServerLike(serverId, btn, countEl) {
  if (!currentUser) {
    toast.error("You must be logged in to like servers.");
    return;
  }
  btn.disabled = true;
  try {
    const res = await fetch(`/api/servers/${encodeURIComponent(serverId)}/like`, {
      method: "POST",
      credentials: "include",
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      if (typeof window.toast === "function") window.toast.error(data?.error || "Failed to update like.");
      return;
    }
    countEl.textContent = data.likes;
    btn.classList.toggle("liked", data.liked);
  } finally {
    btn.disabled = false;
  }
}

function renderServerVersion(version) {
  const v = String(version || "");
  // "UPSTREAM" is a channel label, not a version number - don't prefix it.
  return /^upstream$/i.test(v) ? escapeHTML(v) : "v" + escapeHTML(v);
}

function renderServerCard(server) {
  const card = document.createElement("a");
  card.className = "server-card";
  card.href = `/server.html?id=${encodeURIComponent(server.id)}`;

  const iconSrc = server.icon_url || "assets/default_icon.png";
  const isOnline = !!server.online;
  card.classList.toggle("is-online", isOnline);

  card.innerHTML = `
    <img class="server-card-icon" src="${escapeHTML(iconSrc)}" alt="" loading="lazy">
    <div class="server-card-main">
      <div class="server-card-title-row">
        <span class="server-card-title">${escapeHTML(server.name)}</span>
        <span class="server-card-owner">By ${escapeHTML(server.owner_username)}</span>
      </div>
      <p class="server-card-desc">${escapeHTML(server.description || "")}</p>
      ${server.ip ? `<span class="server-card-ip">${escapeHTML(server.ip)}</span>` : ""}
    </div>
    <div class="server-card-stats">
      <span class="server-status-badge ${isOnline ? "server-status-online" : "server-status-offline"}">${isOnline ? `Online - ${escapeHTML(String(server.player_count ?? 0))} players` : "Offline"}</span>
      <div class="server-card-tags">
        ${server.version ? `<span class="server-card-version">${renderServerVersion(server.version)}</span>` : ""}
        ${server.requires_mods ? `<span class="server-card-version">Mods required</span>` : ""}
      </div>
      <button type="button" class="server-card-like${server.liked_by_viewer ? " liked" : ""}">
        <span class="server-card-like-icon">&#10084;</span>
        <span class="server-card-like-count">${escapeHTML(String(server.likes ?? 0))}</span>
      </button>
    </div>
  `;

  const likeBtn = card.querySelector(".server-card-like");
  const likeCount = card.querySelector(".server-card-like-count");
  likeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleServerLike(server.id, likeBtn, likeCount);
  });

  return card;
}

let searchDebounce;

async function loadServers() {
  try {
    const params = new URLSearchParams();
    if (DOM.search.value.trim()) params.set("search", DOM.search.value.trim());
    if (DOM.sort.value) params.set("sort", DOM.sort.value);
    if (DOM.version.value.trim()) params.set("version", DOM.version.value.trim());
    if (DOM.minPlayers.value !== "") params.set("minPlayers", DOM.minPlayers.value);
    if (DOM.maxPlayers.value !== "") params.set("maxPlayers", DOM.maxPlayers.value);
    if (DOM.requiresMods.checked) params.set("requiresMods", "true");

    const res = await fetch(`/api/servers?${params.toString()}`);
    const data = await res.json();
    if (!data.ok) return;

    DOM.container.innerHTML = "";
    if (!data.servers.length) {
      DOM.emptyState.style.display = "";
      return;
    }
    DOM.emptyState.style.display = "none";
    data.servers.forEach((server) => DOM.container.appendChild(renderServerCard(server)));
  } catch (err) {
    console.error("Failed to load servers:", err);
  }
}

DOM.search.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(loadServers, 250);
});
DOM.sort.addEventListener("change", loadServers);
DOM.version.addEventListener("change", loadServers);
DOM.minPlayers.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(loadServers, 250);
});
DOM.maxPlayers.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(loadServers, 250);
});
DOM.requiresMods.addEventListener("change", loadServers);

enhanceSelect(DOM.sort);

async function populateVersionFilter() {
  DOM.version.innerHTML = '<option value="">Any version</option>';
  try {
    const res = await fetch("/api/game/versions");
    const data = await res.json();
    const versions = data.ok && Array.isArray(data.versions) ? data.versions : [];
    versions.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      DOM.version.appendChild(opt);
    });
  } catch (_) {}
  enhanceSelect(DOM.version);
}

populateVersionFilter();
loadCurrentUser().then(loadServers);
